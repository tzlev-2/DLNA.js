// קובץ זה מכיל את לוגיקת עיבוד וחקר התקני UPnP
import axios from 'axios';
import * as xml2js from 'xml2js';
import * as arp from "node-arp";
import { promisify } from "node:util";
import type {
  BasicSsdpDevice,
  DeviceDescription,
  ServiceDescription,
  DeviceIcon,
  Action,
  ActionArgument,
  StateVariable,
  ProcessedDevice,
  DeviceWithServicesDescription,
  FullDeviceDescription,
} from './types'; // ודא נתיב נכון
import { DiscoveryDetailLevel } from './types'; // יובא בנפרד כערך
import { createModuleLogger } from './logger';   // ודא נתיב נכון
import { sendUpnpCommand } from './upnpSoapClient'; // ודא נתיב נכון
import {
  tryCreateContentDirectoryService,
  tryCreateAVTransportService,
  tryCreateRenderingControlService,
} from './upnpSpecificServiceFactory'; // ייבוא פונקציות ה-factory

const getMacPromise = promisify(arp.getMAC);

const logger = createModuleLogger('upnpDeviceProcessor');
const DEFAULT_TIMEOUT_MS = 5000; // הועבר מ-upnpDeviceExplorer.ts

const MAC_TTL_MS = 60 * 60 * 2 * 1000;
const macAddressCacheStore = new Map<string, { value: string; expiresAt: number }>();
const macAddressCache = {
  get(key: string): string | undefined {
    const entry = macAddressCacheStore.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      macAddressCacheStore.delete(key);
      return undefined;
    }
    return entry.value;
  },
  set(key: string, value: string): void {
    macAddressCacheStore.set(key, { value, expiresAt: Date.now() + MAC_TTL_MS });
  },
};

// ==========================================================================================
// Helper Functions for Key Normalization
// ==========================================================================================

/**
 * @hebrew ממפה URN של שירות למפתח קצר.
 * @param serviceType - ה-URN המלא של השירות.
 * @returns מפתח קצר עבור השירות.
 */
function normalizeServiceTypeToKey(serviceType: string): string {
  const knownServiceMappings: Record<string, string> = {
    'urn:schemas-upnp-org:service:AVTransport:1': 'AVTransport',
    'urn:schemas-upnp-org:service:AVTransport:2': 'AVTransport',
    'urn:schemas-upnp-org:service:ContentDirectory:1': 'ContentDirectory',
    'urn:schemas-upnp-org:service:ContentDirectory:2': 'ContentDirectory',
    'urn:schemas-upnp-org:service:ContentDirectory:3': 'ContentDirectory',
    'urn:schemas-upnp-org:service:ContentDirectory:4': 'ContentDirectory',
    'urn:schemas-upnp-org:service:RenderingControl:1': 'RenderingControl',
    'urn:schemas-upnp-org:service:RenderingControl:2': 'RenderingControl',
    'urn:schemas-upnp-org:service:ConnectionManager:1': 'ConnectionManager',
    'urn:schemas-upnp-org:service:ConnectionManager:2': 'ConnectionManager',
    // ניתן להוסיף מיפויים נוספים לפי הצורך
  };

  if (knownServiceMappings[serviceType]) {
    return knownServiceMappings[serviceType];
  }

  // לוגיקת fallback
  // ננסה לחלץ את החלק האחרון של ה-URN אחרי ':'
  const parts = serviceType.split(':');
  if (parts.length > 2) {
    // החלק הלפני אחרון הוא בדרך כלל שם השירות, האחרון הוא הגרסה
    const potentialKey = parts[parts.length - 2];
    if (potentialKey && potentialKey !== 'service' && potentialKey !== 'schemas-upnp-org') {
      // נוודא שהמפתח אינו רק מספר (גרסה)
      if (isNaN(parseInt(potentialKey))) {
        return potentialKey;
      }
    }
  }

  // אם לא הצלחנו, נסיר את הקידומת "urn:schemas-upnp-org:service:" ונחזיר את השאר
  const prefixToRemove = "urn:schemas-upnp-org:service:";
  if (serviceType.startsWith(prefixToRemove)) {
    const stripped = serviceType.substring(prefixToRemove.length);
    // נסיר גם את הגרסה בסוף אם קיימת (למשל, ":1")
    return stripped.replace(/:\d+$/, '');
  }

  // אם כלום לא עבד, נחזיר את ה-serviceType המקורי (או חלק ממנו)
  // לדוגמה, אם זה לא URN סטנדרטי
  const lastPart = serviceType.substring(serviceType.lastIndexOf(':') + 1);
  if (lastPart && isNaN(parseInt(lastPart))) return lastPart; // אם החלק האחרון אינו מספר

  return serviceType; // כמוצא אחרון
}

/**
 * @hebrew מבצע נרמול בסיסי למפתחות גנריים (שמות פעולות, משתני מצב).
 * @param key - המפתח לנרמול.
 * @returns המפתח המנורמל.
 */
export function normalizeGenericKey(key: string): string {
  return key.trim();
}


// ==========================================================================================
// Device and Service Description Parsing and Processing
// ==========================================================================================

/**
 * @hebrew מאחזר ומנתח את קובץ התיאור XML של ההתקן.
 * @param locationUrl - כתובת ה-URL של קובץ התיאור.
 * @param signal - AbortSignal אופציונלי לביטול הבקשה.
 * @returns Promise המכיל את DeviceDescription או null אם נכשל.
 */
async function fetchAndParseDeviceDescriptionXml(
  locationUrl: string,
  signal?: AbortSignal
): Promise<DeviceDescription | null> {
  logger.debug(`fetchAndParseDeviceDescriptionXml: Fetching device description from: ${locationUrl}`);
  try {
    const response = await axios.get(locationUrl, {
      responseType: 'text', // קבלת התגובה כטקסט
      timeout: DEFAULT_TIMEOUT_MS, // Timeout לבקשה
      signal: signal, // העברת ה-AbortSignal
    });

    if (signal?.aborted) {
      logger.debug(`fetchAndParseDeviceDescriptionXml: Fetch aborted for ${locationUrl}`);
      return null;
    }

    if (response.status !== 200) {
      logger.warn(`fetchAndParseDeviceDescriptionXml: Failed to fetch device description from ${locationUrl}. Status: ${response.status}`);
      return null;
    }

    // בדיקת Content-Type
    const contentType = response.headers['content-type'] || response.headers['Content-Type'];
    if (contentType && typeof contentType === 'string' && !contentType.toLowerCase().includes('xml')) {
      logger.warn(`fetchAndParseDeviceDescriptionXml: Invalid Content-Type for device description from ${locationUrl}. Expected XML, got ${contentType}.`);
      return null;
    }

    const xmlData = response.data;
    // logger.trace(`fetchAndParseDeviceDescriptionXml: XML data received from ${locationUrl}:`, xmlData); // יכול להיות מאוד ורבלי

    const parser = new xml2js.Parser({
      explicitArray: false, // מניעת יצירת מערכים עבור אלמנטים בודדים
      explicitRoot: false,  // הסרת אלמנט השורש 'root'
      tagNameProcessors: [xml2js.processors.stripPrefix] // הסרת קידומות משמות תגיות
    });

    const result = await parser.parseStringPromise(xmlData);
    // logger.trace(`fetchAndParseDeviceDescriptionXml: Parsed XML result from ${locationUrl}:`, result);

    if (!result || !result.device) {
      logger.warn(`fetchAndParseDeviceDescriptionXml: Invalid or incomplete device description XML from ${locationUrl}. Missing 'device' root element after parsing.`, { parsedResult: result });
      return null;
    }
    const deviceNode = result.device;

    // פונקציות עזר לחילוץ טקסט וטיפול ב-URL-ים
    const getText = (node: any, propertyName: string): string | undefined => {
      if (node && typeof node === 'object' && node[propertyName] !== undefined) {
        if (typeof node[propertyName] === 'string') {
          return node[propertyName].trim();
        }
        // במקרה של אובייקט ריק (למשל, <presentationURL />), xml2js עשוי להחזיר אובייקט ריק.
        // נחזיר undefined במקרה זה.
        if (typeof node[propertyName] === 'object' && Object.keys(node[propertyName]).length === 0) {
          return undefined;
        }
      }
      return undefined;
    };

    const getBaseUrl = (locUrl: string): string | undefined => {
      try {
        const url = new URL(locUrl);
        return `${url.protocol}//${url.host}`;
      } catch (e) {
        logger.warn(`fetchAndParseDeviceDescriptionXml: Invalid location URL for getBaseUrl: ${locUrl}`, e);
        return undefined;
      }
    };

    const getDeviceIpFromUrl = (locUrl: string): string | undefined => {
      try {
        const url = new URL(locUrl);
        return url.hostname;
      } catch (e) {
        logger.warn(`fetchAndParseDeviceDescriptionXml: Invalid location URL for getDeviceIpFromUrl: ${locUrl}`, e);
        return undefined;
      }
    };

    const resolveUrl = (base: string | undefined, relative?: string): string | undefined => {
      if (!relative) return undefined;
      if (!base) return relative; // אם אין בסיס, נחזיר את היחסי כפי שהוא (בהנחה שהוא כבר מלא)
      try {
        return new URL(relative, base).toString();
      } catch (e) {
        logger.warn(`fetchAndParseDeviceDescriptionXml: Could not resolve URL. Base: ${base}, Relative: ${relative}`, e);
        return relative; // נחזיר את היחסי במקרה של שגיאה, אולי הוא כבר URL מלא
      }
    };

    const baseUrl = getBaseUrl(locationUrl);

    const deviceMacAddress = await (async () => {

      try {

        const deviceIp = getDeviceIpFromUrl(locationUrl);

        if (deviceIp) {
          const cacheAddr = macAddressCache.get(deviceIp);
          if (cacheAddr) {
            return cacheAddr as string;
          } else {
            return getMacPromise(deviceIp!) // ניתן למלא זאת אם יש דרך לאחזר את כתובת ה-MAC
              .then(mac => {
                macAddressCache.set(deviceIp, mac);
                return mac;
              }).catch(err => {
                logger.warn(`fetchAndParseDeviceDescriptionXml: Could not retrieve MAC address for IP ${deviceIp}`, err);
                macAddressCache.set(deviceIp, '');
                return '';
              });
          }
        }
      } catch (error) {
        logger.warn(`fetchAndParseDeviceDescriptionXml: Could not retrieve MAC address for device at ${locationUrl}`, error);
        return '';
      }

    })();

    const description: DeviceDescription = {
      location: locationUrl,
      URLBase: deviceNode.URLBase || baseUrl, // אם URLBase לא קיים ב-XML, נשתמש בבסיס של locationUrl
      baseURL: deviceNode.URLBase || baseUrl, // הוספת השדה החסר
      macAddress: deviceMacAddress || "", // כתובת MAC אם נמצאה
      deviceType: getText(deviceNode, 'deviceType') || '',
      friendlyName: getText(deviceNode, 'friendlyName') || '',
      manufacturer: getText(deviceNode, 'manufacturer') || '',
      manufacturerURL: getText(deviceNode, 'manufacturerURL'),
      modelName: getText(deviceNode, 'modelName') || '',
      modelNumber: getText(deviceNode, 'modelNumber'),
      modelDescription: getText(deviceNode, 'modelDescription'),
      modelURL: getText(deviceNode, 'modelURL'),
      serialNumber: getText(deviceNode, 'serialNumber'),
      UDN: getText(deviceNode, 'UDN') || '',
      UPC: getText(deviceNode, 'UPC'),
      presentationURL: resolveUrl(baseUrl, getText(deviceNode, 'presentationURL')),
      iconList: [],
      serviceList: new Map<string, ServiceDescription>(), // שינוי למפה
      // התקנים משנה (deviceList) לא נתמכים כרגע במלואם, אך נשמור את המבנה
      deviceList: deviceNode.deviceList && deviceNode.deviceList.device ?
        (Array.isArray(deviceNode.deviceList.device) ? deviceNode.deviceList.device : [deviceNode.deviceList.device])
          .map((d: any) => ({ UDN: getText(d, 'UDN'), deviceType: getText(d, 'deviceType') })) // מידע בסיסי על התקני משנה
        : [],
      // מאפיינים מ-BasicSsdpDevice שאינם בהכרח קיימים ב-DeviceDescription הטיפוסי
      usn: '', // יתמלא בהמשך מ-basicDevice
      st: '', // יתמלא בהמשך
      server: '', // יתמלא בהמשך
      remoteAddress: '', // יתמלא בהמשך
      remotePort: 0, // יתמלא בהמשך
      headers: {}, // יתמלא בהמשך
      timestamp: 0, // יתמלא בהמשך
      messageType: 'RESPONSE', // יתמלא בהמשך או שיהיה קבוע אם זה תמיד מתגובה
    };

    // עיבוד רשימת האייקונים
    if (deviceNode.iconList && deviceNode.iconList.icon) {
      const iconsInput = Array.isArray(deviceNode.iconList.icon) ? deviceNode.iconList.icon : [deviceNode.iconList.icon];
      description.iconList = iconsInput.map((iconNode: any): DeviceIcon => {
        return {
          mimetype: getText(iconNode, 'mimetype') || '',
          width: parseInt(getText(iconNode, 'width') || '0', 10),
          height: parseInt(getText(iconNode, 'height') || '0', 10),
          depth: parseInt(getText(iconNode, 'depth') || '0', 10),
          url: resolveUrl(description.URLBase || baseUrl, getText(iconNode, 'url')) || '',
        };
      }).filter((icon: DeviceIcon) => icon.url); // סנן אייקונים ללא URL
    }

    // עיבוד רשימת השירותים
    if (deviceNode.serviceList && deviceNode.serviceList.service) {
      const servicesInput = Array.isArray(deviceNode.serviceList.service) ? deviceNode.serviceList.service : [deviceNode.serviceList.service];
      servicesInput.forEach((serviceNode: any) => {
        const serviceType = getText(serviceNode, 'serviceType') || '';
        const serviceId = getText(serviceNode, 'serviceId') || '';
        const scpdUrl = resolveUrl(description.URLBase || baseUrl, getText(serviceNode, 'SCPDURL')) || '';
        const controlUrl = resolveUrl(description.URLBase || baseUrl, getText(serviceNode, 'controlURL')) || '';

        if (!serviceType || !serviceId || !scpdUrl || !controlUrl) {
          logger.warn(`fetchAndParseDeviceDescriptionXml: Missing mandatory fields for a service in ${locationUrl}. Skipping service.`, { serviceNode, serviceType, serviceId, scpdUrl, controlUrl });
          return; // דלג על שירות זה
        }

        const serviceKey = normalizeServiceTypeToKey(serviceType);
        const service: ServiceDescription = {
          serviceType: serviceType,
          serviceId: serviceId,
          SCPDURL: scpdUrl,
          controlURL: controlUrl,
          eventSubURL: resolveUrl(description.URLBase || baseUrl, getText(serviceNode, 'eventSubURL')) || '',
          // מאפיינים אופציונליים שיתמלאו מאוחר יותר
          actionList: new Map<string, Action>(), // שינוי למפה
          stateVariableList: new Map<string, StateVariable>(), // שינוי למפה
        };

        // בדיקה ששדות החובה קיימים ואם לא, רישום אזהרה (כבר נעשה למעלה, אבל נשאיר למקרה של eventSubURL)
        if (!service.eventSubURL) logger.debug(`fetchAndParseDeviceDescriptionXml: Missing eventSubURL for service ${service.serviceId} in ${locationUrl}`, { serviceNode });

        description.serviceList!.set(serviceKey, service);
      });
    }

    // logger.debug(`fetchAndParseDeviceDescriptionXml: Successfully parsed device description for ${locationUrl}`, { description });
    return description;

  } catch (error: any) {
    if (axios.isCancel(error)) {
      logger.debug(`fetchAndParseDeviceDescriptionXml: Request to ${locationUrl} was canceled.`, { message: error.message });
    } else if (error.code === 'ECONNABORTED' || (error.response && error.response.status === 408) || error.message?.includes('timeout')) {
      logger.warn(`fetchAndParseDeviceDescriptionXml: Timeout fetching device description from ${locationUrl}.`, { message: error.message });
    } else {
      logger.error(`fetchAndParseDeviceDescriptionXml: Error fetching or parsing device description from ${locationUrl}:`, { message: error.message, stack: error.stack, url: locationUrl });
    }
    return null;
  }
}

/**
 * @hebrew מאכלס את רשימת הפעולות ומשתני המצב עבור כל שירות בתיאור ההתקן.
 * @param deviceDescription - אובייקט DeviceDescription המכיל את רשימת השירותים.
 * @param signal - AbortSignal אופציונלי לביטול הבקשות.
 * @returns Promise ללא ערך, שמתממש כאשר כל השירותים עודכנו.
 */
async function populateServices(
  deviceDescription: DeviceDescription,
  signal?: AbortSignal
): Promise<void> {
  if (!deviceDescription.serviceList || deviceDescription.serviceList.size === 0) {
    logger.debug(`populateServices: No services to populate for device ${deviceDescription.friendlyName} (${deviceDescription.UDN})`);
    return;
  }

  logger.debug(`populateServices: Populating ${deviceDescription.serviceList.size} services for device ${deviceDescription.friendlyName} (${deviceDescription.UDN})`);

  const servicePromises = Array.from(deviceDescription.serviceList.values()).map(service => {
    if (signal?.aborted) {
      logger.debug(`populateServices: Aborted before fetching SCPD for service ${service.serviceId} of device ${deviceDescription.UDN}`);
      return Promise.resolve(); // החזרת Promise שנפתר מיד
    }
    return fetchScpdAndUpdateService(service, signal) // שינוי שם הקריאה
      .then(() => {
        // logger.trace(`populateServices: Successfully populated service ${service.serviceId} for device ${deviceDescription.friendlyName}`);
      })
      .catch(error => {
        if (!signal?.aborted) { // רשום שגיאה רק אם לא בוטל
          logger.warn(`populateServices: Failed to populate service ${service.serviceId} for device ${deviceDescription.friendlyName}: ${error.message}`);
        } else {
          logger.debug(`populateServices: SCPD fetch for service ${service.serviceId} was aborted.`);
        }
        // לא זורקים שגיאה כדי לא לעצור את כל התהליך, רק רושמים אזהרה
      });
  });

  await Promise.allSettled(servicePromises); // שימוש ב-allSettled כדי להמשיך גם אם חלק מהשירותים נכשלים
  logger.debug(`populateServices: Finished populating services for device ${deviceDescription.friendlyName} (${deviceDescription.UDN})`);
}


/**
 * @hebrew מאחזר ומנתח את קובץ ה-SCPD של שירות ומעדכן את אובייקט השירות עם הפעולות ומשתני המצב.
 * @param service - אובייקט ServiceDescription לעדכון.
 * @param signal - AbortSignal אופציונלי לביטול הבקשה.
 * @returns Promise ללא ערך, שמתממש כאשר השירות עודכן.
 */
async function fetchScpdAndUpdateService(service: ServiceDescription, signal?: AbortSignal): Promise<void> {
  if (!service.SCPDURL) {
    logger.warn(`fetchScpdAndUpdateService: SCPDURL is missing for service ${service.serviceId}. Cannot fetch details.`);
    return;
  }
  if (signal?.aborted) {
    logger.debug(`fetchScpdAndUpdateService: Aborted before fetching SCPD from ${service.SCPDURL}`);
    return;
  }

  logger.debug(`fetchScpdAndUpdateService: Fetching SCPD for service ${service.serviceId} from ${service.SCPDURL}`);

  let xmlData;
  try {
    const response = await axios.get(service.SCPDURL, {
      responseType: 'text',
      timeout: DEFAULT_TIMEOUT_MS,
      signal: signal,
    });

    if (signal?.aborted) {
      logger.debug(`fetchScpdAndUpdateService: Fetch aborted for ${service.SCPDURL}`);
      return;
    }

    if (response.status !== 200) {
      logger.warn(`fetchScpdAndUpdateService: Failed to fetch SCPD for service ${service.serviceId} from ${service.SCPDURL}. Status: ${response.status}`);
      return;
    }

    // בדיקת Content-Type
    const contentType = response.headers['content-type'] || response.headers['Content-Type'];
    if (contentType && typeof contentType === 'string' && !contentType.toLowerCase().includes('xml')) {
      logger.warn(`fetchScpdAndUpdateService: Invalid Content-Type for SCPD from ${service.SCPDURL}. Expected XML, got ${contentType}.`);
      return;
    }

    xmlData = response.data;
    // logger.trace(`fetchScpdAndUpdateService: XML data received from ${service.SCPDURL}:`, xmlData);

    const parser = new xml2js.Parser({
      explicitArray: false,
      explicitRoot: false, // הסרת אלמנט השורש 'scpd'
      tagNameProcessors: [xml2js.processors.stripPrefix]
    });
    const result = await parser.parseStringPromise(xmlData);
    // logger.trace(`fetchScpdAndUpdateService: Parsed SCPD result for ${service.serviceId}:`, result);

    if (!result || (!result.actionList && !result.serviceStateTable)) {
      logger.warn(`fetchScpdAndUpdateService: Invalid or incomplete SCPD XML from ${service.SCPDURL}. Missing 'actionList' or 'serviceStateTable'.`, { parsedResult: result });
      service.scpdError = 'Failed to fetch/parse SCPD: Invalid or incomplete SCPD XML';
      service.actionList = new Map<string, Action>();
      service.stateVariableList = new Map<string, StateVariable>();
      return;
    }

    // עיבוד רשימת הפעולות
    if (result.actionList && result.actionList.action) {
      const actionsArray = Array.isArray(result.actionList.action) ? result.actionList.action : [result.actionList.action];
      actionsArray.forEach((actionNode: any) => {
        const actionName = normalizeGenericKey(actionNode.name || '');
        if (!actionName) {
          logger.warn(`fetchScpdAndUpdateService: Action without name found in SCPD for service ${service.serviceId}. Skipping action.`, { actionNode });
          return;
        }
        const argsArray = actionNode.argumentList && actionNode.argumentList.argument ?
          (Array.isArray(actionNode.argumentList.argument) ? actionNode.argumentList.argument : [actionNode.argumentList.argument])
          : [];

        const action: Action = {
          name: actionName, // השם כבר מנורמל
          arguments: argsArray.map((argNode: any): ActionArgument => ({
            name: argNode.name || '', // שמות ארגומנטים לא מנורמלים כרגע, אלא אם יש צורך
            direction: argNode.direction || '',
            relatedStateVariable: argNode.relatedStateVariable || '',
          })).filter((arg: ActionArgument) => arg.name && arg.direction && arg.relatedStateVariable) // סנן ארגומנטים לא תקינים
        };
        service.actionList!.set(actionName, action);
      });
    } else {
      service.actionList = new Map<string, Action>(); // אם אין actionList או אין פעולות, הגדר כמפה ריקה
    }

    // עיבוד טבלת משתני המצב
    if (result.serviceStateTable && result.serviceStateTable.stateVariable) {
      const stateVarsArray = Array.isArray(result.serviceStateTable.stateVariable) ? result.serviceStateTable.stateVariable : [result.serviceStateTable.stateVariable];
      stateVarsArray.forEach((svNode: any) => {
        const varName = normalizeGenericKey(svNode.name || '');
        const dataType = svNode.dataType || '';
        if (!varName || !dataType) {
          logger.warn(`fetchScpdAndUpdateService: State variable without name or dataType found in SCPD for service ${service.serviceId}. Skipping variable.`, { svNode });
          return;
        }

        const stateVar: StateVariable = {
          name: varName, // השם כבר מנורמל
          dataType: dataType,
          sendEvents: svNode['@_sendEvents'] === 'no' ? 'no' : (svNode['@_sendEvents'] === 'yes' ? 'yes' : undefined),
          allowedValueList: svNode.allowedValueList && svNode.allowedValueList.allowedValue ?
            (Array.isArray(svNode.allowedValueList.allowedValue) ? svNode.allowedValueList.allowedValue : [svNode.allowedValueList.allowedValue])
            : undefined,
          ...(svNode.allowedValueRange && {
            min: svNode.allowedValueRange.minimum,
            max: svNode.allowedValueRange.maximum,
            step: svNode.allowedValueRange.step
          }),
          defaultValue: svNode.defaultValue
        };
        service.stateVariableList!.set(varName, stateVar);
      });
    } else {
      service.stateVariableList = new Map<string, StateVariable>(); // אם אין טבלת מצב או אין משתנים, הגדר כמפה ריקה
    }

    // נסיון לאכלס actions ספציפיים
    // פונקציות ה-factory מבצעות מוטציה על האובייקט service המועבר אליהן
    // ומחזירות אותו אם הצליחו, או null אם לא.
    // לכן, אנו בודקים את ערך ההחזרה כדי לדעת אם service.actions עודכן.
    if (tryCreateContentDirectoryService(service as ServiceDescription)) {
      // service.actions עודכן על ידי הפונקציה
      logger.debug(`fetchScpdAndUpdateService: Successfully populated specific ContentDirectory actions for service ${service.serviceId}`);
    } else if (tryCreateAVTransportService(service as ServiceDescription)) {
      // service.actions עודכן על ידי הפונקציה
      logger.debug(`fetchScpdAndUpdateService: Successfully populated specific AVTransport actions for service ${service.serviceId}`);
    } else if (tryCreateRenderingControlService(service as ServiceDescription)) {
      // service.actions עודכן על ידי הפונקציה
      logger.debug(`fetchScpdAndUpdateService: Successfully populated specific RenderingControl actions for service ${service.serviceId}`);
    } else {
      logger.debug(`fetchScpdAndUpdateService: Service ${service.serviceId} (${service.serviceType}) did not match any known specific service types for actions population.`);
      // במקרה זה, service.actions יישאר כפי שהיה (ככל הנראה undefined)
    }

    // logger.debug(`fetchScpdAndUpdateService: Successfully populated SCPD for service ${service.serviceId}`);

  } catch (error: any) {
    if (axios.isCancel(error)) {
      logger.debug(`fetchScpdAndUpdateService: Request to ${service.SCPDURL} was canceled.`, { message: error.message });
    } else if (error.code === 'ECONNABORTED' || (error.response && error.response.status === 408) || error.message?.includes('timeout')) {
      logger.warn(`fetchScpdAndUpdateService: Timeout fetching SCPD for service ${service.serviceId} from ${service.SCPDURL}.`, { message: error.message });
    } else {
      logger.error(xmlData as string)
      logger.error(`fetchScpdAndUpdateService: Error fetching or parsing SCPD for service ${service.serviceId} from ${service.SCPDURL}:`, { message: error.message, stack: error.stack, url: service.SCPDURL });
      service.scpdError = `Failed to fetch/parse SCPD: ${error.message}`;
      service.actionList = new Map<string, Action>();
      service.stateVariableList = new Map<string, StateVariable>();
    }
    // לא זורקים שגיאה כדי לא לעצור את כל התהליך
  }
}

/**
 * @hebrew מאכלס את הפונקציות invoke ו-query עבור הפעולות ומשתני המצב של השירות.
 * פונקציה זו נקראת לאחר ש-SCPD נטען ועובד.
 * @param service - אובייקט ServiceDescription המכיל actionList ו-stateVariableList.
 * @param device - אובייקט BasicSsdpDevice או DeviceDescription המכיל את פרטי ההתקן (לצורך URL-ים).
 */
function populateActionsAndStateVariables(
  service: ServiceDescription,
  device: BasicSsdpDevice | DeviceDescription | DeviceWithServicesDescription | FullDeviceDescription
): void {
  const controlURL = service.controlURL;
  const serviceType = service.serviceType;

  if (!controlURL) {
    logger.warn(`populateActionsAndStateVariables: Missing controlURL for service ${service.serviceId} of device ${device.usn || (device as DeviceDescription).UDN}. Cannot create invoke/query functions.`);
    return;
  }

  if (service.actionList && service.actionList.size > 0) {
    service.actionList.forEach(action => { // האיטרציה על ערכי המפה תקינה כאן
      action.invoke = createInvokeFunctionForAction(action, controlURL, serviceType);
    });
  }
  if (service.stateVariableList && service.stateVariableList.size > 0) {
    service.stateVariableList.forEach(stateVar => { // האיטרציה על ערכי המפה תקינה כאן
      stateVar.query = createQueryFunctionForStateVar(stateVar, controlURL, serviceType);
    });
  }
}

/**
 * @hebrew יוצר פונקציית invoke עבור פעולה ספציפית.
 */
function createInvokeFunctionForAction(
  action: Action,
  controlURL: string,
  serviceType: string
): (args: Record<string, any>) => Promise<Record<string, any>> {
  return async (args: Record<string, any>): Promise<Record<string, any>> => {
    logger.debug(`Invoking action "${action.name}" on service "${serviceType}" with args:`, args);
    try {
      const result = await sendUpnpCommand(controlURL, serviceType, action.name, args);
      logger.debug(`Action "${action.name}" invoked successfully. Result:`, result);
      return result;
    } catch (error: any) {
      logger.error(`Error invoking action "${action.name}" on service "${serviceType}":`, error.message);
      throw error;
    }
  };
}

/**
 * @hebrew יוצר פונקציית query עבור משתנה מצב ספציפי.
 */
function createQueryFunctionForStateVar(
  stateVar: StateVariable,
  controlURL: string,
  serviceType: string
): () => Promise<any> {
  const queryActionName = "QueryStateVariable";
  return async (): Promise<any> => {
    logger.debug(`Querying state variable "${stateVar.name}" on service "${serviceType}"`);
    const args = {
      VarName: stateVar.name,
    };
    try {
      const result = await sendUpnpCommand(controlURL, serviceType, queryActionName, args);
      logger.debug(`State variable "${stateVar.name}" queried successfully. Raw result:`, result);
      if (result && typeof result === 'object' && result.hasOwnProperty('return')) {
        return result.return;
      }
      logger.warn(`Query result for "${stateVar.name}" did not have the expected 'return' property. Returning full result.`, { result });
      return result;

    } catch (error: any) {
      logger.error(`Error querying state variable "${stateVar.name}" on service "${serviceType}":`, error.message);
      throw error;
    }
  };
}


// ==========================================================================================
// Main Device Processing Function
// ==========================================================================================

/**
 * @hebrew (פנימי) מקבל BasicSsdpDevice ומבצע חקירה מעמיקה יותר
 * בהתאם לרמת הפירוט המבוקשת.
 *
 * @param basicDevice - ההתקן הבסיסי שנתגלה.
 * @param detailLevel - רמת הפירוט הרצויה לחקירה.
 * @param abortSignal - אות לביטול הפעולה.
 * @returns Promise ל-ProcessedDevice ברמת הפירוט המבוקשת, או null אם שלב קריטי נכשל או הפעולה בוטלה.
 */
export async function processUpnpDevice( // שם שונה והוספת export
  basicDevice: BasicSsdpDevice,
  detailLevel: DiscoveryDetailLevel,
  abortSignal?: AbortSignal
): Promise<ProcessedDevice> {
  logger.debug(`processUpnpDevice: Processing device ${basicDevice.usn} to detail level: ${detailLevel}`);

  if (detailLevel === DiscoveryDetailLevel.Basic) { // שחזור להשוואה המקורית עם enum
    if (abortSignal?.aborted) throw new Error("Operation aborted before processing (basic)."); // שחזור בדיקת abortSignal
    return basicDevice;
  }

  if (!basicDevice.location) {
    logger.warn(`processUpnpDevice: Device ${basicDevice.usn} has no location URL. Cannot fetch description. Returning basic info.`);
    if (abortSignal?.aborted) throw new Error("Operation aborted (no location)."); // שחזור בדיקת abortSignal
    return { ...basicDevice, error: "Device has no location URL." };
  }

  if (abortSignal?.aborted) throw new Error("Operation aborted before fetching description."); // שחזור בדיקת abortSignal
  const deviceDescription = await fetchAndParseDeviceDescriptionXml(basicDevice.location, abortSignal);

  if (!deviceDescription) {
    logger.warn(`processUpnpDevice: Failed to get device description for ${basicDevice.usn} from ${basicDevice.location}. Returning basic info.`);
    if (abortSignal?.aborted) throw new Error("Operation aborted (description fetch failed)."); // שחזור בדיקת abortSignal
    return { ...basicDevice, error: "Failed to fetch/parse device description" };
  }

  const mergedDeviceDesc: DeviceDescription = {
    ...basicDevice,
    ...deviceDescription,
    location: basicDevice.location,
    remoteAddress: basicDevice.remoteAddress,
    remotePort: basicDevice.remotePort,
    headers: basicDevice.headers,
    timestamp: basicDevice.timestamp,
    messageType: basicDevice.messageType,
    ...(basicDevice.cacheControlMaxAge !== undefined && { cacheControlMaxAge: basicDevice.cacheControlMaxAge }),
    ...(basicDevice.httpMethod && { httpMethod: basicDevice.httpMethod }),
    ...(basicDevice.httpStatusCode && { httpStatusCode: basicDevice.httpStatusCode }),
    ...(basicDevice.httpStatusMessage && { httpStatusMessage: basicDevice.httpStatusMessage }),
    ...(basicDevice.nts && { nts: basicDevice.nts }),
    ...(basicDevice.httpVersion && { httpVersion: basicDevice.httpVersion }),
  };

  if (detailLevel === DiscoveryDetailLevel.Description) {
    if (abortSignal?.aborted) throw new Error("Operation aborted before returning description.");
    return mergedDeviceDesc;
  }

  if (abortSignal?.aborted) throw new Error("Operation aborted before populating services.");
  await populateServices(mergedDeviceDesc, abortSignal); // שינוי שם הקריאה

  const deviceWithServices: DeviceWithServicesDescription = mergedDeviceDesc as DeviceWithServicesDescription;

  if (detailLevel === DiscoveryDetailLevel.Services) {
    if (abortSignal?.aborted) throw new Error("Operation aborted before returning services.");
    return deviceWithServices;
  }

  if (detailLevel === DiscoveryDetailLevel.Full) {
    if (abortSignal?.aborted) throw new Error("Operation aborted before populating actions/state variables.");
    if (deviceWithServices.serviceList) {
      deviceWithServices.serviceList.forEach(service => {
        populateActionsAndStateVariables(service, deviceWithServices); // שינוי שם הקריאה
      });
    }
    const fullDeviceDescription: FullDeviceDescription = deviceWithServices as FullDeviceDescription;
    return fullDeviceDescription;
  }

  // Fallback for unknown detail level, though TypeScript should prevent this.
  logger.warn(`processUpnpDevice: Unknown detail level "${detailLevel}" for device ${basicDevice.usn}. Returning basic info.`);
  if (abortSignal?.aborted) throw new Error("Operation aborted (unknown detail level).");
  return basicDevice;
}

/**
 * @hebrew מאחזר ומעבד תיאור התקן UPnP מלא מ-URL.
 * @param locationUrl - כתובת ה-URL של קובץ התיאור הראשי של ההתקן.
 * @param detailLevel - רמת הפירוט הרצויה.
 * @param abortSignal - אות לביטול הפעולה.
 * @returns Promise המכיל את ProcessedDevice או null אם נכשל.
 */
export async function processUpnpDeviceFromUrl(
  locationUrl: string,
  detailLevel: DiscoveryDetailLevel,
  abortSignal?: AbortSignal
): Promise<ProcessedDevice | null> {
  logger.debug(`processUpnpDeviceFromUrl: Processing device from URL ${locationUrl} to detail level: ${detailLevel}`);

  if (abortSignal?.aborted) {
    logger.debug(`processUpnpDeviceFromUrl: Operation aborted before fetching description for ${locationUrl}.`);
    return null;
  }

  const initialDeviceDescription = await fetchAndParseDeviceDescriptionXml(locationUrl, abortSignal);

  if (!initialDeviceDescription) {
    logger.warn(`processUpnpDeviceFromUrl: Failed to get device description from ${locationUrl}.`);
    if (abortSignal?.aborted) {
      logger.debug(`processUpnpDeviceFromUrl: Aborted during fetchAndParseDeviceDescriptionXml for ${locationUrl}.`);
    }
    return null;
  }

  // נוודא ששדה location קיים, למרות שהוא אמור להיות מאוכלס על ידי fetchAndParseDeviceDescriptionXml
  if (!initialDeviceDescription.location) {
    initialDeviceDescription.location = locationUrl;
  }
  // נוודא ששדה UDN קיים, למרות שהוא אמור להיות מאוכלס
  if (!initialDeviceDescription.UDN) {
    logger.warn(`processUpnpDeviceFromUrl: UDN is missing in the device description from ${locationUrl}. This might cause issues.`);
    // אפשר להחזיר null כאן אם UDN הוא קריטי, או להמשיך בזהירות
  }


  // הכנת אובייקט בסיס - initialDeviceDescription כבר מכיל את רוב המידע.
  // שדות כמו remoteAddress, remotePort, headers, timestamp, messageType לא יהיו זמינים כי אנחנו לא מתחילים מ-SSDP.
  // זה בסדר כי הפונקציות הבאות מסתמכות בעיקר על baseURL ועל כתובות ה-URL המלאות של השירותים.

  if (detailLevel === DiscoveryDetailLevel.Basic || detailLevel === DiscoveryDetailLevel.Description) {
    if (abortSignal?.aborted) {
      logger.debug(`processUpnpDeviceFromUrl: Operation aborted before returning description for ${locationUrl}.`);
      return null;
    }
    // במקרה זה, Basic יהיה זהה ל-Description כי התחלנו מ-URL שיש בו תיאור.
    // נוסיף את detailLevelAchieved
    return { ...initialDeviceDescription, detailLevelAchieved: DiscoveryDetailLevel.Description } as DeviceDescription;
  }

  if (abortSignal?.aborted) {
    logger.debug(`processUpnpDeviceFromUrl: Operation aborted before populating services for ${locationUrl}.`);
    return null;
  }
  await populateServices(initialDeviceDescription, abortSignal);

  // לאחר populateServices, initialDeviceDescription עודכן עם actionList ו-stateVariableList (ללא invoke/query)
  const deviceWithServices: DeviceWithServicesDescription = {
    ...initialDeviceDescription,
    detailLevelAchieved: DiscoveryDetailLevel.Services, // עדכון רמת הפירוט שהושגה
  } as DeviceWithServicesDescription;


  if (detailLevel === DiscoveryDetailLevel.Services) {
    if (abortSignal?.aborted) {
      logger.debug(`processUpnpDeviceFromUrl: Operation aborted before returning services for ${locationUrl}.`);
      return null;
    }
    return deviceWithServices;
  }

  // detailLevel === DiscoveryDetailLevel.Full
  if (abortSignal?.aborted) {
    logger.debug(`processUpnpDeviceFromUrl: Operation aborted before populating actions/state variables for ${locationUrl}.`);
    return null;
  }

  if (deviceWithServices.serviceList) {
    for (const service of deviceWithServices.serviceList.values()) {
      if (abortSignal?.aborted) {
        logger.debug(`processUpnpDeviceFromUrl: Operation aborted during populating actions/state variables for service ${service.serviceId} in ${locationUrl}.`);
        return null; // או שנמשיך וניתן להתקן להיות חלקי? התוכנית לא מציינת. נבחר להחזיר null.
      }
      populateActionsAndStateVariables(service, deviceWithServices);
    }
  }

  const fullDeviceDescription: FullDeviceDescription = {
    ...deviceWithServices,
    detailLevelAchieved: DiscoveryDetailLevel.Full, // עדכון רמת הפירוט שהושגה
  } as FullDeviceDescription;

  if (abortSignal?.aborted) {
    logger.debug(`processUpnpDeviceFromUrl: Operation aborted before returning full description for ${locationUrl}.`);
    return null;
  }

  return fullDeviceDescription;
}