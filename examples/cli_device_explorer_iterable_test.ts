import {
  discoverSsdpDevicesIterable,
  DiscoveryDetailLevel,
  type FullDeviceDescription,
  createLogger,
  setLogger,
} from 'dlna.js'; // ייבוא מהחבילה הראשית
setLogger(console);

const logger = createLogger('IterableTest');

async function testDeviceDiscovery() {
  logger.info('Starting iterable device discovery test...');
  const abortController = new AbortController();
  const internalTimeoutMs = 7000; // זמן קצוב פנימי לפונקציה
  const externalAbortDelayMs = internalTimeoutMs + 2000; // זמן להפעלת AbortController חיצוני, אחרי הפנימי

  logger.info(`Starting testDeviceDiscovery with internalTimeoutMs: ${internalTimeoutMs}ms and externalAbortDelayMs: ${externalAbortDelayMs}ms`);

  try {
    const discoveryOptions = {
      detailLevel: DiscoveryDetailLevel.Full,
      timeoutMs: internalTimeoutMs, // זה ה-timeout שהפונקציה discoverSsdpDevicesIterable אמורה לכבד
      abortSignal: abortController.signal,
      // ניתן להוסיף כאן אופציות נוספות לבדיקה, כמו searchTarget
    };

    logger.info(`Calling discoverSsdpDevicesIterable with options: ${JSON.stringify(discoveryOptions)}`);

    // הגדרת טיימר לביטול הגילוי באמצעות AbortController חיצוני, למקרה שה-timeout הפנימי לא עובד
    let externalAbortTimer: NodeJS.Timeout | null = setTimeout(() => {
      logger.warn(`External abort timer (${externalAbortDelayMs}ms) reached. Aborting discovery via AbortController.`);
      abortController.abort("External abort timer triggered");
      externalAbortTimer = null; // לסמן שהטיימר פעל
    }, externalAbortDelayMs);

    let deviceCount = 0;
    const startTime = Date.now();
    logger.info('Starting iteration over discoverSsdpDevicesIterable...');
    for await (const device of discoverSsdpDevicesIterable(discoveryOptions)) {
      deviceCount++;
      const fullDevice = device as FullDeviceDescription; // הנחה שנקבל פרטים מלאים
      logger.info(`Discovered device (${deviceCount}): ${fullDevice.friendlyName} (${fullDevice.modelName}) at ${fullDevice.baseURL}`);
      // כאן ניתן להוסיף בדיקות נוספות על המכשיר שהתגלה
    }
    const endTime = Date.now();
    const duration = endTime - startTime;
    logger.info(`Iteration finished. Duration: ${duration}ms. Discovered ${deviceCount} devices.`);

    if (externalAbortTimer) { // אם הטיימר החיצוני עדיין קיים, זה אומר שהלולאה הסתיימה לפניו
      clearTimeout(externalAbortTimer);
      logger.info("Cleared external abort timer, meaning discovery likely ended due to internal timeout or completion.");
    } else {
      logger.warn("External abort timer was triggered, meaning internal timeout might not have worked as expected or took longer.");
    }

    if (deviceCount > 0) {
      logger.info(`Successfully discovered ${deviceCount} devices within the specified timeout.`);
    } else {
      logger.warn('No devices discovered. This might be normal if no devices are on the network, or an issue with discovery/timeout.');
    }

  } catch (error: any) {
    if (error.name === 'AbortError' || (error instanceof DOMException && error.name === 'AbortError')) {
      logger.info(`Discovery aborted as expected. Reason: ${error.message || 'No reason provided'}`);
    } else {
      logger.error('An error occurred during iterable device discovery:', error);
    }
  } finally {
    logger.info('testDeviceDiscovery finished.');
  }
}

async function testEarlyAbort() {
  logger.info('\nStarting testEarlyAbort...');
  const earlyAbortController = new AbortController();
  const earlyAbortTimeoutMs = 2000; // בטל לאחר 2 שניות
  const discoveryTimeoutMs = 10000; // זמן קצוב ארוך יותר לפונקציה, הביטול אמור לקרות קודם

  logger.info(`Will trigger AbortController after ${earlyAbortTimeoutMs}ms.`);
  setTimeout(() => {
      logger.info(`Manually aborting discovery early after ${earlyAbortTimeoutMs}ms...`);
      earlyAbortController.abort("Manual early abort for testing");
  }, earlyAbortTimeoutMs);

  try {
    const discoveryOptionsEarlyAbort = {
      detailLevel: DiscoveryDetailLevel.Basic, // מספיק בסיסי לבדיקת ביטול
      timeoutMs: discoveryTimeoutMs,
      abortSignal: earlyAbortController.signal,
    };
    logger.info(`Calling discoverSsdpDevicesIterable for early abort test with options: ${JSON.stringify(discoveryOptionsEarlyAbort)}`);
    let deviceCountEarlyAbort = 0;
    const startTime = Date.now();
    for await (const device of discoverSsdpDevicesIterable(discoveryOptionsEarlyAbort)) {
        deviceCountEarlyAbort++;
        logger.info(`(Early Abort Test) Discovered device: ${device.usn}`);
    }
    const endTime = Date.now();
    const duration = endTime - startTime;
    logger.info(`(Early Abort Test) Iteration finished. Duration: ${duration}ms. Discovered ${deviceCountEarlyAbort} devices.`);

    if (earlyAbortController.signal.aborted) {
        if (deviceCountEarlyAbort === 0) {
            logger.info('Early abort test: No devices discovered and signal was aborted as expected.');
        } else {
            logger.warn(`Early abort test: Discovered ${deviceCountEarlyAbort} devices. Signal was aborted, but discovery yielded results. This might be okay if discovery was very fast.`);
        }
        if (duration < discoveryTimeoutMs - 500) { // בדיקה שהביטול קרה משמעותית לפני ה-timeout של הפונקציה
             logger.info(`Early abort test: Duration (${duration}ms) is less than discovery timeout (${discoveryTimeoutMs}ms), indicating abort likely worked.`);
        } else {
            logger.warn(`Early abort test: Duration (${duration}ms) is close to or exceeds discovery timeout (${discoveryTimeoutMs}ms). Abort might not have been effective or timely.`);
        }
    } else {
        logger.warn('Early abort test: Signal was NOT aborted as expected. This is an issue.');
    }
  } catch (error: any) {
    if (error.name === 'AbortError' || (error instanceof DOMException && error.name === 'AbortError')) {
      logger.info(`Early abort test: Discovery aborted successfully as expected. Reason: ${error.message || 'No reason provided'}`);
    } else {
      logger.error('Early abort test: An error occurred:', error);
    }
  } finally {
    logger.info('testEarlyAbort finished.');
  }
}


async function main() {
  await testDeviceDiscovery();
  await testEarlyAbort();
  logger.info("\nAll tests in cli_device_explorer_iterable_test.ts finished.");
}

main().catch(error => {
  logger.error('Unhandled error in main of cli_device_explorer_iterable_test.ts:', error);
});