import {
  ActiveDeviceManager,
  type ApiDevice,
  type ActiveDeviceManagerOptions,
  DiscoveryDetailLevel,
} from '../packages/dlna-core/src/index'; // שימוש בנתיב יחסי
import { createModuleLogger, setLogger } from '../packages/dlna-core/src/logger'; // שימוש בנתיב יחסי
setLogger(console);

// יצירת לוגר לדוגמה
const logger = createModuleLogger('ActiveDeviceManagerExample');

// פונקציית עזר להדפסת רשימת ההתקנים הפעילים
function printActiveDevices(manager: ActiveDeviceManager, loggerInstance: ReturnType<typeof createModuleLogger>): void {
  const activeDevices = manager.getActiveDevices();
  loggerInstance.info(`--- Active Devices (${activeDevices.size}) ---`);
  if (activeDevices.size === 0) {
    loggerInstance.info('(No active devices found yet)');
  } else {
    activeDevices.forEach((device, usn) => {
      loggerInstance.info(`- Name: ${device.friendlyName}`);
      loggerInstance.info(`  USN: ${usn}`);
      loggerInstance.info(`  IP: ${device.remoteAddress}:${device.remotePort}`);
      loggerInstance.info(`  ST: ${device.st}`);
      loggerInstance.info(`  Last Seen: ${new Date(device.lastSeen).toLocaleString()}`);
      loggerInstance.info(`  Expires At: ${new Date(device.expiresAt).toLocaleString()}`);
      let detailLevelString: string;
      switch (device.detailLevelAchieved) {
        case DiscoveryDetailLevel.Basic:
          detailLevelString = "Basic";
          break;
        case DiscoveryDetailLevel.Description:
          detailLevelString = "Description";
          break;
        case DiscoveryDetailLevel.Full:
          detailLevelString = "Full";
          break;
        default:
          // זה לא אמור לקרות אם הטיפוס נכון וה-enum מכסה את כל האפשרויות
          // שימוש ב-loggerInstance שהועבר לפונקציה
          loggerInstance.warn(`Unknown detail level value: ${device.detailLevelAchieved as any}`);
          detailLevelString = "Unknown";
          break;
      }
      loggerInstance.info(`  Detail Level: ${detailLevelString}`);
      loggerInstance.info(`  ---`); // מפריד בין מכשירים
    });
  }
  loggerInstance.info(`-----------------------------`);
}

async function main() {
  // אופציות לדוגמה עבור מנהל ההתקנים
  const options: ActiveDeviceManagerOptions = {
    searchTarget: 'ssdp:all', // חפש את כל סוגי ההתקנים
    mSearchIntervalMs: 15000, // בצע חיפוש כל 15 שניות
    deviceCleanupIntervalMs: 45000, // נקה התקנים ישנים כל 45 שניות
    detailLevel: DiscoveryDetailLevel.Description, // בקש פרטי תיאור (יותר מ-Basic)
  };

  // יצירת מופע של מנהל ההתקנים
  const deviceManager = new ActiveDeviceManager(options);

  // רישום לאירועים
  deviceManager.on('started', () => {
    logger.info('EVENT: ActiveDeviceManager has started.');
  });

  deviceManager.on('stopped', () => {
    logger.info('EVENT: ActiveDeviceManager has stopped.');
  });

  deviceManager.on('error', (err: Error) => {
    logger.error('EVENT: ActiveDeviceManager encountered an error:', err);
  });

  deviceManager.on('devicefound', (usn: string, device: ApiDevice) => {
    logger.info(`EVENT: Device Found - ${device.friendlyName} (USN: ${usn})`);
    printActiveDevices(deviceManager, logger); // הדפסת הרשימה המעודכנת
  });

  deviceManager.on('deviceupdated', (usn: string, device: ApiDevice) => {
    logger.info(`EVENT: Device Updated - ${device.friendlyName} (USN: ${usn})`);
    printActiveDevices(deviceManager, logger); // הדפסת הרשימה המעודכנת
  });

  deviceManager.on('devicelost', (usn: string, device: ApiDevice) => {
    logger.info(`EVENT: Device Lost - USN: ${usn} (FriendlyName: ${device?.friendlyName || 'N/A'})`);
    printActiveDevices(deviceManager, logger); // הדפסת הרשימה המעודכנת
  });

  logger.info('Starting ActiveDeviceManager...');
  await deviceManager.start();

  // הדפסה תקופתית של רשימת ההתקנים
  const printIntervalMs = 20000; // כל 20 שניות
  logger.info(`Will print active devices list every ${printIntervalMs / 1000} seconds.`);
  const periodicPrintIntervalId = setInterval(() => {
    logger.info('Periodic refresh of active devices list:');
    printActiveDevices(deviceManager, logger);
  }, printIntervalMs);

  // המתנה של 90 שניות כדי לאפשר גילוי התקנים וצפייה בריענונים
  const discoveryDurationMs = 90000;
  logger.info(`Running device discovery for ${discoveryDurationMs / 1000} seconds...`);
  await new Promise(resolve => setTimeout(resolve, discoveryDurationMs));

  // ניקוי האינטרוול התקופתי
  clearInterval(periodicPrintIntervalId);
  logger.info('Stopped periodic printing of active devices.');

  logger.info('Final active devices list before stopping:');
  printActiveDevices(deviceManager, logger);

  logger.info('Stopping ActiveDeviceManager...');
  await deviceManager.stop();

  // המתנה קצרה לוודא שכל הלוגים נרשמו
  await new Promise(resolve => setTimeout(resolve, 2000));
  logger.info('Example script finished.');
}

main().catch(error => {
  const generalLogger = createModuleLogger('MainExecution');
  generalLogger.error('Unhandled error in main function:', error);
  process.exit(1); // יציאה עם קוד שגיאה
});