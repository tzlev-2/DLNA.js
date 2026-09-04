// server/rendererHandler.ts
import { Request, Response, NextFunction, Router, response } from 'express';
import { createModuleLogger } from './logger';
import {
  ContentDirectoryService, BrowseFlag,
  createSingleItemDidlLiteXml, // ייבוא הפונקציה החדשה
  retry
} from 'dlna.js';
import { getActiveDevices } from './deviceManager';
// נניח שהטיפוסים DidlLiteObject ו-Resource מיוצאים גם הם מ-dlna.js
// אם לא, נצטרך להתאים את הנתיב ל: import type { DidlLiteObject, Resource } from '@dlna-vision/dlna-core/src/types';
import type { ServiceDescription, DidlLiteObject, Resource } from "dlna.js";
import type { ApiDevice } from './types';


// טיפוס חדש לפריט וידאו מעובד שמוכן לניגון
export interface ProcessedPlaylistItem {
  uri: string;
  didlXml: string;
  title: string; // לנוחות לוגים
}

const createRenderMockRes = (rendererUdn: string) => ({
  status: (code: number) => ({
    send: (body: any) => {
      throw {
        statusCode: code,
        body,
        message: `Error with renderer ${rendererUdn}: ${body?.error || JSON.stringify(body)}`
      };
    }
  })
} as any as Response);

const logger = createModuleLogger('rendererHandler');

/**
 * @hebrew מאחזר ומעבד פריטים מתיקייה בשרת מדיה.
 * @throws {Error} אם שרת המדיה או שירות ה-ContentDirectory לא תקינים, או אם התיקייה ריקה/לא נמצאה.
 */
export async function getFolderItemsFromMediaServer(
  mediaServerUdn: string,
  folderObjectId: string,
  activeDevices: Map<string, ApiDevice>,
  parentLogger: typeof logger
): Promise<ProcessedPlaylistItem[]> {
  parentLogger.info(`Attempting to browse folder ${folderObjectId} on media server ${mediaServerUdn}`);

  const resMock = ({
    status: (code: number) => ({
      send: (body: any) => {
        throw {
          statusCode: code,
          body,
          message: `Media Server UDN ${mediaServerUdn} not found or invalid.`
        };
      }
    })
  } as any as Response);



  const mediaServer = getValidatedDevice(mediaServerUdn, 'Media Server', resMock);
  if (!mediaServer) { // בדיקה נוספת למרות ש-getValidatedDevice אמור לזרוק שגיאה
    throw new Error(`Media Server with UDN ${mediaServerUdn} not found or invalid.`);
  }

  const cdServiceDescriptionOriginal = getValidatedService(mediaServer, 'ContentDirectory', 'ContentDirectory', { status: (code: number) => ({ send: (body: any) => { throw { statusCode: code, body, message: `ContentDirectory service not found for ${mediaServerUdn}.` }; } }) } as any as Response);
  if (!cdServiceDescriptionOriginal) { // בדיקה נוספת
    throw new Error(`ContentDirectory service not found or invalid for media server ${mediaServerUdn}.`);
  }

  const absoluteCdControlURL = new URL(cdServiceDescriptionOriginal.controlURL, mediaServer.baseURL).href;
  const cdServiceForBrowse: ServiceDescription = {
    ...cdServiceDescriptionOriginal,
    controlURL: absoluteCdControlURL
  };

  const cds = new ContentDirectoryService(cdServiceForBrowse);
  const browseResult = await cds.browse(folderObjectId, BrowseFlag.BrowseDirectChildren, '*', 0, 0);

  if (!browseResult || browseResult.numberReturned === 0 || !browseResult.items || browseResult.items.length === 0) {
    const message = `Folder with ID ${folderObjectId} is empty or not found on media server ${mediaServerUdn}.`;
    parentLogger.warn(message);
    throw new Error(message); // זריקת שגיאה במקום החזרת אובייקט
  }

  const videoItemsRaw = browseResult.items.filter((item: any) => {
    const upnpClass = item.class || item['upnp:class'];
    const hasResources = item.res || (item.resources && item.resources.length > 0);
    return typeof upnpClass === 'string' && upnpClass.startsWith('object.item.videoItem') && hasResources;
  });

  if (videoItemsRaw.length === 0) {
    const message = `No video items found in folder ${folderObjectId} on media server ${mediaServerUdn}.`;
    parentLogger.warn(message);
    throw new Error(message);
  }

  const processedItems: ProcessedPlaylistItem[] = [];

  // פונקציית עזר פנימית לעיבוד כל פריט
  const getItemUriAndDidl = (itemData: any, parentIdForDidl: string, itemIndex: number): ProcessedPlaylistItem | null => {
    let currentItemResUrl: string | null = null;
    let protocolInfo = "http-get:*:video/*:*"; // Default
    let itemTitle = itemData.title || itemData['dc:title'] || 'Video Item';
    let itemUpnpClass = itemData.class || itemData['upnp:class'] || 'object.item.videoItem';
    // שימוש באינדקס ליצירת ID ייחודי אם אין ID מהשרת
    let itemIdForDidl = itemData.id || itemData._id || `${parentIdForDidl}/${itemIndex}`;


    if (itemData.resources && itemData.resources[0] && itemData.resources[0].uri) {
      currentItemResUrl = itemData.resources[0].uri;
      if (itemData.resources[0].protocolInfo) protocolInfo = itemData.resources[0].protocolInfo;
    } else if (itemData.res) {
      if (typeof itemData.res === 'string') currentItemResUrl = itemData.res;
      else if (Array.isArray(itemData.res) && itemData.res[0]) {
        if (typeof itemData.res[0] === 'string') currentItemResUrl = itemData.res[0];
        else if (itemData.res[0]._ && typeof itemData.res[0]._ === 'string') {
          currentItemResUrl = itemData.res[0]._;
          if (itemData.res[0].$ && itemData.res[0].$.protocolInfo) protocolInfo = itemData.res[0].$.protocolInfo;
        }
      }
    }

    if (!currentItemResUrl) {
      parentLogger.warn(`Could not extract resource URL for item: ${itemTitle} (ID: ${itemIdForDidl})`);
      return null;
    }

    let absoluteItemUrl = currentItemResUrl;
    if (mediaServer.baseURL && !absoluteItemUrl.startsWith('http://') && !absoluteItemUrl.startsWith('https://')) {
      try {
        absoluteItemUrl = new URL(absoluteItemUrl, mediaServer.baseURL).toString();
      } catch (e) {
        parentLogger.warn(`Could not construct absolute URL for item ${itemIdForDidl}: ${currentItemResUrl}. Error: ${(e as Error).message}`);
        return null;
      }
    }

    const itemObject: DidlLiteObject = {
      id: itemIdForDidl,
      parentId: parentIdForDidl, // parentIdForDidl הוא ה-ID של התיקייה
      restricted: true, // בדרך כלל פריטים מוגבלים
      title: itemTitle,
      class: itemUpnpClass,
      // מאפיינים נוספים שיכולים להגיע מ-itemData כמו artist, album, genre וכו' אפשר להוסיף כאן אם רלוונטי
    };

    const resourceObject: Resource = {
      uri: absoluteItemUrl,
      protocolInfo: protocolInfo,
      // מאפיינים נוספים כמו size, duration, bitrate, resolution אפשר להוסיף כאן אם קיימים ב-itemData.res
      // למשל: size: itemData.res[0].$.size, duration: itemData.res[0].$.duration
    };

    // אם יש מידע נוסף על המשאב ב-itemData.res[0].$ (כמו size, duration), נוסיף אותו
    if (itemData.res && Array.isArray(itemData.res) && itemData.res[0] && itemData.res[0].$) {
      if (itemData.res[0].$.size) resourceObject.size = parseInt(itemData.res[0].$.size, 10);
      if (itemData.res[0].$.duration) resourceObject.duration = itemData.res[0].$.duration;
      // ניתן להוסיף עוד מאפיינים כמו bitrate, sampleFrequency, nrAudioChannels, resolution
    } else if (itemData.resources && itemData.resources[0]) {
      // טיפול במקרה שהמידע נמצא תחת itemData.resources[0]
      // (הלוגיקה הזו עשויה להזדקק להתאמה לפי מבנה הנתונים המדויק של המקור)
      if (itemData.resources[0].size) resourceObject.size = parseInt(itemData.resources[0].size, 10);
      if (itemData.resources[0].duration) resourceObject.duration = itemData.resources[0].duration;
    }


    const didlXml = createSingleItemDidlLiteXml(itemObject, resourceObject);
    return { uri: absoluteItemUrl, didlXml: didlXml, title: itemTitle };
  };

  for (let i = 0; i < videoItemsRaw.length; i++) {
    const itemData = videoItemsRaw[i];
    const processed = getItemUriAndDidl(itemData, folderObjectId, i);
    if (processed) {
      processedItems.push(processed);
    }
  }

  if (processedItems.length === 0) {
    const message = `No processable video items found in folder ${folderObjectId} on media server ${mediaServerUdn} after attempting to resolve URLs.`;
    parentLogger.warn(message);
    throw new Error(message);
  }

  parentLogger.info(`Successfully processed ${processedItems.length} video items from folder ${folderObjectId}.`);
  return processedItems;
}

/**
 * @hebrew בודק אם הרנדרר מנגן כעת מדיה.
 * @returns {Promise<boolean>} מחזיר true אם הרנדרר מנגן, אחרת false.
 * @throws {Error} אם המכשיר או השירות לא נמצאו, כדי לאפשר טיפול בשגיאות ברמה העליונה.
 */
export async function isRendererPlaying(
  rendererUdn: string,
  activeDevices: Map<string, ApiDevice>,
  parentLogger: typeof logger,
): Promise<boolean> {
  parentLogger.info(`Checking playback state for renderer ${rendererUdn}`);

  // שימוש ב-res פקטיבי שזורק שגיאה במקום לשלוח תגובה, כדי שהקורא יוכל לטפל בה
  const mockRes = createRenderMockRes(rendererUdn);

  const renderer = getValidatedDevice(rendererUdn, 'Renderer', mockRes);
  if (!renderer) {
    // למרות ש-getValidatedDevice אמור לזרוק שגיאה, נוסיף בדיקה למקרה חירום
    parentLogger.error(`getValidatedDevice returned null for UDN ${rendererUdn}, which should not happen.`);
    return false;
  }

  const avTransportService = getValidatedService(renderer, 'AVTransport', 'AVTransport', mockRes);
  if (!avTransportService) {
    // גם כאן, זו בדיקת בטיחות נוספת
    return false;
  }

  // הגדרת טיפוסים ברורים יותר עבור התוצאה הצפויה
  type GetTransportInfoResult = {
    CurrentTransportState: 'STOPPED' | 'PLAYING' | 'PAUSED_PLAYBACK' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT';
    CurrentTransportStatus: string;
    CurrentSpeed: string;
  };

  type GetTransportInfoAction = (
    args: { InstanceID: string }
  ) => Promise<GetTransportInfoResult>;

  const getTransportInfoAction =
    (renderer.serviceList.get('AVTransport')
      ?.actionList?.get('GetTransportInfo')?.invoke) as unknown as GetTransportInfoAction | undefined;

  if (!getTransportInfoAction) {
    parentLogger.warn(`Renderer ${rendererUdn} does not support GetTransportInfo action. Assuming not playing.`);
    return false;
  }

  try {

    const result = await getTransportInfoAction({ InstanceID: '0' });

    const currentState = result.CurrentTransportState;
    parentLogger.info(`Renderer ${rendererUdn} current transport state is: ${currentState}`);

    return currentState === 'PLAYING';

  } catch (error: any) {
    parentLogger.error(`Failed to get transport info from renderer ${rendererUdn}: ${error.message}`, { fault: error.soapFault });
    // במקרה של שגיאת תקשורת, נניח שהרנדרר לא מנגן כדי לא לחסום את הפעולה שלא לצורך
    return false;
  }
}
/**
 * @hebrew עוצר את הניגון הנוכחי ברנדרר.
 * @returns {Promise<boolean>} מחזיר true אם פקודת העצירה נשלחה בהצלחה, אחרת false.
 * @throws {Error} אם המכשיר או השירות לא נמצאו, מה שמאפשר טיפול בשגיאות ברמה העליונה.
 */
export async function stopRenderer(
  rendererUdn: string,
  activeDevices: Map<string, ApiDevice>,
  parentLogger: typeof logger
): Promise<boolean> {
  parentLogger.info(`Attempting to stop playback on renderer ${rendererUdn}`);

  const mockRes = createRenderMockRes(rendererUdn);

  const renderer = getValidatedDevice(rendererUdn, 'Renderer', mockRes);
  if (!renderer) {
    // getValidatedDevice יזרוק שגיאה, אבל נוסיף בדיקה למקרה חירום
    return false;
  }

  const avTransportService = getValidatedService(renderer, 'AVTransport', 'AVTransport', mockRes);
  if (!avTransportService) {
    return false;
  }

  const stopCommand = renderer.serviceList.get('AVTransport')?.actionList?.get('Stop')?.invoke;

  if (!stopCommand) {
    parentLogger.warn(`Renderer ${rendererUdn} does not support Stop action. Cannot stop playback.`);
    return false;
  }

  try {
    await retry(
      async () => {
        try {
          await stopCommand({ InstanceID: '0' });
          parentLogger.info(`Stop command sent successfully to renderer ${rendererUdn}.`);
        } catch (error: any) {
          // זורקים שגיאה כדי שמנגנון ה-retry יתפוס אותה וינסה שוב
          throw new Error(`Attempt to send Stop command failed: ${error.message}`);
        }
      },
      {
        retries: 3,
        delayMs: 10000, // 10 שניות
        logger: parentLogger,
        onRetry: (error, attempt) => {
          parentLogger.warn(`Stop command attempt ${attempt} failed for renderer ${rendererUdn}. Retrying... Error: ${error.message}`);
        },
      }
    );
    return true; // אם ה-retry הצליח
  } catch (error: any) {
    parentLogger.error(`All Stop command attempts failed for renderer ${rendererUdn}. Final error: ${error.message}`);
    return false; // אם כל ניסיונות ה-retry נכשלו
  }
}

/**
 * @hebrew מנגן רשימת פריטים מעובדים על גבי renderer נתון.
 */
export async function playProcessedItemsOnRenderer(
  rendererUdn: string,
  processedItems: ProcessedPlaylistItem[],
  activeDevices: Map<string, ApiDevice>,
  parentLogger: typeof logger
): Promise<{ success: boolean; message: string; statusCode?: number }> {
  parentLogger.info(`Attempting to play ${processedItems.length} items on renderer ${rendererUdn}`);

  // ולידציה של ה-renderer ושירות ה-AVTransport שלו
  // שימוש ב-res פקטיבי כי הפונקציה הזו לא אמורה לשלוח תגובת HTTP ישירות אלא לזרוק שגיאה או להחזיר תוצאה
  const mockRes = createRenderMockRes(rendererUdn);

  const renderer = getValidatedDevice(rendererUdn, 'Renderer', mockRes);
  if (!renderer) { // בדיקה נוספת, למרות ש-getValidatedDevice אמור לזרוק
    const message = `Renderer with UDN ${rendererUdn} not found or invalid for playback.`;
    parentLogger.warn(message);
    return { success: false, message, statusCode: 404 };
  }

  const avTransportService = getValidatedService(renderer, 'AVTransport', 'AVTransport', mockRes);
  if (!avTransportService) { // בדיקה נוספת
    const message = `AVTransport service not found or invalid for renderer ${rendererUdn}.`;
    parentLogger.warn(message);
    return { success: false, message, statusCode: 404 };
  }

  if (processedItems.length === 0) {
    const message = "No items to play.";
    parentLogger.warn(message);
    return { success: false, message, statusCode: 400 };
  }

  try {
    const firstItem = processedItems[0];
    const avTransportActionList = renderer.serviceList.get('AVTransport')?.actionList;

    const stopCommand = avTransportActionList?.get('Stop')?.invoke;
    const setMediaUriCommand = avTransportActionList?.get('SetAVTransportURI')?.invoke;
    const playMediaCommand = avTransportActionList?.get('Play')?.invoke;

    if (!stopCommand || !setMediaUriCommand || !playMediaCommand) {
      const missingActions = [
        !stopCommand ? 'Stop' : null,
        !setMediaUriCommand ? 'SetAVTransportURI' : null,
        !playMediaCommand ? 'Play' : null,
      ].filter(Boolean).join(', ');
      const message = `Renderer ${rendererUdn} is missing required AVTransport actions: ${missingActions}. Cannot initiate playback.`;
      parentLogger.error(message);
      return { success: false, message, statusCode: 501 };
    }

    parentLogger.debug(`Attempting to stop playback on renderer ${renderer.UDN}...`);
    try {
      await stopCommand({ InstanceID: '0' });
      parentLogger.info(`Stop command successful for renderer ${renderer.UDN}.`);
    } catch (error: any) {
      parentLogger.warn(`Error or warning sending Stop command for renderer ${renderer.UDN}: ${error.message}`, { fault: error.soapFault });
      // ממשיכים בכל מקרה, כפי שהיה בלוגיקה של stopPlayback המקורית
    }

    parentLogger.debug(`Attempting SetAVTransportURI on renderer ${renderer.UDN} with URI: ${firstItem.uri} and MetaData length: ${firstItem.didlXml.length}`);
    await setMediaUriCommand({
      InstanceID: '0',
      CurrentURI: firstItem.uri,
      CurrentURIMetaData: firstItem.didlXml,
    });
    parentLogger.info(`SetAVTransportURI successful for renderer ${renderer.UDN}.`);

    parentLogger.debug(`Attempting Play action on renderer ${renderer.UDN}.`);
    await playMediaCommand({
      InstanceID: '0',
      Speed: '1',
    });
    parentLogger.info(`Play command successful for renderer ${renderer.UDN}.`);
    parentLogger.info(`Playback started for first item: ${firstItem.title} on renderer ${renderer.friendlyName}`);

    if (processedItems.length > 1) {
      const setNextMediaUriCommand = avTransportActionList?.get('SetNextAVTransportURI')?.invoke;
      if (setNextMediaUriCommand) {
        for (let i = 1; i < processedItems.length; i++) {
          const nextItem = processedItems[i];
          try {
            parentLogger.debug(`Attempting SetNextAVTransportURI on renderer ${renderer.UDN} with NextURI: ${nextItem.uri} and NextMetaData length: ${nextItem.didlXml.length}`);
            await setNextMediaUriCommand({
              InstanceID: '0',
              NextURI: nextItem.uri,
              NextURIMetaData: nextItem.didlXml,
            });
            parentLogger.info(`Added to playlist: ${nextItem.title}`);
          } catch (playlistError: any) {
            parentLogger.warn(`Error adding item '${nextItem.title}' to playlist: ${playlistError.message}`);
            // לא נכשל את כל הפעולה בגלל פריט בודד בפלייליסט
          }
        }
      } else {
        parentLogger.warn(`SetNextAVTransportURI action not found or not invokable on renderer ${renderer.UDN}. Cannot add subsequent items to playlist.`);
      }
    }
    return { success: true, message: `Playback initiated on ${renderer.friendlyName} for ${processedItems.length} items.` };

  } catch (error: any) {
    parentLogger.error(`Error during playback on renderer ${rendererUdn}:`, error);
    const statusCode = (error.soapFault && error.soapFault.upnpErrorCode) ? 502 : (error.statusCode || 500);
    const message = error.message || "An unexpected error occurred during playback.";
    return { success: false, message, statusCode };
  }
}


interface PlayRequestParams {
  rendererUdn: string;
}

interface PlayRequestBody {
  mediaServerUdn: string; // UDN של שרת המדיה
  objectID: string;       // ID של הפריט בשרת המדיה
}

interface PlayFolderRequestBody { // שם הממשק הוחזר למקורי
  mediaServerUdn: string; // UDN של שרת המדיה
  folderObjectID: string;   // ID של התיקייה בשרת המדיה
}

// פונקציית xmlEscape הוסרה מכיוון ש-xmlbuilder2 (המשמשת ב-createSingleItemDidlLiteXml) מטפלת בזה.

// Helper function to get and validate a device
function getValidatedDevice(
  udn: string,
  deviceType: 'Renderer' | 'Media Server',
  res: Response
): ApiDevice | null {
  const currentActiveDevices = getActiveDevices();
  const device = currentActiveDevices.get(udn);

  if (!device) {
    logger.warn(`Request failed: ${deviceType} with UDN ${udn} not found.`);
    res.status(404).send({ error: `${deviceType} with UDN ${udn} not found` });
    return null;
  }
  if (!device.serviceList || !device.baseURL) {
    logger.warn(`Request failed: ${deviceType} ${udn} is missing serviceList or baseURL.`);
    res.status(500).send({ error: `${deviceType} ${udn} is missing essential information (serviceList or baseURL).` });
    return null;
  }
  logger.debug(`Found ${deviceType.toLowerCase()}: ${device.friendlyName} (UDN: ${udn})`);
  return device;
}

// Helper function to get and validate a service from a device
function getValidatedService(
  device: ApiDevice,
  serviceTypeIdentifier: string,
  serviceFriendlyName: 'ContentDirectory' | 'AVTransport',
  res: Response
): ServiceDescription | null {
  const servicesArray = Array.from(device.serviceList!.values()); // Added non-null assertion
  const service = servicesArray.find(
    (s: ServiceDescription) => s.serviceType?.includes(`urn:schemas-upnp-org:service:${serviceTypeIdentifier}`) || s.serviceId?.includes(`urn:upnp-org:serviceId:${serviceTypeIdentifier}`)
  );

  if (!service || !service.controlURL || !service.serviceType) {
    logger.warn(`Request failed: ${serviceFriendlyName} service, controlURL, or serviceType not found for device ${device.UDN}.`);
    res.status(404).send({ error: `${serviceFriendlyName} service, controlURL, or serviceType not found for device ${device.UDN}` });
    return null;
  }
  logger.debug(`Found ${serviceFriendlyName} service for device ${device.UDN}: ${service.serviceId}`);
  return service;
}

// פונקציות העזר stopPlayback, setAvTransportUri, startPlayback, setNextAvTransportUri ו-executePlaybackCommands הוסרו
// מכיוון שהלוגיקה שלהן שולבה ישירות ב-playProcessedItemsOnRenderer וב-route handler /:rendererUdn/play.

export function createRendererHandler(activeDevices: Map<string, ApiDevice>): Router {
  const router = Router();

  router.post(
    '/:rendererUdn/play',
    async (req: Request<PlayRequestParams, any, PlayRequestBody>, res: Response, next: NextFunction) => {
      const { rendererUdn } = req.params;
      const { mediaServerUdn, objectID } = req.body;

      logger.info(`Received play request for renderer UDN: ${rendererUdn}, mediaServer UDN: ${mediaServerUdn}, objectID: ${objectID}`);

      if (!mediaServerUdn || !objectID) {
        logger.warn('Play request failed: mediaServerUdn or objectID is missing.');
        res.status(400).send({ error: 'mediaServerUdn and objectID are required' });
        return;
      }

      const renderer = getValidatedDevice(rendererUdn, 'Renderer', res);
      if (!renderer) return;

      const mediaServer = getValidatedDevice(mediaServerUdn, 'Media Server', res);
      if (!mediaServer) return;

      const cdServiceDescriptionOriginal = getValidatedService(mediaServer, 'ContentDirectory', 'ContentDirectory', res);
      if (!cdServiceDescriptionOriginal) return;

      let itemMetadataXml: string = "";
      let itemUrl: string = "";
      let itemTitleForPlayback: string = objectID; // ערך ברירת מחדל אם לא נמצא title

      try {
        const absoluteCdControlURL = new URL(cdServiceDescriptionOriginal.controlURL, mediaServer.baseURL).href;
        const cdServiceForBrowse: ServiceDescription = {
          ...cdServiceDescriptionOriginal,
          controlURL: absoluteCdControlURL
        };

        const cds = new ContentDirectoryService(cdServiceForBrowse);
        const browseResult = await cds.browse(objectID, BrowseFlag.BrowseMetadata, '*', 0, 1);

        if (!browseResult || browseResult.numberReturned === 0 || !browseResult.items || browseResult.items.length === 0) {
          logger.warn(`Play request failed: Object with ID ${objectID} not found on media server ${mediaServerUdn}.`);
          res.status(404).send({ error: `Object with ID ${objectID} not found on media server ${mediaServerUdn}` });
          return;
        }

        const itemData = browseResult.items[0] as any; // itemData מוגדר כאן
        itemTitleForPlayback = itemData.title || itemData['dc:title'] || objectID; // עדכון itemTitleForPlayback

        if (itemData.resources && itemData.resources[0] && itemData.resources[0].uri) {
          itemUrl = itemData.resources[0].uri;
        } else if (itemData.res && typeof itemData.res === 'string') {
          itemUrl = itemData.res;
        } else if (itemData.res && Array.isArray(itemData.res) && itemData.res[0] && typeof itemData.res[0]._ === 'string') {
          itemUrl = itemData.res[0]._;
        } else {
          logger.warn(`Play request failed: Could not find resource URI for objectID ${objectID} on media server ${mediaServerUdn}. Item data: ${JSON.stringify(itemData)}`);
          res.status(404).send({ error: `Resource URI not found for objectID ${objectID}` });
          return;
        }

        if (itemUrl && !itemUrl.startsWith('http://') && !itemUrl.startsWith('https://')) {
          itemUrl = new URL(itemUrl, mediaServer.baseURL).toString();
        }

        // Extract or build DIDL-Lite XML
        if (browseResult.rawResponse && typeof browseResult.rawResponse.Result === 'string') {
          const didlResultString = browseResult.rawResponse.Result;
          // Attempt to extract the <item> ... </item> XML directly
          const itemMatch = didlResultString.match(/<item[\s\S]*?<\/item>/i); // חיפוש אחר התג עם ישויות XML

          if (itemMatch && itemMatch[0]) {
            // Check if the result is already a full DIDL-Lite
            if (didlResultString.toLowerCase().includes('<didl-lite')) {
              itemMetadataXml = didlResultString
                .replace(/</g, '<')
                .replace(/>/g, '>')
                .replace(/"/g, '"')
                .replace(/'/g, "'")
                .replace(/&/g, '&'); // החלפת ישויות XML חזרה לתווים
            } else if (itemData) { // אם יש לנו itemData (שחולץ מ-browseResult.items[0]), נשתמש בו לבנות את ה-XML המלא
              logger.info(`Extracted <item> XML from raw response, but not full DIDL-Lite. Rebuilding with createSingleItemDidlLiteXml for ${objectID}`);
              const itemDetails: DidlLiteObject = {
                id: objectID,
                parentId: itemData.parentId || '-1',
                restricted: true, // הנחה סבירה, ניתן להתאים אם יש מידע אחר
                title: itemData.title || itemData['dc:title'] || 'Video Item',
                class: itemData.class || itemData['upnp:class'] || 'object.item.videoItem',
              };
              const resourceDetails: Resource = {
                uri: itemUrl, // itemUrl כבר חושב והפך לאבסולוטי
                protocolInfo: (itemData.resources && itemData.resources[0] && itemData.resources[0].protocolInfo) ||
                  (itemData.res && itemData.res[0] && itemData.res[0].$ && itemData.res[0].$.protocolInfo) ||
                  "http-get:*:video/*:*", // ערך ברירת מחדל
              };
              // הוספת פרטים נוספים למשאב אם קיימים
              if (itemData.res) {
                if (Array.isArray(itemData.res) && itemData.res[0] && itemData.res[0].$) {
                  if (itemData.res[0].$.size) resourceDetails.size = parseInt(itemData.res[0].$.size, 10);
                  if (itemData.res[0].$.duration) resourceDetails.duration = itemData.res[0].$.duration;
                }
              } else if (itemData.resources && itemData.resources[0]) {
                if (itemData.resources[0].size) resourceDetails.size = parseInt(itemData.resources[0].size, 10);
                if (itemData.resources[0].duration) resourceDetails.duration = itemData.resources[0].duration;
              }
              itemMetadataXml = createSingleItemDidlLiteXml(itemDetails, resourceDetails);
            } else {
              // מקרה קצה: הצלחנו לחלץ extractedItemXml אבל אין itemData זמין (לא אמור לקרות אם itemMatch הצליח ו-browseResult.items[0] קיים)
              // במקרה כזה, אין לנו מספיק מידע לבנות DIDL-Lite תקין עם הפונקציה.
              // נשאיר אזהרה ונמנע מיצירת XML שגוי.
              const extractedItemXmlForLog = itemMatch[0].replace(/</g, '<').replace(/>/g, '>'); // ללוג בלבד
              logger.warn(`Could not rebuild full DIDL-Lite for ${objectID} as itemData was not available, though <item> XML was extracted. extractedItemXml (first 200 chars): ${extractedItemXmlForLog.substring(0, 200)}`);
              // itemMetadataXml יישאר ריק, והלוגיקה בהמשך תטפל בזה.
            }
          } else {
            logger.warn(`Could not extract <item> XML from browse result for ${objectID}. DIDL Result (first 500 chars): ${didlResultString.substring(0, 500)}`);
          }
        } else {
          logger.warn(`Raw XML result (browseResult.rawResponse.Result) not found or not a string in browseResult for ${objectID}.`);
        }

        if (!itemMetadataXml && itemData) { // itemData זמין כאן מה-browseResult
          logger.info(`Attempting to build fallback DIDL-Lite for ${objectID} using createSingleItemDidlLiteXml (second attempt if raw parsing failed)`);

          const itemDetails: DidlLiteObject = {
            id: objectID,
            parentId: itemData.parentId || '-1', // parentID עשוי להיות זמין ב-itemData
            restricted: true, // הנחה סבירה
            title: itemData.title || itemData['dc:title'] || 'Video Item', // שימוש ב-title מ-itemData אם קיים
            class: itemData.class || itemData['upnp:class'] || 'object.item.videoItem',
          };

          const resourceDetails: Resource = {
            uri: itemUrl,
            protocolInfo: (itemData.resources && itemData.resources[0] && itemData.resources[0].protocolInfo) ||
              (itemData.res && itemData.res[0] && itemData.res[0].$ && itemData.res[0].$.protocolInfo) ||
              "http-get:*:video/*:*",
          };

          // לוגיקה דומה לזו שב-getFolderItemsFromMediaServer להוספת פרטי משאב
          if (itemData.res) {
            if (Array.isArray(itemData.res) && itemData.res[0] && itemData.res[0].$) {
              if (itemData.res[0].$.size) resourceDetails.size = parseInt(itemData.res[0].$.size, 10);
              if (itemData.res[0].$.duration) resourceDetails.duration = itemData.res[0].$.duration;
            }
          } else if (itemData.resources && itemData.resources[0]) {
            if (itemData.resources[0].size) resourceDetails.size = parseInt(itemData.resources[0].size, 10);
            if (itemData.resources[0].duration) resourceDetails.duration = itemData.resources[0].duration;
          }

          itemMetadataXml = createSingleItemDidlLiteXml(itemDetails, resourceDetails);
          logger.debug(`Fallback DIDL-Lite generated using util (second attempt): ${itemMetadataXml}`);
        }

        logger.debug(`Using Item URL: ${itemUrl}, Item Metadata XML length: ${itemMetadataXml.length}`);
        if (itemMetadataXml.length === 0) {
          logger.warn(`itemMetadataXml is empty for objectID ${objectID}. Playback might fail or lack metadata on the renderer.`);
          // Consider not sending empty metadata or sending a specific minimal structure if required by AVTransport.
          // For now, we allow sending it empty as some renderers might handle it or only need CurrentURI.
        }

      } catch (error: any) {
        logger.error(`Failed to browse media server ${mediaServerUdn} for objectID ${objectID}:`, error);
        next(error);
        return;
      }

      if (!itemUrl) {
        logger.error(`Failed to determine itemUrl for objectID ${objectID} on media server ${mediaServerUdn}.`);
        res.status(500).send({ error: `Could not determine media URL for item ${objectID}` });
        return;
      }

      const singleProcessedItem: ProcessedPlaylistItem = {
        uri: itemUrl,
        didlXml: itemMetadataXml,
        title: itemTitleForPlayback // שימוש במשתנה שהוגדר בהיקף הנכון
      };

      try {
        const result = await playProcessedItemsOnRenderer(
          renderer.UDN,
          [singleProcessedItem],
          activeDevices,
          logger
        );

        if (result.success) {
          res.status(200).send({ success: true, message: result.message });
        } else {
          res.status(result.statusCode || 500).send({ error: result.message });
        }
      } catch (error: any) {
        logger.error(`Error in /play route for renderer ${rendererUdn}, item ${objectID}:`, error);
        if (!res.headersSent) {
          const statusCode = error.statusCode || (error.soapFault && error.soapFault.upnpErrorCode ? 502 : 500);
          const message = error.message || "An unexpected error occurred during single item playback.";
          res.status(statusCode).send({ error: message });
        }
      }
    }
  );

  /*
  router.post(
    '/:rendererUdn/play-folder', // נתיב הוחזר למקורי
    async (req: Request<PlayRequestParams, any, PlayFolderRequestBody>, res: Response, next: NextFunction) => { // שימוש בטיפוס המקורי לגוף הבקשה
      const { rendererUdn } = req.params;
      const { mediaServerUdn, folderObjectID } = req.body; // שימוש ישיר ב-folderObjectID

      logger.info(`Received play-folder request for renderer UDN: ${rendererUdn}, mediaServer UDN: ${mediaServerUdn}, folderObjectID: ${folderObjectID}`);

      if (!mediaServerUdn || !folderObjectID) {
        logger.warn('Play-folder request failed: mediaServerUdn or folderObjectID is missing.');
        res.status(400).send({ error: 'mediaServerUdn and folderObjectID are required' });
        return;
      }


      const renderer = getValidatedDevice(rendererUdn, 'Renderer', activeDevices, res);
      if (!renderer) return;

      const mediaServer = getValidatedDevice(mediaServerUdn, 'Media Server', activeDevices, res);
      if (!mediaServer) return;

      const cdServiceDescriptionOriginal = getValidatedService(mediaServer, 'ContentDirectory', 'ContentDirectory', res);
      if (!cdServiceDescriptionOriginal) return;
      const avTransportService = getValidatedService(renderer, 'AVTransport', 'AVTransport', res);
      if (!avTransportService) return; // זה כבר אמור להיות מטופל על ידי getValidatedService אבל נשאר לבטיחות

      // TODO: יש לעדכן את הלוגיקה כאן כדי להשתמש בפונקציות החדשות:
      // 1. קריאה ל-getFolderItemsFromMediaServer(mediaServerUdn, folderObjectID, activeDevices, logger)
      // 2. אם הצליח, קריאה ל-playProcessedItemsOnRenderer(rendererUdn, items, activeDevices, logger)
      // כרגע, הקוד הישן שהשתמש ב-playFolderOnRenderer הוסר.
      logger.warn(`Route /:rendererUdn/play-folder is temporarily disabled pending refactor to use new playback functions.`);
      res.status(501).json({ error: 'This endpoint is temporarily disabled and needs to be updated.' });
      
      // try {
      //   // העברנו את הלוגר של המודול הזה, מכיוון שזה הקונטקסט של ה-route handler הזה
      //   const result = await playFolderOnRenderer(rendererUdn, mediaServerUdn, folderObjectID, activeDevices, logger);
      //   if (result.success) {
      //     res.status(200).send({ success: true, message: result.message });
      //   } else {
      //     res.status(result.statusCode || 500).send({ error: result.message });
      //   }
      // } catch (error: any) {
      //   // שגיאות שנזרקו על ידי getValidatedDevice (דרך ה-mock של res) יתפסו כאן
      //   if (error.statusCode && error.body) {
      //     logger.error(`Play-folder: Validation error for UDNs ${rendererUdn}/${mediaServerUdn}:`, error.body);
      //     res.status(error.statusCode).send(error.body);
      //   } else {
      //     logger.error(`Play-folder: General error processing folder ${folderObjectID} on media server ${mediaServerUdn} for renderer ${rendererUdn}:`, error);
      //     if (!res.headersSent) {
      //       const statusCode = (error.soapFault && error.soapFault.upnpErrorCode) ? 502 : (error.statusCode || 500);
      //       next({ ...error, statusCode }); // מעבירים את השגיאה ל-middleware הכללי עם הסטטוס קוד הנכון
      //     }
      //   }
      // }
    }
  );
  */

  return router;
}
