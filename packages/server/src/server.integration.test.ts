import { test, expect, beforeAll, afterAll, describe } from 'bun:test';
import type { Subprocess } from 'bun';
import path from 'path';
import { createModuleLogger } from './logger';

const logger = createModuleLogger('ServerIntegrationTest(bun:test)');
const SERVER_API_URL = 'http://localhost:3300/api/devices';
const SERVER_READY_MESSAGE = 'Server listening on port 3300'; // ודא שזה תואם לפלט השרת
const projectRoot = path.resolve(__dirname, '../../../'); // נתיב מתוקן לשורש הפרויקט
const serverDir = path.join(projectRoot, 'packages', 'server');
const serverSrcIndex = path.join('.', 'src', 'index.ts'); // נתיב לקובץ ההפעלה של השרת, יחסית ל-serverDir

let serverProcess: Subprocess | null = null;

// פונקציה להפעלת השרת, מבוססת על הקוד הקיים
// נצטרך לבדוק אם Bun.spawn עובד טוב יותר כאן
async function startServerTestContext(): Promise<Subprocess> {
  logger.info(`Attempting to start the server with command: bun run ${serverSrcIndex} in ${serverDir}`);
  
  logger.info(`Executing command: ['bun', 'run', '${serverSrcIndex}'] in ${serverDir}`);
  const process = Bun.spawn(
    ['bun', 'run', serverSrcIndex], // חזרה למערך פקודות ללא shell
    {
      cwd: serverDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...Bun.env, LOG_LEVEL: 'debug', NODE_ENV: 'development' },
      // shell: true, // הוסר
    }
  );

  return new Promise((resolve, reject) => {
    let serverReady = false;
    let startupErrorData = '';
    let stdoutData = '';
    let readyTimeoutId: NodeJS.Timeout | null = null;

    const cleanupAndReject = (err: Error) => {
      if (readyTimeoutId) clearTimeout(readyTimeoutId);
      if (!process.killed) process.kill();
      reject(err);
    };

    readyTimeoutId = setTimeout(() => {
      if (!serverReady) {
        const timeoutError = new Error(`Server startup timed out. Accumulated stdout: ${stdoutData}\nAccumulated stderr: ${startupErrorData}`);
        logger.error(timeoutError.message);
        cleanupAndReject(timeoutError);
      }
    }, 30000); // 30 שניות timeout

    const streamToLines = async (stream: ReadableStream<Uint8Array>, type: 'stdout' | 'stderr') => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          if (serverReady && type === 'stdout') break;
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.length > 0) {
              if (type === 'stderr') startupErrorData += buffer + '\n'; else stdoutData += buffer + '\n';
              if (buffer.includes(SERVER_READY_MESSAGE) && !serverReady && type === 'stdout') {
                serverReady = true;
                logger.info('Server started and listening (from stream done).');
                if (readyTimeoutId) clearTimeout(readyTimeoutId);
                resolve(process);
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
                stdoutData += line + '\n';
                if (line.includes(SERVER_READY_MESSAGE) && !serverReady) {
                  serverReady = true;
                  logger.info('Server started and listening.');
                  if (readyTimeoutId) clearTimeout(readyTimeoutId);
                  resolve(process);
                  reader.releaseLock();
                  return;
                }
            }
          }
        }
      } catch (error) {
        if (!serverReady) {
          logger.error(`Error reading ${type} stream:`, error);
          cleanupAndReject(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        if (buffer.length > 0 && !serverReady) {
            if (type === 'stderr') startupErrorData += buffer + '\n'; else stdoutData += buffer + '\n';
            if (buffer.includes(SERVER_READY_MESSAGE) && !serverReady && type === 'stdout') {
              serverReady = true;
              logger.info('Server started and listening (from finally).');
              if (readyTimeoutId) clearTimeout(readyTimeoutId);
              resolve(process);
            }
        }
      }
    };
    
    streamToLines(process.stdout, 'stdout').catch(err => { if (!serverReady) cleanupAndReject(err); });
    streamToLines(process.stderr, 'stderr').catch(err => { if (!serverReady) cleanupAndReject(err); });

    process.exited.then(exitCode => {
      if (!serverReady) {
        const exitError = new Error(`Server process exited with code ${exitCode} before ready. stderr: ${startupErrorData}`);
        logger.error(exitError.message);
        cleanupAndReject(exitError);
      } else {
        logger.info(`Server process (which was ready) exited with code ${exitCode}.`);
      }
    }).catch(err => {
        if (!serverReady) {
            logger.error('Error waiting for server process to exit (before ready):', err);
            cleanupAndReject(err);
        }
    });
  });
}

async function stopServerTestContext(process: Subprocess | null): Promise<void> {
  if (!process || process.killed) {
    logger.info('Server process (test context) already stopped or not started.');
    return;
  }
  logger.info('Attempting to stop the server (test context)...');
  process.kill();
  try {
    const exitCode = await process.exited;
    logger.info(`Server process (test context) confirmed exited with code ${exitCode}.`);
  } catch (err) {
    logger.error('Error while waiting for server (test context) to exit after kill:', err);
  }
}

describe('Server API Integration Tests', () => {
  beforeAll(async () => {
    logger.info('Executing beforeAll: Starting server...');
    try {
      serverProcess = await startServerTestContext();
      logger.info('Server started successfully for tests.');
      // המתנה קצרה נוספת כדי לוודא שהשרת באמת מוכן לקבל בקשות
      await new Promise(resolve => setTimeout(resolve, 2000)); 
    } catch (error) {
      logger.error('Failed to start server in beforeAll:', error);
      // אם השרת לא עולה, אין טעם להמשיך בבדיקות.
      // bun:test יטפל בזה ככישלון של ה-setup.
      throw error; 
    }
  });

  afterAll(async () => {
    logger.info('Executing afterAll: Stopping server...');
    if (serverProcess) {
      await stopServerTestContext(serverProcess);
      logger.info('Server stopped successfully after tests.');
    }
  });

  test('should fetch devices from /api/devices and get a valid response', async () => {
    logger.info('Running test: fetch devices from /api/devices');
    expect(serverProcess).not.toBeNull(); // ודא שהשרת התחיל

    const initialWaitMs = 10000; // המתנה לטעינת התקנים
    logger.info(`Waiting ${initialWaitMs / 1000}s for server to discover devices before API call...`);
    await new Promise(resolve => setTimeout(resolve, initialWaitMs));

    try {
      const response = await fetch(SERVER_API_URL);
      logger.info(`API Response status: ${response.status}`);
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const devices = await response.json() as any[]; // שימוש ב-type assertion
      logger.info('API Response data:', devices);
      expect(Array.isArray(devices)).toBe(true);
      
      // ניתן להוסיף כאן בדיקות נוספות על מבנה הנתונים של ההתקנים
      if (devices.length > 0) {
        const device = devices[0] as any;
        expect(device).toHaveProperty('usn');
        expect(typeof device.usn).toBe('string');
        expect(device.usn).not.toBe(''); // ודא ש-usn אינו ריק
        
        expect(device).toHaveProperty('UDN');
        expect(typeof device.UDN).toBe('string');
        expect(device.UDN).not.toBe(''); // ודא ש-UDN אינו ריק

        expect(device).toHaveProperty('friendlyName');
        expect(typeof device.friendlyName).toBe('string');
        expect(device.friendlyName).not.toBe(''); // ודא ש-friendlyName אינו ריק
      } else {
        logger.info('API returned an empty array of devices. This might be okay depending on network.');
      }

    } catch (error) {
      logger.error('Error during API fetch test:', error);
      throw error; // זרוק את השגיאה כדי שהבדיקה תיכשל
    }
  }, 45000); // Timeout ארוך יותר לבדיקה זו, כולל המתנה לשרת והתקנים
});