import { Request, Response, NextFunction } from 'express';
import { createModuleLogger } from './logger';
import {
  ContentDirectoryService, BrowseFlag,
  BrowseResult, ServiceDescription
} from 'dlna.js';
import type { ApiDevice } from './types'; // ייבוא ישירות מ-types.ts

const logger = createModuleLogger('BrowseHandler');

export const handleBrowseRequest = async (req: Request, res: Response, next: NextFunction, activeDevices: Map<string, ApiDevice>) => {
  const { udn } = req.params;
  const {
    ObjectID = '0', // ברירת מחדל לשורש
    BrowseFlag: browseFlagParam = 'BrowseDirectChildren', // שינוי שם המשתנה כדי לא להתנגש עם ה-enum
    Filter = '*',
    StartingIndex = 0,
    RequestedCount = 0, // 0 בדרך כלל אומר "הכל"
    SortCriteria = ''
  } = req.body;

  // ולידציה עבור BrowseFlag
  if (!Object.values(BrowseFlag).includes(browseFlagParam as BrowseFlag)) {
    logger.warn(`Invalid BrowseFlag value received: ${browseFlagParam}. Valid values are: ${Object.values(BrowseFlag).join(', ')}`);
    res.status(400).json({
      error: 'Invalid BrowseFlag parameter',
      message: `Valid values for BrowseFlag are: ${Object.values(BrowseFlag).join(', ')}.`
    });
    return; // Exit after sending response
  }
  const validatedBrowseFlag = browseFlagParam as BrowseFlag; // עכשיו אפשר להשתמש בזה בבטחה

  logger.info(`Browse request for device UDN: ${udn}, ObjectID: ${ObjectID}, BrowseFlag: ${validatedBrowseFlag}`);

  const device = activeDevices.get(udn); // קבלת המכשיר מ-activeDevices

  if (!device || !device.serviceList || !device.baseURL) {
    logger.warn(`Device not found, or missing serviceList/baseURL: UDN=${udn}`);
    res.status(404).json({ error: 'Device not found or essential information (serviceList, baseURL) is missing.' });
    return; // Exit after sending response
  }

  const servicesArray = Array.from(device.serviceList.values());
  const cdServiceDescriptionOriginal = servicesArray.find(
    (service: ServiceDescription) => service.serviceType?.startsWith('urn:schemas-upnp-org:service:ContentDirectory:')
  );

  if (cdServiceDescriptionOriginal && cdServiceDescriptionOriginal.actionList) {
    logger.debug(`ActionList for ${udn} ContentDirectory:\n` + JSON.stringify(cdServiceDescriptionOriginal.actionList, null, 2));
  } else if (cdServiceDescriptionOriginal) {
    logger.warn(`ContentDirectory for ${udn} found, but actionList is missing or undefined.`);
  }


  if (!cdServiceDescriptionOriginal || !cdServiceDescriptionOriginal.controlURL || !cdServiceDescriptionOriginal.serviceType || !cdServiceDescriptionOriginal.actionList) {
    logger.warn(`ContentDirectory service not found, incomplete, or missing actionList on device: ${udn}`);
    res.status(404).json({ error: 'ContentDirectory service not found, incomplete, or missing actionList on the device.' });
    return; // Exit after sending response
  }

  try {
    // יצירת עותק של ServiceDescription עם URL-ים אבסולוטיים
    // הקונסטרקטור של ContentDirectoryService מצפה ל-controlURL אבסולוטי בתוך ה-ServiceDescription
    const absoluteControlURL = new URL(cdServiceDescriptionOriginal.controlURL, device.baseURL).href;

    // ניצור אובייקט חדש כדי לא לשנות את המקור ב-activeDevices
    const serviceDescriptionForCDS: ServiceDescription = {
      ...cdServiceDescriptionOriginal,
      controlURL: absoluteControlURL, // עדכון ה-controlURL לערך האבסולוטי
      // אם eventSubURL או SCPDURL היו נדרשים על ידי הקונסטרקטור או לוגיקה פנימית, היינו צריכים להפוך גם אותם לאבסולוטיים כאן.
      // לדוגמה:
      // eventSubURL: cdServiceDescriptionOriginal.eventSubURL ? new URL(cdServiceDescriptionOriginal.eventSubURL, device.baseURL).href : undefined,
      // SCPDURL: cdServiceDescriptionOriginal.SCPDURL ? new URL(cdServiceDescriptionOriginal.SCPDURL, device.baseURL).href : undefined,
    };

    const cdService = new ContentDirectoryService(serviceDescriptionForCDS);

    logger.info(`Attempting to browse ContentDirectory on ${device.friendlyName} (UDN: ${udn}) with ObjectID: ${ObjectID}`);

    const result: BrowseResult = await cdService.browse(
      ObjectID,
      validatedBrowseFlag, // שימוש בערך המאומת
      Filter,
      Number(StartingIndex),
      Number(RequestedCount),
      SortCriteria
    );

    // logger.info(`Browse successful for UDN: ${udn}, ObjectID: ${ObjectID}. Found ${result.items.length} items.`); // Log המקורי

    if (result && result.items && Array.isArray(result.items)) {
      logger.info(`Browse successful for UDN: ${udn}, ObjectID: ${ObjectID}. Found ${result.items.length} items. Now processing resource URLs...`);

      // Process items to ensure absolute resource URLs
      // עיבוד הפריטים כדי להבטיח כתובות URL אבסולוטיות למשאבים
      // device.baseURL is confirmed to exist at this point due to the check at line 86
      const processedItems = result.items.map((item: any) => {
        // יצירת עותק של הפריט כדי למנוע שינוי של האובייקט המקורי מהשירות
        const newItem = { ...item };
        let resourceUrl: string | undefined = undefined;

        // Prioritize resources[0].uri if available and non-empty
        // תעדוף ל-resources[0].uri אם זמין ולא ריק
        if (newItem.resources && Array.isArray(newItem.resources) && newItem.resources.length > 0 && typeof newItem.resources[0]?.uri === 'string' && newItem.resources[0].uri.length > 0) {
          resourceUrl = newItem.resources[0].uri;
        } else if (typeof newItem.res === 'string' && newItem.res.length > 0) { // Fallback to res if non-empty
          // אחרת, שימוש ב-res אם הוא לא ריק
          resourceUrl = newItem.res;
        }

        if (resourceUrl) { // At this point, resourceUrl is a non-empty string
          // Ensure the URL is absolute
          // ודא שהכתובת היא אבסולוטית
          if (!resourceUrl.startsWith('http://') && !resourceUrl.startsWith('https://')) {
            try {
              // הפיכת URL יחסי לאבסולוטי באמצעות device.baseURL
              resourceUrl = new URL(resourceUrl, device.baseURL!).href; // device.baseURL is guaranteed non-null
            } catch (e) {
              logger.warn(`Failed to construct absolute URL for resource: "${resourceUrl}" with base: "${device.baseURL}". Error: ${(e as Error).message}`);
              // אם הבנייה נכשלת, resourceUrl יוגדר כ-undefined
              resourceUrl = undefined;
            }
          }
        } else {
          // אם לא נמצא URL מקורי תקין (לא מחרוזת או מחרוזת ריקה)
          resourceUrl = undefined;
        }

        // Update the item's 'res' field and 'resources[0].uri' with the processed URL.
        // עדכון השדה 'res' של הפריט ו-'resources[0].uri' עם ה-URL המעובד.
        if (resourceUrl) {
          newItem.res = resourceUrl;
          // Also update the first resource's URI if it exists
          // כמו כן, עדכן את ה-URI של המשאב הראשון אם הוא קיים
          if (newItem.resources && Array.isArray(newItem.resources) && newItem.resources.length > 0) {
            if (newItem.resources[0]) {
              newItem.resources[0].uri = resourceUrl;
            } else {
              // This case implies resources array might have a placeholder or was constructed unexpectedly.
              // For robustness, create the resource object if it's missing but expected.
              // מקרה זה מרמז שמערך המשאבים עשוי להכיל מציין מקום או נבנה באופן לא צפוי.
              // לעמידות, ניצור את אובייקט המשאב אם הוא חסר אך צפוי.
              newItem.resources[0] = { uri: resourceUrl };
            }
          }
        } else {
          // If resourceUrl is undefined (because it wasn't found, was empty, or couldn't be made absolute),
          // the 'res' field will be deleted from the returned object.
          // אם resourceUrl הוא undefined (כי לא נמצא, היה ריק, או לא ניתן היה להפוך לאבסולוטי),
          // השדה 'res' יימחק מהאובייקט המוחזר.
          delete newItem.res;

          // Similarly, update the URI in the first resource, if it exists.
          // If resourceUrl is undefined, it means the original URL (whether from res or resources[0].uri)
          // was invalid or couldn't be made absolute. So, resources[0].uri should also reflect this.
          // באופן דומה, עדכן את ה-URI במשאב הראשון, אם הוא קיים.
          // אם resourceUrl הוא undefined, זה אומר שה-URL המקורי (בין אם מ-res או resources[0].uri)
          // לא היה תקין או לא ניתן היה להפוך לאבסולוטי. לכן, גם resources[0].uri צריך לשקף זאת.
          if (newItem.resources && Array.isArray(newItem.resources) && newItem.resources.length > 0 && newItem.resources[0]) {
            // Setting to undefined is generally better than deleting, as it preserves other potential properties of the resource object.
            // הגדרה ל-undefined עדיפה בדרך כלל על מחיקה, מכיוון שהיא משמרת מאפיינים פוטנציאליים אחרים של אובייקט המשאב.
            newItem.resources[0].uri = undefined;
          }
        }

        return newItem;
      });

      result.items = processedItems; // עדכון התוצאה עם הפריטים המעובדים
      logger.info(`Finished processing resource URLs. Returning ${result.items.length} items for UDN: ${udn}, ObjectID: ${ObjectID}.`);
    } else {
      const itemsCount = (result && result.items && Array.isArray(result.items)) ? result.items.length : 0;
      logger.info(`Browse successful for UDN: ${udn}, ObjectID: ${ObjectID}. Found ${itemsCount} items. No URL processing needed or possible.`);
    }

    res.json(result);
  } catch (error) {
    logger.error(`Error browsing ContentDirectory for device ${udn}, ObjectID: ${ObjectID}:`, error);
    // במקום לשלוח תגובה ישירות, נעביר את השגיאה ל-middleware הכללי
    // כדי לשמור על עקביות ולהימנע מבעיות עם חתימת הפונקציה האסינכרונית.
    // אם רוצים טיפול שגיאות ספציפי ל-route הזה, אפשר לעשות זאת כאן,
    // אך יש לוודא שהפונקציה לא מחזירה את res.status().json()
    // res.status(500).json({ error: 'Failed to browse ContentDirectory', details: (error as Error).message });
    next(error); // העברת השגיאה ל-middleware הבא
  }
};