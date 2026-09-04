import {
  ActiveDeviceManager,
  type ApiDevice,
  type ActiveDeviceManagerOptions,
  DiscoveryDetailLevel,
} from '../packages/dlna-core/src/index'; // שימוש בנתיב יחסי
import { createModuleLogger, setLogger } from '../packages/dlna-core/src/logger'; // שימוש בנתיב יחסי
setLogger(console);

const logger = createModuleLogger('ADMOutputTest');

async function main() {
  const options: ActiveDeviceManagerOptions = {
    searchTarget: 'ssdp:all',
    mSearchIntervalMs: 10000, // חיפוש כל 10 שניות
    deviceCleanupIntervalMs: 30000,
    detailLevel: DiscoveryDetailLevel.Full, // בקש פרטים מלאים
  };

  const deviceManager = new ActiveDeviceManager(options);

  logger.info('Starting ActiveDeviceManager for output test...');

  deviceManager.on('devicefound', (usn: string, device: ApiDevice) => {
    logger.info(`==================== DEVICE FOUND (Output Test) ====================`);
    logger.info(`Received USN from event: ${usn}`);
    logger.info(`Device FriendlyName: ${device.friendlyName}`);
    logger.info(`Device UDN: ${device.UDN}`);
    logger.info(`Device USN from object: ${device.usn}`);
    logger.info(`Device Location: ${device.location}`);
    logger.info(`Device ST: ${device.st}`);
    logger.info(`Device detailLevelAchieved: ${device.detailLevelAchieved}`);
    
    // הדפסת האובייקט המלא
    // שימוש ב-replacer כדי לטפל ב-Map (כמו serviceList)
    const replacer = (key: string, value: any) => {
      if (value instanceof Map) {
        return {
          dataType: 'Map',
          value: Array.from(value.entries()), // המרה למערך של [key, value]
        };
      }
      return value;
    };
    logger.info('Full device object:');
    console.log(JSON.stringify(device, replacer, 2));
    logger.info(`==================================================================`);
  });

  deviceManager.on('error', (err: Error) => {
    logger.error('ADM Output Test - Error:', err);
  });

  await deviceManager.start();

  // המתן זמן מה כדי לאפשר גילוי
  const testDuration = 20000; // 20 שניות
  logger.info(`Running test for ${testDuration / 1000} seconds...`);
  await new Promise(resolve => setTimeout(resolve, testDuration));

  logger.info('Stopping ActiveDeviceManager for output test...');
  await deviceManager.stop();
  logger.info('Test finished.');
}

main().catch(error => {
  logger.error('Unhandled error in ADM Output Test main function:', error);
  process.exit(1);
});