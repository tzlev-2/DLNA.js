// קובץ: packages/server/src/playPresetHandler.ts
// מכיל את לוגיקת הליבה להפעלת פריסט

import { createModuleLogger } from './logger';
import {
  DiscoveryDetailLevel,
  processUpnpDeviceFromUrl,
  retry,
} from 'dlna.js';

import type {
  ApiDevice,
  PresetSettings,
} from './types';

import type {
  DeviceDescription, // ייבוא הטיפוסים מ-dlna.js
  DeviceWithServicesDescription, // ייבוא הטיפוסים מ-dlna.js
  FullDeviceDescription, // ייבוא הטיפוסים מ-dlna.js
} from 'dlna.js';

import { wakeDeviceAndVerify } from 'wake-on-lan';
import { getFolderItemsFromMediaServer, playProcessedItemsOnRenderer, ProcessedPlaylistItem, isRendererPlaying, stopRenderer } from './rendererHandler';
import { getActiveDevices } from './deviceManager';
import { config } from './config';

const logger = createModuleLogger('PlayPresetHandler');

/**
 * @hebrew שגיאה מותאמת אישית לתהליך הפעלת פריסט.
 */
export class PlaybackError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'PlaybackError';
    this.statusCode = statusCode;
    // שחזור הפרוטוטייפ כדי ש-instanceof יעבוד כראוי עם מחלקות מובנות
    Object.setPrototypeOf(this, PlaybackError.prototype);
  }
}

// Helper functions for handleRendererTask
async function wakeAndVerifyRenderer(
  rendererPreset: NonNullable<PresetSettings['renderer']>, // RendererPreset is now non-nullable
  presetName: string
): Promise<void> {
  logger.info(`Attempting WOL for renderer ${rendererPreset.ipAddress} (MAC: ${rendererPreset.macAddress}) for preset '${presetName}'.`);
  try {
    await wakeDeviceAndVerify(
      rendererPreset.macAddress,
      rendererPreset.ipAddress,
      rendererPreset.broadcastAddress,
      undefined, // wolPort - default
      18, 2, 2 // timeouts
    );
    logger.info(`Device ${rendererPreset.ipAddress} (Renderer) for preset '${presetName}' responded after wakeDeviceAndVerify.`);
  } catch (wakeError: any) {
    logger.error(`wakeDeviceAndVerify failed for renderer ${rendererPreset.ipAddress} (MAC: ${rendererPreset.macAddress}) for preset '${presetName}': ${wakeError.message}`);
    throw new PlaybackError(`Renderer for preset '${presetName}' did not respond or WOL failed: ${wakeError.message}`, 503);
  }
}

/**
 * @hebrew מאשר שהתקן מגיב לבקשה דרך ה-URL שלו.
 * @description פונקציה זו מנסה לאחזר פרטים בסיסיים של ההתקן מה-URL שסופק
 * כדי לוודא שהוא פעיל ומגיב כצפוי.
 * @param deviceToConfirm - אובייקט ה-ApiDevice שיש לאשר (מתוך activeDevices).
 * @param deviceBaseURL - ה-baseURL של ההתקן לבדיקה.
 * @param presetName - שם הפריסט (לצורך לוגים).
 * @returns true אם ההתקן מגיב עם UDN תואם, false אחרת.
 */
async function confirmDeviceRespondsViaUrl(
  deviceToConfirm: ApiDevice,
  deviceBaseURL: string,
  presetName: string
): Promise<boolean> {
  logger.info(`Confirming renderer ${deviceToConfirm.UDN} responds via URL: ${deviceBaseURL} for preset '${presetName}'.`);
  try {
    // הוא מאחזר את קובץ התיאור הראשי של ההתקן.
    const checkedDevice = await processUpnpDeviceFromUrl(deviceBaseURL, DiscoveryDetailLevel.Full);

    const checkedDeviceUDN = checkedDevice?.UDN?.replace('uuid:', '') ?? ''; // הסרת 'uuid:' אם קיים

    if (checkedDevice && 'UDN' in checkedDevice && checkedDeviceUDN === deviceToConfirm.UDN) {
      logger.info(`Confirmation successful: Renderer ${deviceToConfirm.UDN} (preset '${presetName}') responded as expected.`);
      return true;
    } else {
      const receivedUdn = checkedDevice && 'UDN' in checkedDevice && checkedDevice.UDN ? checkedDevice.UDN : 'N/A or not present';
      logger.warn(`Confirmation failed for renderer ${deviceToConfirm.UDN} (preset '${presetName}'). Device from URL did not match or was incomplete. Expected UDN: ${deviceToConfirm.UDN}, Received UDN: ${receivedUdn}. URL: ${deviceBaseURL}`);
      return false;
    }
  } catch (error: any) {
    logger.warn(`Confirmation failed for renderer ${deviceToConfirm.UDN} (preset '${presetName}') with error: ${error.message}. URL: ${deviceBaseURL}`);
    return false;
  }
}

/**
 * @hebrew מנסה למצוא התקן ברשימה הפעילה ולאשר שהוא מגיב.
 * @param udnToFind - ה-UDN של ההתקן לחיפוש.
 * @param baseURL - ה-URL של ההתקן לאישור תגובה.
 * @param presetName - שם הפריסט (לצורך לוגים).
 * @returns את אובייקט ה-ApiDevice אם נמצא ואושר, אחרת undefined.
 */
async function tryFindAndConfirmDevice(
  udnToFind: string,
  presetName: string
): Promise<ApiDevice | undefined> {
  const currentActiveDevices = getActiveDevices();
  const device = currentActiveDevices.get(udnToFind);

  if (device) {
    logger.info(`Device ${udnToFind} found in active list for preset '${presetName}'. Confirming responsiveness...`);
    const isResponsive = await confirmDeviceRespondsViaUrl(device, device.location, presetName);
    if (isResponsive) {
      logger.info(`Device ${udnToFind} confirmed responsive for preset '${presetName}'.`);
      return device;
    } else {
      logger.warn(`Device ${udnToFind} found but failed responsiveness check for preset '${presetName}'.`);
    }
  }
  return undefined;
}

/**
 * @hebrew ממתין באופן פעיל לאישור שהתקן זמין ומגיב.
 * @description הפונקציה מנסה למצוא התקן ברשימה הפעילה שמתעדכנת ברקע,
 * ולאחר מכן מוודאת שההתקן אכן מגיב לבקשת רשת ישירה.
 * התהליך נמשך עד למציאת ההתקן או עד לפקיעת הזמן המוגדר.
 * @param rendererUDN - ה-UDN של הרנדרר שאותו יש למצוא.
 * @param rendererBaseURL - ה-URL של הרנדרר לאימות תגובה.
 * @param presetName - שם הפריסט (לצורך לוגים).
 * @returns הבטחה שמסתיימת עם אובייקט ה-ApiDevice שנמצא ואושר.
 * @throws {PlaybackError} אם ההתקן לא נמצא ואושר במסגרת הזמן שהוגדרה.
 */
async function waitForDeviceConfirmation(
  rendererUDN: string,
  presetName: string
): Promise<ApiDevice> {
  const {
    initialIntervalMs,
    maxIntervalMs,
    timeoutMs,
    intervalIncrementFactor
  } = config.pingPolling;

  logger.info(`Waiting for device confirmation: UDN=${rendererUDN}, Preset='${presetName}', Timeout=${timeoutMs}ms`);

  const startTime = Date.now();
  let currentInterval = initialIntervalMs;

  while (Date.now() - startTime < timeoutMs) {
    const foundDevice = await tryFindAndConfirmDevice(rendererUDN, presetName);
    if (foundDevice) {
      logger.info(`Device ${rendererUDN} confirmed successfully for preset '${presetName}' after ${Date.now() - startTime}ms.`);
      return foundDevice;
    }

    const timeElapsed = Date.now() - startTime;
    const nextWaitTime = Math.min(currentInterval, timeoutMs - timeElapsed);

    if (nextWaitTime <= 0) {
      break; // יציאה אם לא נשאר זמן להמתנה נוספת
    }

    logger.debug(`Device ${rendererUDN} not confirmed for preset '${presetName}'. Waiting ${nextWaitTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, nextWaitTime));

    currentInterval = Math.min(maxIntervalMs, Math.floor(currentInterval * intervalIncrementFactor));
  }

  // ניסיון אחרון אחרי שהלולאה הסתיימה
  logger.info(`Polling timeout reached for ${rendererUDN}. Performing one final check for preset '${presetName}'.`);
  const lastAttemptDevice = await tryFindAndConfirmDevice(rendererUDN, presetName);
  if (lastAttemptDevice) {
    logger.info(`Device ${rendererUDN} confirmed in final check for preset '${presetName}'.`);
    return lastAttemptDevice;
  }

  logger.error(`Device ${rendererUDN} could not be confirmed after polling for ${timeoutMs}ms for preset '${presetName}'.`);
  throw new PlaybackError(`Renderer for preset '${presetName}' (UDN: ${rendererUDN}) could not be confirmed after polling timeout.`, 500);
}

// הפונקציה executePlayPresetLogic תתווסף כאן בשלב הבא

export async function executePlayPresetLogic(
  presetName: string,
  presetSettings: PresetSettings, // מקבלים את הפריסט הספציפי
  activeDevices: Map<string, ApiDevice>
  // updateDeviceListCallback הוסר
): Promise<{ success: true, message: string }> {
  logger.info(`Attempting to play preset: ${presetName}`);

  // הבדיקה על קיום presetSettings נעשית ע"י הקורא (presetManager)
  // הבדיקה על שלמות הפריסט:
  if (
    !presetSettings.renderer?.udn ||
    !presetSettings.renderer?.baseURL ||
    !presetSettings.renderer?.ipAddress ||
    !presetSettings.renderer?.macAddress ||
    !presetSettings.renderer?.broadcastAddress ||
    !presetSettings.mediaServer?.udn ||
    !presetSettings.mediaServer?.baseURL ||
    !presetSettings.mediaServer?.folder?.objectId
  ) {
    logger.error(`Preset '${presetName}' is missing required settings.`);
    throw new PlaybackError(`Preset '${presetName}' is incomplete. Please check its configuration.`, 400);
  }

  const rendererPreset = presetSettings.renderer!;
  const mediaServerPreset = presetSettings.mediaServer!;
  const folderObjectId = mediaServerPreset.folder.objectId;

  logger.info(`Found preset '${presetName}'. Renderer: ${rendererPreset.udn}, IP: ${rendererPreset.ipAddress}, MAC: ${rendererPreset.macAddress}, Media Server: ${mediaServerPreset.udn}, Folder ID: ${folderObjectId}`);

  // פונקציית עזר פנימית לבדיקה ועצירה של ניגון קיים
  const checkAndStopPlaybackIfNeeded = async (device: ApiDevice) => {
    const isPlaying = await isRendererPlaying(device.UDN, activeDevices, logger);
    if (isPlaying) {
      logger.info(`Renderer ${device.UDN} is currently playing. Sending stop command and halting preset '${presetName}'.`);
      await stopRenderer(device.UDN, activeDevices, logger);
      // לאחר העצירה, עוצרים את ריצת הפריסט הנוכחי
      throw new PlaybackError(`Preset '${presetName}' halted because the renderer was already playing. A stop command was sent.`, 409); // 409 Conflict
    }
  };

  // משימה 1: טיפול ב-Renderer (הערה והחייאה במידת הצורך)
  const handleRendererTask = async (): Promise<ApiDevice> => {
    let deviceFromActiveList = activeDevices.get(rendererPreset.udn); // Check initial active devices map

    if (deviceFromActiveList) {
      logger.info(`Renderer ${rendererPreset.udn} (preset '${presetName}') found in initial active devices. Confirming it responds via URL: ${rendererPreset.baseURL}...`);

      const respondsViaUrl = await confirmDeviceRespondsViaUrl(deviceFromActiveList, rendererPreset.baseURL, presetName);

      if (respondsViaUrl) {
        logger.info(`Renderer ${rendererPreset.udn} (preset '${presetName}') confirmed responsive. Using this device instance.`);
        await checkAndStopPlaybackIfNeeded(deviceFromActiveList);
        return deviceFromActiveList;

      } else {
        logger.warn(`Renderer ${rendererPreset.udn} (preset '${presetName}') failed to respond as expected via URL. Will proceed as if not found in active list (requires WOL, revival, polling).`);
        // התקן נכשל באישור התגובה, נמשיך כאילו לא היה קיים ברשימה הפעילה.
        // אין צורך לשנות את deviceFromActiveList, פשוט נגיע לקוד הבא.
      }
    }

    // אם ההתקן לא היה ברשימה הפעילה, או שהיה ונכשל בבדיקת החיות:
    logger.info(`Renderer ${rendererPreset.udn} (preset '${presetName}') requires full processing: WOL, device details revival, and polling in active devices list.`);

    // שלב 1: הערה ואימות (WOL and ping)
    await wakeAndVerifyRenderer(rendererPreset, presetName);

    // שלב 3: פולינג לאיתור ההתקן המנוהל (ApiDevice) ברשימה המרכזית (activeDevices)
    // זה חשוב כדי לקבל את האובייקט המלא שמנוהל על ידי המערכת, כולל שירותים שעובדו.
    // אנו משתמשים ב-rendererPreset.udn כי זה ה-UDN שאנו מצפים לו.
    const polledApiDevice = await waitForDeviceConfirmation(rendererPreset.udn, presetName);

    await checkAndStopPlaybackIfNeeded(polledApiDevice);
    return polledApiDevice;
  };

  // משימה 2: טיפול ב-Media Server (קבלת פריטים)
  const handleMediaServerTask = async (): Promise<ProcessedPlaylistItem[]> => {
    const device = activeDevices.get(mediaServerPreset.udn);
    if (!device) {
      logger.warn(`Media Server ${mediaServerPreset.udn} for preset '${presetName}' is not in active devices. Playback might fail.`);
      throw new PlaybackError(`Media Server for preset '${presetName}' is not currently available.`, 503); // 503 Service Unavailable
    }
    logger.info(`Attempting to get folder items for preset '${presetName}' from Media Server UDN: ${mediaServerPreset.udn}, Folder ID: ${folderObjectId}`);
    try {
      return await getFolderItemsFromMediaServer(
        mediaServerPreset.udn,
        folderObjectId,
        activeDevices,
        logger // שימוש בלוגר של PlayPresetHandler
      );
    } catch (error: any) {
      logger.error(`Error in getFolderItemsFromMediaServer for preset '${presetName}': ${error.message}`, error);
      // אם getFolderItemsFromMediaServer זורק שגיאה עם statusCode, נשתמש בו
      throw new PlaybackError(error.message || `Failed to get items from media server for preset '${presetName}'.`, error.statusCode || 500);
    }
  };

  // הרצת המשימות במקביל
  // עוטפים כל משימה ב-try-catch פנימי כדי ש-Promise.allSettled יוכל לתפוס את השגיאות המותאמות שלנו
  const handleRendererTaskWrapped = async () => {
    try {
      return await handleRendererTask();
    } catch (error) {
      if (error instanceof PlaybackError) throw error; // זרוק מחדש שגיאות PlaybackError
      throw new PlaybackError(error instanceof Error ? error.message : String(error), 500); // עטוף שגיאות אחרות
    }
  };

  const handleMediaServerTaskWrapped = async () => {
    try {
      return await handleMediaServerTask();
    } catch (error) {
      if (error instanceof PlaybackError) throw error;
      throw new PlaybackError(error instanceof Error ? error.message : String(error), 500);
    }
  };

  const results = await Promise.allSettled([handleRendererTaskWrapped(), handleMediaServerTaskWrapped()]);

  const rendererTaskResult = results[0];
  const mediaServerTaskResult = results[1];

  let finalRendererDevice: ApiDevice;
  let processedItems: ProcessedPlaylistItem[];

  if (rendererTaskResult.status === 'rejected') {
    logger.error(`Renderer task failed for preset '${presetName}': ${rendererTaskResult.reason?.message || rendererTaskResult.reason}`);
    // השגיאה כבר אמורה להיות PlaybackError
    throw rendererTaskResult.reason instanceof PlaybackError ? rendererTaskResult.reason : new PlaybackError(rendererTaskResult.reason?.message || `Failed to prepare renderer for preset '${presetName}'.`, rendererTaskResult.reason?.statusCode || 503);
  }
  finalRendererDevice = rendererTaskResult.value;
  // אין צורך לבדוק אם finalRendererDevice הוא null כי handleRendererTask אמור לזרוק שגיאה אם הוא לא מצליח להחזיר מכשיר תקין

  if (mediaServerTaskResult.status === 'rejected') {
    logger.error(`Media server task (get items) failed for preset '${presetName}': ${mediaServerTaskResult.reason?.message || mediaServerTaskResult.reason}`);
    throw mediaServerTaskResult.reason instanceof PlaybackError ? mediaServerTaskResult.reason : new PlaybackError(mediaServerTaskResult.reason?.message || `Failed to get items from media server for preset '${presetName}'.`, mediaServerTaskResult.reason?.statusCode || 500);
  }
  processedItems = mediaServerTaskResult.value;

  if (!processedItems || processedItems.length === 0) {
    logger.warn(`No items returned from media server for preset '${presetName}'.`);
    throw new PlaybackError(`No items found on media server for preset '${presetName}'.`, 404); // 404 Not Found
  }

  // אם שתי המשימות הצליחו, נגן את הפריטים
  logger.info(`Both tasks completed for preset '${presetName}'. Attempting to play ${processedItems.length} items on renderer ${finalRendererDevice.UDN}.`);

  // עטיפת פקודת הניגון עם מנגנון ניסיונות חוזרים
  try {
    const playbackResult = await retry(
      async () => {
        const result = await playProcessedItemsOnRenderer(
          finalRendererDevice.UDN,
          processedItems,
          activeDevices,
          logger // שימוש בלוגר של PlayPresetHandler
        );
        if (!result.success) {
          // זריקת שגיאה כדי להפעיל את ה-retry
          throw new PlaybackError(result.message, result.statusCode);
        }
        return result;
      },
      {
        retries: 3,
        delayMs: 10000, // המתנה של 10 שניות בין ניסיונות
        logger: logger,
        onRetry: (error, attempt) => {
          logger.warn(`Playback attempt ${attempt} failed for preset '${presetName}'. Retrying... Error: ${error.message}`);
        },
      }
    );

    logger.info(`Preset '${presetName}' playback command successful after retry logic: ${playbackResult.message}`);
    return { success: true, message: playbackResult.message };

  } catch (error: any) {
    logger.error(`All playback attempts failed for preset '${presetName}'. Final error: ${error.message}`, error);
    if (error instanceof PlaybackError) throw error; // זרוק מחדש אם זו כבר שגיאת PlaybackError
    throw new PlaybackError(error.message || `Playback failed for preset '${presetName}' after multiple retries.`, error.statusCode || 500);
  }
}