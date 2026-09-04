// קובץ: packages/dlna-core/src/activeDeviceManager.ts

import { EventEmitter } from 'events';
import * as os from 'node:os'; // הוספת ייבוא למודול os
import {
  ActiveDeviceManagerOptions,
  ServerApiDevice,
  BasicSsdpDevice, // הוספת ייבוא
  DiscoveryDetailLevel,
  FullDeviceDescription, // הוספת ייבוא
  DeviceDescription, // הוספת ייבוא
} from './types';
import { createSocketManager } from './ssdpSocketManager';
import type { RemoteInfo } from 'node:dgram'; // הוספת ייבוא
import {
  parseHttpPacket,
  ParsedHttpPacket, // הוספת ייבוא
  HTTP_REQUEST_TYPE, // הוספת ייבוא
  HTTP_RESPONSE_TYPE, // הוספת ייבוא
} from './genericHttpParser';
import { createModuleLogger } from './logger'; // הוספת ייבוא ללוגר
import { processUpnpDevice } from './upnpDeviceProcessor'; // הוספת ייבוא

const logger = createModuleLogger('ActiveDeviceManager'); // אתחול לוגר מקומי
type ReturnTypeOfCreateSocketManager = Awaited<ReturnType<typeof createSocketManager>>; // הטיפוס הנכון לאחר await createSocketManager
/**
 * @internal
 * מחלקה לניהול גילוי רציף של התקני UPnP.
 */
export class ActiveDeviceManager extends EventEmitter {
  private options: Required<ActiveDeviceManagerOptions>;
  private activeDevices: Map<string, ServerApiDevice>;
  private socketManager: ReturnTypeOfCreateSocketManager | null;
  private mSearchIntervalId: NodeJS.Timeout | null;
  private cleanupIntervalId: NodeJS.Timeout | null;
  private isRunning: boolean;

  constructor(options?: ActiveDeviceManagerOptions) {
    super();

    // אתחול אופציות עם ברירות מחדל
    this.options = {
      searchTarget: options?.searchTarget ?? 'ssdp:all',
      mSearchIntervalMs: options?.mSearchIntervalMs ?? 10000, // 10 שניות
      deviceCleanupIntervalMs: options?.deviceCleanupIntervalMs ?? 30000, // 30 שניות
      includeIPv6: options?.includeIPv6 ?? false,
      detailLevel: options?.detailLevel ?? DiscoveryDetailLevel.Basic,
      onRawSsdpMessage: options?.onRawSsdpMessage ?? (() => { /* פונקציה ריקה */ }),
      networkInterfaces: options?.networkInterfaces ?? [], // אתחול למערך ריק אם לא סופק
    };

    this.activeDevices = new Map<string, ServerApiDevice>();
    this.socketManager = null;
    this.mSearchIntervalId = null;
    this.cleanupIntervalId = null;
    this.isRunning = false;
  }

  /**
   * @hebrew מפענח הודעת SSDP גולמית וממפה אותה לאובייקט BasicSsdpDevice.
   * @param msg - הודעת ה-SSDP הגולמית.
   * @param rinfo - מידע על השולח.
   * @returns אובייקט BasicSsdpDevice אם הפענוח הצליח, אחרת null.
   */
  private _parseAndMapSsdpMessage(msg: Buffer, rinfo: RemoteInfo): BasicSsdpDevice | null {
    const msgString = msg.toString('utf-8');
    let parserType: typeof HTTP_REQUEST_TYPE | typeof HTTP_RESPONSE_TYPE;

    // קביעת סוג הפרסר על סמך תוכן ההודעה
    if (msgString.startsWith('NOTIFY') || msgString.startsWith('M-SEARCH')) {
      parserType = HTTP_REQUEST_TYPE;
    } else if (msgString.startsWith('HTTP/')) {
      parserType = HTTP_RESPONSE_TYPE;
    } else {
      logger.debug('_parseAndMapSsdpMessage: Unknown SSDP message type, cannot determine parser type.', { remoteAddress: rinfo.address, messageStart: msgString.substring(0, 20) });
      return null;
    }

    const parsedPacket: ParsedHttpPacket | null = parseHttpPacket(msg, parserType);

    if (!parsedPacket) {
      logger.debug(`_parseAndMapSsdpMessage: Received null parsedPacket from parseHttpPacket, indicating a parsing failure.`, { remoteAddress: rinfo.address });
      return null;
    }

    const { headers, method, statusCode, statusMessage, versionMajor, versionMinor } = parsedPacket;
    const normalizedHeaders = headers;

    const httpVersionString = (versionMajor !== undefined && versionMinor !== undefined)
      ? `${versionMajor}.${versionMinor}`
      : undefined;

    const location = normalizedHeaders['location'];
    const usn = normalizedHeaders['usn'];
    const ntHeader = normalizedHeaders['nt'];
    const ntsHeader = normalizedHeaders['nts'];
    const stHeader = normalizedHeaders['st'];
    const server = normalizedHeaders['server'];
    const cacheControlHeader = normalizedHeaders['cache-control'];

    let cacheControlMaxAge: number | undefined = undefined;
    if (cacheControlHeader) {
      const maxAgeMatch = cacheControlHeader.match(/max-age=(\d+)/i);
      if (maxAgeMatch && maxAgeMatch[1]) {
        cacheControlMaxAge = parseInt(maxAgeMatch[1], 10);
      }
    }

    if (!usn || usn.trim() === '') {
      logger.debug('_parseAndMapSsdpMessage: USN is missing, empty, or only whitespace in SSDP message headers. Ignoring message.', { usnValueReceived: usn, remoteAddress: rinfo.address, headers: normalizedHeaders });
      return null;
    }

    // חילוץ UDN מה-USN
    // ה-UDN הוא בדרך כלל החלק שלפני '::'
    // אם אין '::', ה-USN כולו יכול להיחשב כ-UDN (למשל, עבור שירותים מסוימים או התקנים שאינם root)
    // עם זאת, עבור root device, ה-UDN הוא תמיד החלק הראשון.
    let UDN: string;
    const doubleColonIndex = usn.indexOf('::');
    if (doubleColonIndex !== -1) {
      UDN = usn.substring(0, doubleColonIndex);
    } else {
      // במקרה שאין '::', ייתכן שזה USN של שירות שאינו root, או USN של root device שאינו מכיל '::' (פחות נפוץ)
      // במקרה זה, נשתמש ב-USN כולו כ-UDN, אך נצטרך להיות זהירים יותר בהמשך.
      // ההנחה היא ש-UDN אמור להיות ייחודי להתקן הפיזי.
      UDN = usn;
      logger.debug(`_parseAndMapSsdpMessage: USN "${usn}" does not contain "::". Using full USN as UDN. This might be a non-root device USN or an unusual root device USN.`);
    }
     // בדיקה נוספת: אם ה-UDN שחולץ עדיין מכיל uuid:, נסיר אותו.
    if (UDN.startsWith('uuid:')) {
        UDN = UDN.substring(5);
    }


    const finalSt = stHeader || ntHeader;
    if (!finalSt) {
      logger.debug('_parseAndMapSsdpMessage: ST/NT is missing in SSDP message headers.', { remoteAddress: rinfo.address, headers: normalizedHeaders });
      return null;
    }

    const messageType = parserType === HTTP_REQUEST_TYPE ? 'REQUEST' : 'RESPONSE';

    const basicDevice: BasicSsdpDevice = {
      usn, // USN המלא של ההודעה
      UDN, // UDN שחולץ
      location: location || '',
      server: server || '',
      st: finalSt,
      remoteAddress: rinfo.address,
      remotePort: rinfo.port,
      headers: normalizedHeaders,
      timestamp: Date.now(),
      messageType,
      httpMethod: method,
      httpStatusCode: statusCode,
      httpStatusMessage: statusMessage,
      cacheControlMaxAge,
      nts: ntsHeader,
      httpVersion: httpVersionString,
      detailLevelAchieved: DiscoveryDetailLevel.Basic,
    };

    if (basicDevice.httpMethod === 'M-SEARCH') {
      logger.debug(`_parseAndMapSsdpMessage: Received M-SEARCH request from ${rinfo.address}:${rinfo.port}.`, { usn: basicDevice.usn, UDN: basicDevice.UDN });
    }

    if (basicDevice.httpMethod !== 'M-SEARCH' && messageType === 'RESPONSE' && !location) {
      logger.debug('_parseAndMapSsdpMessage: Location is missing in SSDP response headers.', { remoteAddress: rinfo.address, usn: basicDevice.usn, UDN: basicDevice.UDN, headers: normalizedHeaders });
      return null;
    }

    return basicDevice;
  }

  /**
   * @hebrew מטפל בהודעת SSDP לאחר פענוח.
   * מנהל את רשימת המכשירים הפעילים ופולט אירועים.
   * @param msg - הודעת ה-SSDP הגולמית.
   * @param rinfo - מידע על השולח.
   * @param socketType - סוג הסוקט שקיבל את ההודעה (למשל, 'ipv4', 'ipv6').
   */
  private async _handleSsdpMessage(msg: Buffer, rinfo: RemoteInfo, socketType: string): Promise<void> {
    const basicDevice = this._parseAndMapSsdpMessage(msg, rinfo);

    // #region logging
    if (basicDevice) {
      let messageOriginType = 'Unknown';
      if (basicDevice.messageType === 'RESPONSE') {
        messageOriginType = 'Response (likely to M-SEARCH)';
      } else if (basicDevice.httpMethod === 'NOTIFY') {
        messageOriginType = 'Multicast (NOTIFY)';
      }
      logger.debug(`Received SSDP message from ${rinfo.address}:${rinfo.port} via ${socketType}. Type: ${messageOriginType}`, {
        usn: basicDevice.usn,
        st: basicDevice.st,
        nts: basicDevice.nts,
        location: basicDevice.location,
        server: basicDevice.server,
      });
    }
    // #endregion logging

    if (!basicDevice) {
      // הלוג נרשם כבר ב-_parseAndMapSsdpMessage
      return;
    }

    if (!basicDevice.usn || !basicDevice.UDN) {
      logger.warn('_handleSsdpMessage: Received SSDP message without USN or UDN. Ignoring.', { remoteAddress: rinfo.address, headers: basicDevice.headers, usn: basicDevice.usn, UDN: basicDevice.UDN });
      return;
    }

    // הודעת byebye לא חייבת להכיל location
    if (basicDevice.nts !== 'ssdp:byebye' && !basicDevice.location) {
      logger.warn('_handleSsdpMessage: Received SSDP message (not byebye) without Location. Ignoring.', { usn: basicDevice.usn, UDN: basicDevice.UDN, remoteAddress: rinfo.address, headers: basicDevice.headers });
      return;
    }

    // טיפול בהודעת ssdp:byebye
    if (basicDevice.nts === 'ssdp:byebye') {
      // ה-UDN מההודעה הוא המפתח לחיפוש במאגר
      const deviceUdn = basicDevice.UDN;
      const existingDevice = this.activeDevices.get(deviceUdn);

      if (existingDevice) {
        // בדיקה אם ההודעה מתייחסת ל-rootdevice
        // ה-USN של ההודעה צריך להתחיל ב-UDN של המכשיר ולהסתיים ב-"::upnp:rootdevice" או שה-NT הוא "upnp:rootdevice"
        // או שה-USN של ההודעה זהה ל-UDN (במקרה של USN שהוא רק UDN)
        const isRootDeviceByeBye = basicDevice.st === 'upnp:rootdevice' ||
                                   basicDevice.usn === deviceUdn || // מכסה מקרה ש-USN הוא רק UDN
                                   (basicDevice.usn.startsWith(deviceUdn) && basicDevice.usn.includes('::upnp:rootdevice'));


        if (isRootDeviceByeBye) {
          this.activeDevices.delete(deviceUdn);
          this.emit('devicelost', deviceUdn, existingDevice); // שולחים את ה-ApiDevice שהיה קיים
          logger.info(`_handleSsdpMessage: Device lost (ssdp:byebye for root device): UDN=${deviceUdn}, USN=${basicDevice.usn}`, { UDN: deviceUdn, usn: basicDevice.usn, remoteAddress: basicDevice.remoteAddress });
        } else {
          // אם זה byebye של שירות ספציפי, כרגע לא נסיר את כל המכשיר, רק נרשום לוג.
          // בעתיד, אפשר לשקול עדכון של רשימת השירותים של המכשיר.
          logger.debug(`_handleSsdpMessage: Received ssdp:byebye for a specific service of device UDN=${deviceUdn}, USN=${basicDevice.usn}. Device not removed.`, { UDN: deviceUdn, usn: basicDevice.usn, serviceSt: basicDevice.st });
        }
      } else {
        logger.debug(`_handleSsdpMessage: Received ssdp:byebye for an unknown device UDN: ${deviceUdn}, USN: ${basicDevice.usn}`, { UDN: deviceUdn, usn: basicDevice.usn, remoteAddress: basicDevice.remoteAddress });
      }
      return;
    }

    // טיפול בהודעות אחרות (alive או תגובה ל-M-SEARCH)
    let expiresAt: number;
    if (basicDevice.cacheControlMaxAge && basicDevice.cacheControlMaxAge > 0) {
      expiresAt = Date.now() + (basicDevice.cacheControlMaxAge * 1000);
    } else {
      expiresAt = Date.now() + (this.options.mSearchIntervalMs * 3);
      logger.debug(`_handleSsdpMessage: No valid max-age in CACHE-CONTROL for UDN: ${basicDevice.UDN}, USN: ${basicDevice.usn}. Using default expiration.`, { UDN: basicDevice.UDN, usn: basicDevice.usn, headers: basicDevice.headers, defaultExpiresIn: this.options.mSearchIntervalMs * 3 });
    }

    const deviceUdn = basicDevice.UDN;
    const existingDevice = this.activeDevices.get(deviceUdn);

    if (existingDevice) {
      // מכשיר קיים
      existingDevice.lastSeen = Date.now();
      existingDevice.expiresAt = expiresAt;
      // עדכון פרטים בסיסיים מההודעה הנוכחית אם השתנו (למשל, location, server)
      // חשוב: אם ה-location השתנה, זה יכול להצביע על שינוי משמעותי
      const locationChanged = existingDevice.location !== basicDevice.location && basicDevice.location;
      if (locationChanged) {
        logger.info(`_handleSsdpMessage: Location changed for existing device UDN=${deviceUdn}. Old: ${existingDevice.location}, New: ${basicDevice.location}`);
        existingDevice.location = basicDevice.location!;
      }
      existingDevice.server = basicDevice.server || existingDevice.server;
      existingDevice.remoteAddress = basicDevice.remoteAddress;
      existingDevice.remotePort = basicDevice.remotePort;
      // עדכון ה-USN של ה-root device אם ההודעה הנוכחית היא מה-root device
      if (basicDevice.usn.startsWith(deviceUdn) && (basicDevice.st === 'upnp:rootdevice' || basicDevice.usn.includes('::upnp:rootdevice') || basicDevice.usn === deviceUdn)) {
        existingDevice.usn = basicDevice.usn;
      }


      let detailLevelUpdated = false;

      if ((locationChanged || existingDevice.detailLevelAchieved < this.options.detailLevel) && basicDevice.location) {
        logger.debug(`_handleSsdpMessage: Attempting to update details for existing device: UDN=${deviceUdn}`, { currentDetailLevel: existingDevice.detailLevelAchieved, requestedDetailLevel: this.options.detailLevel, locationChanged });
        try {
          const processedData = await processUpnpDevice(basicDevice, this.options.detailLevel);
          if (processedData) {
            // מיזוג זהיר: שדות מ-processedData גוברים, אך שדות חיוניים כמו UDN נשמרים.
            // lastSeen ו-expiresAt כבר עודכנו למעלה.
            const currentUdn = existingDevice.UDN; // שמירת ה-UDN
            const currentRootUsn = existingDevice.usn; // שמירת ה-USN של ה-root

            Object.assign(existingDevice, processedData);

            existingDevice.UDN = currentUdn; // הבטחת ה-UDN המקורי
            // אם ה-USN ב-processedData הוא של שירות, נשמור את ה-USN של ה-root
            if (processedData.usn && !processedData.usn.startsWith(currentUdn) || (processedData.usn.includes('::') && !processedData.usn.includes('::upnp:rootdevice'))) {
                existingDevice.usn = currentRootUsn;
            } else if (processedData.usn) {
                existingDevice.usn = processedData.usn; // אם זה USN של root, נעדכן
            }


            existingDevice.detailLevelAchieved = processedData.detailLevelAchieved || this.options.detailLevel;
            existingDevice.lastSeen = Date.now();
            existingDevice.expiresAt = expiresAt;

            detailLevelUpdated = true;
            // logger.info(`_handleSsdpMessage: Successfully updated details for device: UDN=${existingDevice.UDN} to level ${existingDevice.detailLevelAchieved}`, { UDN: existingDevice.UDN, usn: existingDevice.usn });
          } else {
            logger.warn(`_handleSsdpMessage: Failed to get updated description for existing device: UDN=${deviceUdn} from location ${basicDevice.location}`, { UDN: deviceUdn, usn: basicDevice.usn });
          }
        } catch (error) {
          logger.error(`_handleSsdpMessage: Error processing device description update for existing device UDN=${deviceUdn}: ${error instanceof Error ? error.message : String(error)}`, { UDN: deviceUdn, usn: basicDevice.usn, location: basicDevice.location, error });
        }
      }
      // הודעת לוג מותאמת לאחר עדכון מכשיר קיים
      if (detailLevelUpdated || locationChanged) {
        logger.info(`Device details significantly updated: UDN=${existingDevice.UDN}, NewLevel=${existingDevice.detailLevelAchieved}, LocationChanged=${locationChanged}, USN=${existingDevice.usn}`);
      } else {
        logger.debug(`Device refreshed (heartbeat): UDN=${existingDevice.UDN}, USN=${existingDevice.usn}`);
      }

      this.activeDevices.set(existingDevice.UDN, existingDevice); // המפתח הוא UDN
      this.emit('deviceupdated', existingDevice.UDN, existingDevice); // שולחים UDN
      // logger.debug(`_handleSsdpMessage: Device updated: UDN=${existingDevice.UDN}`, { UDN: existingDevice.UDN, usn: existingDevice.usn, detailLevelUpdated }); // כבר טופל למעלה

    } else {
      // מכשיר חדש
      if (!basicDevice.location) {
        logger.error('_handleSsdpMessage: Trying to process new device without location. This should not happen.', { UDN: basicDevice.UDN, usn: basicDevice.usn });
        return;
      }

      logger.debug(`_handleSsdpMessage: Attempting to process new device: UDN=${basicDevice.UDN}, USN=${basicDevice.usn} at ${basicDevice.location}`, { requestedDetailLevel: this.options.detailLevel });
      try {
        const processedData = await processUpnpDevice(basicDevice, this.options.detailLevel);
        if (processedData) {
          const newApiDevice: ServerApiDevice = {
            // שדות מ-BasicSsdpDevice (דרך processedData)
            usn: processedData.usn, // ה-USN מההודעה שגרמה לגילוי/עיבוד
            UDN: basicDevice.UDN, // ה-UDN שחולץ מההודעה המקורית
            location: processedData.location || basicDevice.location || '',
            server: processedData.server || '',
            st: processedData.st,
            remoteAddress: processedData.remoteAddress,
            remotePort: processedData.remotePort,
            headers: processedData.headers,
            timestamp: processedData.timestamp,
            messageType: processedData.messageType,
            httpMethod: processedData.httpMethod,
            httpStatusCode: processedData.httpStatusCode,
            httpStatusMessage: processedData.httpStatusMessage,
            cacheControlMaxAge: processedData.cacheControlMaxAge,
            nts: processedData.nts,
            httpVersion: processedData.httpVersion,

            // שדות מ-DeviceDescription
            deviceType: (processedData as DeviceDescription).deviceType || basicDevice.st,
            friendlyName: (processedData as DeviceDescription).friendlyName || basicDevice.UDN, // שימוש ב-UDN אם אין שם ידידותי
            manufacturer: (processedData as DeviceDescription).manufacturer || '',
            manufacturerURL: (processedData as DeviceDescription).manufacturerURL,
            modelDescription: (processedData as DeviceDescription).modelDescription,
            modelName: (processedData as DeviceDescription).modelName || '',
            modelNumber: (processedData as DeviceDescription).modelNumber,
            modelURL: (processedData as DeviceDescription).modelURL,
            serialNumber: (processedData as DeviceDescription).serialNumber,
            // UDN כבר הוגדר למעלה מ-basicDevice.UDN
            presentationURL: (processedData as DeviceDescription).presentationURL,
            iconList: (processedData as DeviceDescription).iconList || [],
            serviceList: (processedData as DeviceDescription).serviceList || new Map(),
            deviceList: (processedData as DeviceDescription).deviceList,
            baseURL: (processedData as DeviceDescription).baseURL,
            URLBase: (processedData as DeviceDescription).URLBase,
            UPC: (processedData as DeviceDescription).UPC,

            // שדות מ-ApiDevice
            lastSeen: Date.now(),
            expiresAt,
            detailLevelAchieved: processedData.detailLevelAchieved || DiscoveryDetailLevel.Basic,
          };
          // ודא שה-UDN ב-newApiDevice הוא אכן ה-UDN שחולץ מההודעה
          newApiDevice.UDN = basicDevice.UDN;
          // ודא שה-USN ב-newApiDevice הוא ה-USN של ה-root device אם אפשר
          if (newApiDevice.usn && newApiDevice.usn.startsWith(basicDevice.UDN) && (newApiDevice.st === 'upnp:rootdevice' || newApiDevice.usn.includes('::upnp:rootdevice') || newApiDevice.usn === basicDevice.UDN)) {
            // ה-USN הנוכחי הוא כנראה של ה-root, אז זה בסדר
          } else {
            // אם ה-USN הנוכחי הוא של שירות, ננסה לשים את ה-USN מההודעה המקורית אם הוא של ה-root
            if (basicDevice.usn.startsWith(basicDevice.UDN) && (basicDevice.st === 'upnp:rootdevice' || basicDevice.usn.includes('::upnp:rootdevice') || basicDevice.usn === basicDevice.UDN)) {
              newApiDevice.usn = basicDevice.usn;
            }
            // אחרת, ה-USN יישאר כפי שהוא מ-processedData, וזה יכול להיות USN של שירות
          }


          logger.debug(`_handleSsdpMessage: Created newApiDevice for UDN '${newApiDevice.UDN}', USN '${newApiDevice.usn}': friendlyName='${newApiDevice.friendlyName}'`);
          this.activeDevices.set(newApiDevice.UDN, newApiDevice); // מפתח הוא UDN
          this.emit('devicefound', newApiDevice.UDN, newApiDevice); // שולחים UDN
          logger.info(`_handleSsdpMessage: (INFO) Processed newApiDevice for UDN '${newApiDevice.UDN}', USN '${newApiDevice.usn}': friendlyName='${newApiDevice.friendlyName}', detailLevel='${newApiDevice.detailLevelAchieved}'`);

        } else {
          if (this.options.detailLevel === DiscoveryDetailLevel.Basic) {
            const basicApiDevice: ServerApiDevice = {
              ...basicDevice, // כל השדות מ-BasicSsdpDevice, כולל UDN
              deviceType: basicDevice.st,
              friendlyName: basicDevice.UDN, // שימוש ב-UDN אם אין שם ידידותי
              manufacturer: '',
              modelName: '',
              // UDN כבר כלול ב-basicDevice
              iconList: [],
              serviceList: new Map(),
              lastSeen: Date.now(),
              expiresAt,
              detailLevelAchieved: DiscoveryDetailLevel.Basic,
            };
            logger.debug(`_handleSsdpMessage: Created basicApiDevice for UDN '${basicApiDevice.UDN}', USN '${basicApiDevice.usn}': friendlyName='${basicApiDevice.friendlyName}'`);
            this.activeDevices.set(basicApiDevice.UDN, basicApiDevice); // מפתח הוא UDN
            this.emit('devicefound', basicApiDevice.UDN, basicApiDevice); // שולחים UDN
            logger.info(`_handleSsdpMessage: (INFO) Processed basicApiDevice for UDN '${basicApiDevice.UDN}', USN '${basicApiDevice.usn}': friendlyName='${basicApiDevice.friendlyName}', detailLevel='${basicApiDevice.detailLevelAchieved}'`);
          } else {
            logger.warn(`_handleSsdpMessage: Failed to get sufficient description for new device: UDN=${basicDevice.UDN}, USN=${basicDevice.usn} at ${basicDevice.location} (requested level: ${this.options.detailLevel}). Device not added.`, { UDN: basicDevice.UDN, usn: basicDevice.usn });
          }
        }
      } catch (error) {
        logger.error(`_handleSsdpMessage: Error processing device description for new device UDN=${basicDevice.UDN}, USN=${basicDevice.usn}: ${error instanceof Error ? error.message : String(error)}`, { UDN: basicDevice.UDN, usn: basicDevice.usn, location: basicDevice.location, error });
      }
    }
  }

  /**
   * @hebrew מסיר מכשירים שפג תוקפם מרשימת המכשירים הפעילים.
   * מתודה זו נקראת באופן תקופתי.
   */
  private _cleanupDevices(): void {
    const now = Date.now();
    logger.debug(`_cleanupDevices: Starting cleanup. Current active devices: ${this.activeDevices.size}`);

    for (const [udn, device] of this.activeDevices.entries()) {
      if (device.expiresAt < now) {
        this.activeDevices.delete(udn);
        // האירוע 'devicelost' מצפה לקבל את ה-UDN ואת אובייקט ה-ApiDevice
        this.emit('devicelost', udn, device);
        logger.info(`_cleanupDevices: Removed expired device: UDN=${udn} (FriendlyName: ${device.friendlyName}, USN: ${device.usn}, ExpiresAt: ${new Date(device.expiresAt).toISOString()})`, { udn, friendlyName: device.friendlyName, usn: device.usn });
      }
    }
    logger.debug(`_cleanupDevices: Finished cleanup. Active devices after cleanup: ${this.activeDevices.size}`);
  }

  /**
   * @hebrew מתחיל את תהליך גילוי המכשירים.
   * מאתחל סוקטים, שולח M-SEARCH ראשוני ומפעיל טיימרים תקופתיים.
   * @returns Promise<void>
   */
  public async start(): Promise<void> {
    logger.info('Attempting to start ActiveDeviceManager...');
    if (this.isRunning) {
      logger.warn('ActiveDeviceManager is already running. Start request ignored.');
      return Promise.resolve();
    }

    try {
      // אתחול socketManager
      logger.debug('Creating socket manager...');

      let networkInterfacesArg: NodeJS.Dict<os.NetworkInterfaceInfo[]> | undefined = undefined;
      if (this.options.networkInterfaces && this.options.networkInterfaces.length > 0) {
        if (typeof this.options.networkInterfaces[0] === 'string') {
          // Case: string[] - filter os.networkInterfaces()
          const selectedInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {};
          const allOsInterfaces = os.networkInterfaces();
          (this.options.networkInterfaces as string[]).forEach(name => {
            if (allOsInterfaces[name]) {
              selectedInterfaces[name] = allOsInterfaces[name]!;
            }
          });
          if (Object.keys(selectedInterfaces).length > 0) {
            networkInterfacesArg = selectedInterfaces;
          }
        } else if (typeof this.options.networkInterfaces === 'object' && !Array.isArray(this.options.networkInterfaces)) {
          // Case: NodeJS.Dict<os.NetworkInterfaceInfo[]> - use directly
          // We need to ensure it's not an empty array that was cast to object
          if (Object.keys(this.options.networkInterfaces).length > 0) {
            networkInterfacesArg = this.options.networkInterfaces as NodeJS.Dict<os.NetworkInterfaceInfo[]>;
          }
        }
      }

      this.socketManager = await createSocketManager(
        { // Options for createSocketManager
          includeIPv6: this.options.includeIPv6,
        },
        // onMessage callback
        (msg: Buffer, rinfo: RemoteInfo, socketType: string) => {
          // טיפול ב-onRawSsdpMessage אם סופק
          if (this.options.onRawSsdpMessage && typeof this.options.onRawSsdpMessage === 'function') {
            try {
              // ודא שהקריאה תואמת לחתימה של RawSsdpMessageHandler
              this.options.onRawSsdpMessage({ message: msg, remoteInfo: rinfo, socketType: socketType });
            } catch (rawCbError: any) {
              logger.error('Error in user-provided onRawSsdpMessage callback:', rawCbError);
            }
          }
          // קריאה ל-handler הפנימי
          this._handleSsdpMessage(msg, rinfo, socketType).catch((err: Error) => {
            logger.error(`Error in _handleSsdpMessage for socketType ${socketType}:`, err);
          });
        },
        // onError callback
        (err: Error, socketType: string) => {
          logger.error(`Socket error on ${socketType}:`, err);
          this.emit('error', err); // פליטת אירוע שגיאה מהמחלקה
        },
        // networkInterfaces (optional)
        networkInterfacesArg
      );
      logger.info('Socket manager created successfully.');

      // שליחת M-SEARCH ראשוני
      if (this.socketManager) {
        logger.debug(`Sending initial M-SEARCH for target: ${this.options.searchTarget}`);
        // נשלח גם ל-IPv4 וגם ל-IPv6 אם רלוונטי
        this.socketManager.sendMSearch(this.options.searchTarget, 4).catch((err: Error) => {
          logger.error('Error sending initial M-SEARCH IPv4:', err);
        });
        if (this.options.includeIPv6) {
          this.socketManager.sendMSearch(this.options.searchTarget, 6).catch((err: Error) => {
            logger.error('Error sending initial M-SEARCH IPv6:', err);
          });
        }
      } else {
        logger.error('Socket manager not initialized, cannot send initial M-SEARCH.');
        // במקרה כזה, סביר להניח ש-createSocketManager נכשל והשגיאה כבר טופלה/נפלטה.
        // אולי נרצה לזרוק שגיאה כאן כדי לעצור את תהליך ה-start.
        throw new Error('Socket manager initialization failed.');
      }

      // הפעלת setInterval ל-M-SEARCH תקופתי
      if (this.mSearchIntervalId) {
        clearInterval(this.mSearchIntervalId);
      }
      this.mSearchIntervalId = setInterval(() => {
        if (this.socketManager && this.isRunning) {
          logger.debug(`Sending periodic M-SEARCH for target: ${this.options.searchTarget}`);
          this.socketManager.sendMSearch(this.options.searchTarget, 4).catch((err: Error) => {
            logger.error('Error sending periodic M-SEARCH IPv4:', err);
          });
          if (this.options.includeIPv6) {
            this.socketManager.sendMSearch(this.options.searchTarget, 6).catch((err: Error) => {
              logger.error('Error sending periodic M-SEARCH IPv6:', err);
            });
          }
        }
      }, this.options.mSearchIntervalMs);
      logger.info(`Periodic M-SEARCH interval set for ${this.options.mSearchIntervalMs}ms.`);

      // הפעלת setInterval ל-_cleanupDevices
      if (this.cleanupIntervalId) {
        clearInterval(this.cleanupIntervalId);
      }
      this.cleanupIntervalId = setInterval(() => {
        if (this.isRunning) {
          this._cleanupDevices();
        }
      }, this.options.deviceCleanupIntervalMs);
      logger.info(`Device cleanup interval set for ${this.options.deviceCleanupIntervalMs}ms.`);

      // עדכון מצב ופליטת אירוע
      this.isRunning = true;
      this.emit('started');
      logger.info('ActiveDeviceManager started successfully.');

    } catch (error) {
      logger.error('Failed to start ActiveDeviceManager:', error);
      this.isRunning = false; // ודא שהמצב נשאר false אם ההתחלה נכשלה
      // אם socketManager נוצר חלקית, נסגור אותו
      if (this.socketManager) {
        this.socketManager.closeAll().catch((closeErr: any) => {
          logger.error('Error closing socket manager during failed start:', closeErr);
        });
        this.socketManager = null;
      }
      // נקה אינטרוולים אם נוצרו
      if (this.mSearchIntervalId) {
        clearInterval(this.mSearchIntervalId);
        this.mSearchIntervalId = null;
      }
      if (this.cleanupIntervalId) {
        clearInterval(this.cleanupIntervalId);
        this.cleanupIntervalId = null;
      }
      // פליטת שגיאה או זריקה מחדש כדי שהקוד הקורא ידע על הכשל
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      // אין צורך לזרוק מחדש אם פולטים אירוע, אלא אם כן החוזה של הפונקציה דורש זאת.
      // כאן, מכיוון שהפונקציה מחזירה Promise<void>, פליטת אירוע מספיקה.
      // אם רוצים שה-Promise ידחה, יש להשתמש ב-return Promise.reject(error);
      return Promise.reject(error);
    }
  }

  /**
     * @hebrew מחזירה עותק של רשימת המכשירים הפעילים שזוהו.
     * @returns Map&lt;string, ApiDevice&gt; - מפה של המכשירים הפעילים.
     */
  public getActiveDevices(): Map<string, ServerApiDevice> {
    // החזרת עותק של המפה כדי למנוע שינויים חיצוניים ישירים
    return new Map(this.activeDevices);
  }
  /**
   * @hebrew עוצר את תהליך גילוי המכשירים.
   * מנקה טיימרים, סוגר סוקטים ומנקה את רשימת המכשירים.
   * @returns Promise<void>
   */
  public async stop(): Promise<void> {
    logger.info('Attempting to stop ActiveDeviceManager...');
    if (!this.isRunning) {
      logger.warn('ActiveDeviceManager is not running. Stop request ignored.');
      return Promise.resolve();
    }

    // ניקוי אינטרוולים
    if (this.mSearchIntervalId) {
      clearInterval(this.mSearchIntervalId);
      this.mSearchIntervalId = null;
      logger.debug('M-SEARCH interval cleared.');
    }
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      logger.debug('Cleanup interval cleared.');
    }

    // סגירת socketManager
    if (this.socketManager) {
      try {
        logger.debug('Closing socket manager...');
        // המתודה ב-ssdpSocketManager נקראת closeAll
        await this.socketManager.closeAll();
        logger.info('Socket manager closed successfully.');
      } catch (error) {
        logger.error('Error closing socket manager:', error);
        // נמשיך בתהליך העצירה גם אם יש שגיאה בסגירת הסוקטים
      } finally {
        this.socketManager = null;
      }
    }

    // ניקוי activeDevices
    this.activeDevices.clear();
    logger.debug('Active devices list cleared.');

    // עדכון מצב ופליטת אירוע
    this.isRunning = false;
    this.emit('stopped');
    logger.info('ActiveDeviceManager stopped successfully.');
    return Promise.resolve();
  }

  // כאן יתווספו מתודות נוספות בהמשך
}