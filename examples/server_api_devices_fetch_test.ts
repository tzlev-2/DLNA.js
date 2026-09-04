import { createModuleLogger, setLogger } from '../packages/dlna-core/src/logger';
setLogger(console);
import type { Subprocess } from 'bun';
import path from 'path';

const logger = createModuleLogger('ServerApiIntegrationTest');
const SERVER_API_URL = 'http://localhost:3300/api/devices';
const SERVER_READY_MESSAGE = 'Server listening on port 3300';
const projectRoot = path.resolve(__dirname, '../../');
const serverDir = path.join(projectRoot, 'packages', 'server');
const serverSrcIndex = path.join('.', 'src', 'index.ts');

async function startServer(): Promise<Subprocess> {
  logger.info(`Attempting to start the server with command: bun run ${serverSrcIndex}`);
  
  const serverProcess = Bun.spawn(
    ['bun', 'run', serverSrcIndex], // חזרה לשימוש ב-'bun'
    {
      cwd: serverDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...Bun.env, LOG_LEVEL: 'debug', NODE_ENV: 'development' },
      // shell: true, // הוסר - גורם לשגיאת TS2353 עם Bun.spawn
    }
  );

  return new Promise((resolve, reject) => {
    let serverReady = false;
    let startupErrorData = '';
    let stdoutData = '';
    let readyTimeoutId: NodeJS.Timeout | null = null;

    const cleanupAndReject = (err: Error) => {
      if (readyTimeoutId) clearTimeout(readyTimeoutId);
      if (!serverProcess.killed) serverProcess.kill();
      reject(err);
    };

    readyTimeoutId = setTimeout(() => {
      if (!serverReady) {
        const timeoutError = new Error(`Server startup timed out. Accumulated stdout: ${stdoutData}\nAccumulated stderr: ${startupErrorData}`);
        logger.error(timeoutError.message);
        cleanupAndReject(timeoutError);
      }
    }, 30000);

    const streamToLines = async (stream: ReadableStream<Uint8Array>, type: 'stdout' | 'stderr') => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          if (serverReady && type === 'stdout') { // הפסק לקרוא אם השרת כבר מוכן
             // logger.debug(`Server is ready, stopped reading ${type}`);
             break;
          }
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.length > 0) {
              if (type === 'stderr') startupErrorData += buffer + '\n'; else stdoutData += buffer + '\n';
              // logger.debug(`Server ${type} (remaining buffer on done): ${buffer}`);
              if (buffer.includes(SERVER_READY_MESSAGE) && !serverReady && type === 'stdout') {
                serverReady = true;
                logger.info('Server started and listening.');
                if (readyTimeoutId) clearTimeout(readyTimeoutId);
                resolve(serverProcess);
              }
            }
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.substring(0, newlineIndex);
            buffer = buffer.substring(newlineIndex + 1);
            if (type === 'stderr') {
                logger.error(`Server stderr: ${line}`);
                startupErrorData += line + '\n';
            } else {
                // logger.debug(`Server stdout: ${line}`);
                stdoutData += line + '\n';
                if (line.includes(SERVER_READY_MESSAGE) && !serverReady) {
                  serverReady = true;
                  logger.info('Server started and listening.');
                  if (readyTimeoutId) clearTimeout(readyTimeoutId);
                  resolve(serverProcess);
                  // לאחר resolve, הפסק לקרוא מה-stream הזה
                  // שחרור ה-lock יאפשר ל-reader להיסגר
                  reader.releaseLock();
                  return;
                }
            }
          }
        }
      } catch (error) {
        if (!serverReady) { // רק אם השרת עוד לא התחיל, זו שגיאת התחלה
          logger.error(`Error reading ${type} stream:`, error);
          cleanupAndReject(error instanceof Error ? error : new Error(String(error)));
        } else {
          // logger.debug(`Error reading ${type} stream after server was ready (possibly benign):`, error);
        }
      } finally {
        // ודא שכל מה שנשאר בבאפר מעובד אם הזרם נסגר מוקדם
        if (buffer.length > 0 && !serverReady) {
            if (type === 'stderr') startupErrorData += buffer + '\n'; else stdoutData += buffer + '\n';
            // logger.debug(`Server ${type} (final remaining buffer on finally): ${buffer}`);
            if (buffer.includes(SERVER_READY_MESSAGE) && !serverReady && type === 'stdout') {
              serverReady = true;
              logger.info('Server started and listening (from finally).');
              if (readyTimeoutId) clearTimeout(readyTimeoutId);
              resolve(serverProcess);
            }
        }
        // אין צורך ב-reader.releaseLock() כאן אם הלולאה הסתיימה ב-break או באופן טבעי
      }
    };
    
    streamToLines(serverProcess.stdout, 'stdout').catch(err => { if (!serverReady) cleanupAndReject(err); });
    streamToLines(serverProcess.stderr, 'stderr').catch(err => { if (!serverReady) cleanupAndReject(err); });

    serverProcess.exited.then(exitCode => {
      if (!serverReady) { // אם התהליך יצא לפני שהשרת היה מוכן
        const exitError = new Error(`Server process exited with code ${exitCode} before ready. Accumulated stderr: ${startupErrorData}`);
        logger.error(exitError.message);
        cleanupAndReject(exitError);
      } else {
        logger.info(`Server process (which was ready) exited with code ${exitCode}.`);
      }
    }).catch(err => {
        if (!serverReady) {
            logger.error('Error waiting for server process to exit (before ready):', err);
            cleanupAndReject(err);
        } else {
            logger.warn('Error waiting for server process to exit (after ready):', err);
        }
    });
  });
}

async function stopServer(serverProcess: Subprocess | null): Promise<void> {
  if (!serverProcess || serverProcess.killed) {
    logger.info('Server process already stopped or not started.');
    return;
  }
  logger.info('Attempting to stop the server...');
  
  serverProcess.kill(); // Bun.Subprocess.kill() שולח SIGTERM כברירת מחדל, ואז SIGKILL

  try {
    const exitCode = await serverProcess.exited;
    logger.info(`Server process confirmed exited with code ${exitCode}.`);
  } catch (err) {
    logger.error('Error while waiting for server to exit after kill:', err);
  }
}

async function fetchDevicesAPI(): Promise<any | null> {
  logger.info(`Fetching devices from: ${SERVER_API_URL}`);
  try {
    const response = await fetch(SERVER_API_URL);
    if (!response.ok) {
      logger.error(`API request failed. Status: ${response.status} ${response.statusText}`);
      const errorBody = await response.text();
      logger.error(`API Error body: ${errorBody}`);
      return null;
    }
    const devices = await response.json();
    logger.info('Successfully fetched devices from API.');
    return devices;
  } catch (error: any) {
    logger.error('Error fetching devices API:', error.message);
    return null;
  }
}

async function main() {
  logger.info('--- Starting Server API Integration Test ---');
  logger.debug(`Project root calculated as: ${projectRoot}`);
  logger.debug(`Server directory calculated as: ${serverDir}`);
  logger.debug(`Server index.ts calculated as: ${serverSrcIndex}`);
  let serverProcess: Subprocess | null = null;

  try {
    serverProcess = await startServer();
    // אין צורך לבדוק אם serverProcess הוא null, כי startServer אמור לזרוק שגיאה במקרה כזה

    const initialWaitMs = 15000;
    logger.info(`Waiting ${initialWaitMs / 1000}s for server to discover devices...`);
    await new Promise(resolve => setTimeout(resolve, initialWaitMs));

    const devicesResponse = await fetchDevicesAPI();

    if (devicesResponse) {
      logger.info('Response from /api/devices:');
      console.log(JSON.stringify(devicesResponse, null, 2));

      if (Array.isArray(devicesResponse) && devicesResponse.length > 0) {
        devicesResponse.forEach((device: any, index: number) => {
          if (device && typeof device.usn === 'string') {
            if (device.usn === '') {
              logger.warn(`Validation: Device at index ${index} has an EMPTY usn string.`);
            } else {
              logger.info(`Validation: Device at index ${index} has usn: '${device.usn}' (Length: ${device.usn.length})`);
            }
            if (!device.UDN || device.UDN === '') {
                logger.warn(`Validation: Device at index ${index} has an EMPTY or MISSING UDN.`);
            } else {
                logger.info(`Validation: Device at index ${index} has UDN: '${device.UDN}'`);
            }
            if (!device.friendlyName || device.friendlyName === '') {
                logger.warn(`Validation: Device at index ${index} has an EMPTY or MISSING friendlyName.`);
            } else {
                logger.info(`Validation: Device at index ${index} has friendlyName: '${device.friendlyName}'`);
            }

          } else {
            logger.warn(`Validation: Device at index ${index} does not have a string usn property or device is null/undefined.`);
          }
        });
      } else if (Array.isArray(devicesResponse)) {
        logger.info('Validation: The /api/devices endpoint returned an empty array. This might be normal if no devices were discovered.');
      } else {
        logger.warn('Validation: The response from /api/devices was not an array or was not as expected.');
      }
    } else {
      logger.error('Validation: Did not receive a valid response from the server API.');
    }

  } catch (error) {
    logger.error('Main test execution error caught in main():');
    if (error instanceof Error) {
        logger.error(`Error Message: ${error.message}`);
        if (error.stack) {
            logger.error(`Stack Trace: ${error.stack}`);
        }
        if ((error as any).cause) {
            logger.error(`Cause: ${(error as any).cause}`);
        }
    } else {
        logger.error('Caught non-Error object:', error);
    }
  } finally {
    if (serverProcess) {
      await stopServer(serverProcess);
    }
    logger.info('--- Server API Integration Test Finished ---');
  }
}

main().catch(error => {
  logger.error('Unhandled error in main test function:', error);
});