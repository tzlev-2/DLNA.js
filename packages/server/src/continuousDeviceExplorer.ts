import { EventEmitter } from 'events';
import { createModuleLogger } from './logger';
import {
  ProcessedDevice,
  DiscoveryDetailLevel,
  DeviceDescription,
  FullDeviceDescription,
  DeviceWithServicesDescription,
  // discoverSsdpDevices, // הוסב להערה כדי למנוע שגיאת build
} from 'dlna.js';
import type { RawSsdpMessageHandler, DiscoveryOptions } from 'dlna.js'; // Assuming logger is needed

import type { ContinueDiscoveryOptions } from './types'; // ייבוא ישירות מ-types.ts
import type { RemoteInfo } from 'node:dgram'; // הוספת ייבוא, למרות שלא נשתמש ישירות בחתימה כרגע

const logger = createModuleLogger('ContinuousDeviceExplorer');


// ברירות מחדל עבור הגילוי הרציף
const DEFAULT_DISCOVERY_OPTIONS: ContinueDiscoveryOptions = {
  timeoutMs: 30 * 1000, // 10 שניות לכל סבב גילוי
  detailLevel: DiscoveryDetailLevel.Full,
  searchTarget: 'ssdp:all',
  continuousIntervalMs: 50 * 1000
};

export class ContinuousDeviceExplorer extends EventEmitter {
  private discoveryOptions: ContinueDiscoveryOptions;
  private intervalId?: NodeJS.Timeout;
  private isDiscovering: boolean = false;
  private abortController?: AbortController;

  constructor(options?: Partial<ContinueDiscoveryOptions>) {
    super();
    this.discoveryOptions = { ...DEFAULT_DISCOVERY_OPTIONS, ...options };
  }

  public startDiscovery(): void {
    if (this.isDiscovering) {
      logger.warn('Discovery process is already running.');
      return;
    }
    logger.info('Starting continuous UPnP device discovery...');
    this.isDiscovering = true;
    this.runDiscoveryCycle(); // הפעלת סבב ראשון מיידי

    // הגדרת אינטרוול לסבבים הבאים
    this.intervalId = setInterval(() => {
      this.runDiscoveryCycle();
    }, this.discoveryOptions.continuousIntervalMs);
  }

  public stopDiscovery(): void {
    if (!this.isDiscovering) {
      logger.warn('Discovery process is not running.');
      return;
    }
    logger.info('Stopping continuous UPnP device discovery...');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
    this.isDiscovering = false;
    this.emit('stopped');
  }

  private async runDiscoveryCycle(): Promise<void> {
    if (this.abortController) { // אם יש סבב קודם שעדיין רץ, בטל אותו
      logger.debug('Aborting previous discovery cycle.');
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const currentSignal = this.abortController.signal;

    logger.debug('Starting new discovery cycle.', this.discoveryOptions);

    const onRawSsdpMessage: RawSsdpMessageHandler = payload => this.emit('rawResponse', payload);

    type OnDeviceFound = DiscoveryOptions['onDeviceFound'];

    const onDeviceFound: OnDeviceFound = (device) => {
      
      if (currentSignal.aborted) {
        logger.debug('Device found after abort, ignoring:', (device as DeviceDescription).UDN || device.usn);
        return;
      }
      // ודא שהמכשיר הוא לפחות DeviceDescription כדי לגשת לשדות הנדרשים
      if ('friendlyName' in device && 'modelName' in device && 'UDN' in device) { // תיקון ל-UDN
        this.emit('device', device as DeviceDescription | DeviceWithServicesDescription | FullDeviceDescription);
      } else if ('usn' in device && device.usn) { // USN קיים ב-BasicSsdpDevice
        // אם זה רק BasicSsdpDevice, ייתכן שנרצה לפלוט אותו או לוג
        // כאן אנחנו מצפים לפחות ל-DeviceDescription כדי לפלוט, אז אם זה רק Basic, נרשום לוג.
        logger.debug('Basic SSDP device found (has USN but not full details like UDN/friendlyName yet):', device.usn);
        // אפשר לפלוט אירוע אחר או לאגור אותו לעיבוד נוסף אם רוצים
      }
    }

    try {
      // await discoverSsdpDevices({ // הוסב להערה כדי למנוע שגיאת build
      //   ...this.discoveryOptions,
      //   abortSignal: currentSignal,
      //   onDeviceFound,
      //   onRawSsdpMessage
      // });
      logger.warn('discoverSsdpDevices call in ContinuousDeviceExplorer is commented out due to refactoring.');
      if (currentSignal.aborted) {
        logger.info('Discovery cycle was aborted.');
      } else {
        logger.debug('Discovery cycle completed.');
      }
    } catch (error: any) {
      if (currentSignal.aborted && error.message && error.message.includes('aborted')) {
        logger.info('Discovery cycle aborted as expected.');
      } else {
        logger.error('Error during discovery cycle:', error);
        this.emit('error', error);
      }
    } finally {
      if (this.abortController && this.abortController.signal === currentSignal) {
        // נקה את הבקר רק אם זה הבקר הנוכחי (למניעת race condition אם stopDiscovery נקרא)
        this.abortController = undefined;
      }
      logger.debug('Finished discovery cycle attempt.');
    }
  }

  // Helper to check if a device has the required fields
  // This can be used if we want to be more strict with the type emitted
  // private isDeviceWithDetails(device: ProcessedDevice): device is DeviceDescription | DeviceWithServicesDescription | FullDeviceDescription {
  //   return 'friendlyName' in device && 'modelName' in device && 'UDN' in device;
  // }
}