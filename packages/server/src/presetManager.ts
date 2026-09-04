// קובץ זה מכיל פונקציות לניהול הגדרות הפריסטים
import * as fs from 'fs/promises';
import * as path from 'path';
import * as url from "url";
import type { Request, Response, NextFunction } from 'express'; // הוספת ייבואים נדרשים
import { createModuleLogger } from './logger';

import type {
  DeviceDescription, // הוספת ייבוא
  DeviceWithServicesDescription, // הוספת ייבוא
  FullDeviceDescription, // הוספת ייבוא
} from 'dlna.js';

import { AllPresetSettings, PresetSettings, PresetEntry, RendererPreset, ApiDevice } from './types'; // ייבוא הטיפוסים הרלוונטיים, כולל PresetEntry ו-RendererPreset
import { sendWakeOnLan, wakeDeviceAndVerify } from 'wake-on-lan'; // שינוי: הוספת wakeDeviceAndVerify והסרת checkPingWithRetries
import { getFolderItemsFromMediaServer, playProcessedItemsOnRenderer, ProcessedPlaylistItem } from './rendererHandler'; // ייבוא הפונקציות החדשות
import { executePlayPresetLogic, PlaybackError } from './playPresetHandler'; // ייבוא מהקובץ החדש
const logger = createModuleLogger('PresetManager'); // הגדרת לוגר למודול

if (!__dirname) {
  // @ts-ignore
  const filePathUrl = import.meta.url; // המרת import.meta.url לנתיב קובץ רגיל
  const filePath = url.fileURLToPath(filePathUrl); // המרת URL לקובץ לנתיב קובץ רגיל
  
  const dirname = path.dirname(filePath); 
  __dirname = dirname; 
}
const PRESETS_FILE_PATH = path.join(__dirname, '..', '..','..', 'data', 'presets.json'); // process.cwd() הוא packages/server, לכן עולים שתי רמות (../../) לשורש הפרויקט, ואז נכנסים ל-data

/**
 * @hebrew טוען את הגדרות הפריסט מקובץ ה-JSON וממיר אותן למערך.
 * @returns {Promise<AllPresetSettings>} אובייקט של כל הפריסטים. אם הקובץ לא קיים או לא תקין, מחזיר אובייקט ריק.
 */
export async function loadPresets(): Promise<AllPresetSettings> {
  try {
    // בדיקה אם הקובץ קיים
    await fs.access(PRESETS_FILE_PATH);
    const data = await fs.readFile(PRESETS_FILE_PATH, 'utf-8');
    if (!data.trim()) {
      // אם הקובץ ריק, החזר אובייקט ריק
      return {};
    }
    // ניתוח ה-JSON
    const presetsObject = JSON.parse(data) as AllPresetSettings;
    return presetsObject;
  } catch (error: any) {
    // אם הקובץ לא קיים (ENOENT) או שיש שגיאה אחרת בקריאה/ניתוח, החזר אובייקט ריק
    if (error.code === 'ENOENT') {
      // אם הקובץ לא קיים, ניצור אותו עם אובייקט ריק בפעם הבאה שישמרו הגדרות
      // או שנחזיר אובייקט ריק כפי שנדרש
      return {};
    }
    logger.error('Error loading presets:', error); // שימוש בלוגר במקום console.error
    // במקרה של שגיאת JSON או שגיאה אחרת, החזר אובייקט ריק כדי למנוע קריסה
    return {};
  }
}

/**
 * @hebrew שומר את כלל הגדרות הפריסט הנתונות לקובץ ה-JSON.
 * @param {AllPresetSettings} settings - אובייקט כלל ההגדרות לשמירה.
 * @returns {Promise<void>}
 */
export async function savePresets(settings: AllPresetSettings): Promise<void> {
  try {
    const data = JSON.stringify(settings, null, 2); // עיצוב ה-JSON עם הזחה לקריאות
    const directoryPath = path.dirname(PRESETS_FILE_PATH); // קבלת הנתיב לתיקייה
    await fs.mkdir(directoryPath, { recursive: true }); // יצירת התיקייה אם היא לא קיימת
    await fs.writeFile(PRESETS_FILE_PATH, data, 'utf-8');
  } catch (error) {
    logger.error('Error saving presets:', error); // שימוש בלוגר במקום console.error
    // ניתן להוסיף כאן טיפול בשגיאות מתקדם יותר אם נדרש, כגון זריקת שגיאה מותאמת אישית
    throw error; // זרוק את השגיאה כדי שהקוד הקורא יוכל לטפל בה
  }
}

/**
 * @hebrew מטפל בבקשת GET לקבלת כל הפריסטים.
 */
export async function handleGetPresets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const presetsObject = await loadPresets();
    // המרה של אובייקט הפריסטים למערך של פריסטים עבור הלקוח
    const presetsArray: PresetEntry[] = Object.keys(presetsObject).map(presetName => {
      return {
        name: presetName,
        settings: presetsObject[presetName]
      };
    });
    res.json(presetsArray);
  } catch (error) {
    logger.error('Error in handleGetPresets:', error); // שימוש בלוגר המקומי
    // העבר את השגיאה ל-middleware הכללי לטיפול בשגיאות
    next(error);
  }
}

/**
 * @hebrew מטפל בבקשת DELETE למחיקת פריסט.
 */
export async function handleDeletePreset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name: presetNameToDelete } = req.body;

    if (!presetNameToDelete || typeof presetNameToDelete !== 'string') {
      logger.warn('Preset name not provided or invalid for deletion.');
      res.status(400).json({ error: 'Preset name (string) is required in the request body for deletion.' });
      return;
    }

    logger.info(`Received request to delete preset: ${presetNameToDelete}`);

    const allPresetsObject = await loadPresets();

    if (!allPresetsObject.hasOwnProperty(presetNameToDelete)) {
      logger.warn(`Preset with name '${presetNameToDelete}' not found for deletion.`);
      res.status(404).json({ error: `Preset with name '${presetNameToDelete}' not found.` });
      return;
    }

    delete allPresetsObject[presetNameToDelete];

    await savePresets(allPresetsObject);
    logger.info(`Preset '${presetNameToDelete}' deleted successfully.`);
    res.status(200).json({ message: `Preset '${presetNameToDelete}' deleted successfully.` });

  } catch (error) {
    logger.error('Error in handleDeletePreset:', error); // שימוש בלוגר המקומי
    next(error); // העבר ל-middleware הכללי לטיפול בשגיאות
  }
}

/**
 * @hebrew מטפל בבקשת POST לשליחת Wake on LAN לפריסט ספציפי.
 */
export async function handleWakePreset(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { presetName } = req.params;
  logger.info(`Received WOL request for preset: ${presetName}`);

  try {
    const allPresetsObject = await loadPresets(); // טעינת כל הפריסטים כאובייקט
    // חיפוש הפריסט הספציפי באובייקט
    const presetDetails: PresetSettings | undefined = allPresetsObject[presetName];

    if (!presetDetails) {
      logger.warn(`Preset with name '${presetName}' not found for WOL request.`);
      res.status(404).json({ error: `Preset with name '${presetName}' not found.` });
      return;
    }

    // בדיקה אם לפריסט יש הגדרות renderer וכתובת MAC
    const rendererInfo: RendererPreset | null | undefined = presetDetails.renderer;

    if (!rendererInfo || !rendererInfo.macAddress || !rendererInfo.broadcastAddress) {
      logger.warn(`Preset '${presetName}' does not have a renderer with a MAC address or broadcast address.`);
      res.status(400).json({ error: `Preset '${presetName}' is not configured with a Renderer MAC address and broadcast address for Wake on LAN.` });
      return;
    }

    const macAddress = rendererInfo.macAddress;
    const broadcastAddress = rendererInfo.broadcastAddress; // קבלת כתובת השידור

    logger.info(`Attempting to send Wake on LAN to preset '${presetName}' (MAC: ${macAddress}, Broadcast: ${broadcastAddress})`);

    await sendWakeOnLan(macAddress, broadcastAddress); // שימוש בכתובת השידור

    logger.info(`Successfully sent Wake on LAN packet to MAC address: ${macAddress} (Broadcast: ${broadcastAddress}) for preset '${presetName}'.`);
    res.status(200).json({ message: `Wake on LAN signal sent successfully to preset '${presetName}'.` });

  } catch (error: any) {
    logger.error(`Error sending Wake on LAN for preset '${presetName}': ${error.message}`, error);

    if (error.message && error.message.toLowerCase().includes('invalid mac address')) {
      res.status(400).json({ error: `Invalid MAC address format for preset '${presetName}'. Details: ${error.message}` });
      return;
    }
    if (error.message && error.message.toLowerCase().includes('failed to send wol packet')) {
      res.status(500).json({ error: `Failed to send WoL packet for preset '${presetName}'. Details: ${error.message}` });
      return;
    }
    next(error);
  }
}

/**
 * @hebrew מטפל בבקשת POST לשמירת פריסט חדש או עדכון פריסט קיים.
 */
export async function handlePostPreset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const newOrUpdatedPresetEntry = req.body as PresetEntry; // הלקוח שולח PresetEntry בודד

    if (!newOrUpdatedPresetEntry || !newOrUpdatedPresetEntry.name || !newOrUpdatedPresetEntry.settings) {
      logger.error('Invalid preset data received for saving.');
      res.status(400).json({ error: 'Invalid preset data. "name" and "settings" are required.' });
      return;
    }

    // 1. טען את כל הפריסטים הקיימים כאובייקט
    const allPresetsObject = await loadPresets();

    // 2. עדכן/הוסף את הפריסט החדש לאובייקט
    allPresetsObject[newOrUpdatedPresetEntry.name] = newOrUpdatedPresetEntry.settings;

    // 3. שמור את האובייקט המעודכן
    await savePresets(allPresetsObject);
    res.status(200).json({ message: `Preset '${newOrUpdatedPresetEntry.name}' saved successfully.` });
  } catch (error) {
    logger.error('Error in handlePostPreset:', error); // שימוש בלוגר המקומי
    // העבר את השגיאה ל-middleware הכללי לטיפול בשגיאות
    next(error);
  }
}

// פונקציית executePlayPresetLogic הועברה לקובץ playPresetHandler.ts

// מפה לאחסון חותמות זמן של ריצות אחרונות של פריסטים
const presetLastRun = new Map<string, number>();
const PRESET_RUN_COOLDOWN_MS = 60000; // 60 שניות

/**
 * @hebrew מטפל בבקשת GET להפעלת פריסט (באמצעות path parameter).
 */
export async function handlePlayPresetByParam(
  req: Request,
  res: Response,
  next: NextFunction,
  activeDevices: Map<string, ApiDevice>
  // updateDeviceListCallback הוסר
): Promise<void> {
  logger.info('Received request for /api/play-preset/:presetName (param)');
  const { presetName } = req.params;

  if (!presetName) {
    logger.warn('Preset name not provided in path parameters for /api/play-preset/:presetName.');
    res.status(400).json({ error: "Preset name is required as a path parameter." });
    return;
  }

  // בדיקה אם הפריסט הורץ בתקופת הצינון
  const lastRunTimestamp = presetLastRun.get(presetName);
  const now = Date.now();
  if (lastRunTimestamp && (now - lastRunTimestamp < PRESET_RUN_COOLDOWN_MS)) {
    const timeLeft = Math.round((PRESET_RUN_COOLDOWN_MS - (now - lastRunTimestamp)) / 1000);
    const errorMessage = `Preset '${presetName}' was run recently. Please wait ${timeLeft} seconds before running it again.`;
    logger.warn(errorMessage);
    res.status(429).json({ error: errorMessage }); // 429 Too Many Requests
    return;
  }

  try {
    const allPresetsObject = await loadPresets();
    const presetSettings = allPresetsObject[presetName];

    if (!presetSettings) {
      logger.warn(`Preset with name '${presetName}' not found.`);
      res.status(404).json({ error: `Preset with name '${presetName}' not found.` });
      return;
    }

    // כאן אפשר להוסיף בדיקת שלמות בסיסית לפריסט אם רוצים,
    // למרות ש-executePlayPresetLogic גם בודק זאת.
    // לדוגמה:
    // if (!presetSettings.renderer?.udn || !presetSettings.mediaServer?.udn) {
    //   logger.error(`Preset '${presetName}' is critically incomplete.`);
    //   res.status(400).json({ error: `Preset '${presetName}' is critically incomplete.` });
    //   return;
    // }

    // עדכון חותמת הזמן לפני הריצה
    presetLastRun.set(presetName, now);

    const result = await executePlayPresetLogic(
      presetName,
      presetSettings,
      activeDevices
      // updateDeviceListCallback הוסר
    );

    // executePlayPresetLogic אמור להחזיר אובייקט הצלחה אם הכל תקין
    logger.info(`Preset '${presetName}' playback command successful: ${result.message}`);
    res.status(200).json(result); // result הוא { success: true, message: "..." }

  } catch (error: any) {
    logger.error(`Error processing play-preset for '${presetName}': ${error.message}`, error);
    if (error instanceof PlaybackError && error.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      // שגיאה לא צפויה או שלא הוגדר לה statusCode
      res.status(500).json({ error: error.message || 'An unexpected error occurred during preset playback.' });
      // אפשר גם להשתמש ב-next(error) אם יש טיפול שגיאות גלובלי מורכב יותר
    }
  }
}