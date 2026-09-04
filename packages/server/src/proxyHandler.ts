import type { Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import { createLogger } from './logger';
import { getActiveDevices } from './deviceManager';

const logger = createLogger('ProxyHandler');

/**
 * מטפל בבקשות פרוקסי למשאבים של מכשירים.
 * מחלץ את מזהה המכשיר והנתיב מהבקשה, מאתר את כתובת ה-URL הבסיסית של המכשיר,
 * ומעביר את הבקשה למכשיר. התשובה מהמכשיר מועברת חזרה לקליינט המקורי.
 *
 * @param req - אובייקט הבקשה של Express.
 * @param res - אובייקט התשובה של Express.
 * @param next - פונקציית ה-middleware הבאה של Express.
 */
export async function proxyHandler(req: Request, res: Response, next: NextFunction): Promise<void> {

  const currentActiveDevices = getActiveDevices();
  const { udn: deviceId, path: resourcePathArr } = req.params;

  // נתיב מלא כולל כל מה אחרי /proxy/:deviceId/ כולל פרמטרים של ?
  const fullTargetPath = req.originalUrl.replace('/proxy/' + deviceId + '/', '');

  logger.info(`Received proxy request: deviceId=${deviceId}, path=${resourcePathArr}`);

  const resourcePath = Array.isArray(resourcePathArr) ? resourcePathArr.join('/') : resourcePathArr;

  const params = new URLSearchParams(req.query as Record<string, string> | {});
  const queryString = params.toString();

  if (!deviceId || !resourcePath || !fullTargetPath) {
    logger.warn('Bad request: Device ID or resource path is missing.');
    res.status(400).send('Device ID and resource path are required.');
    return;
  }

  logger.info(`Proxy request for deviceId: "${deviceId}", path: "${resourcePath}"`);

  try {
    const device = currentActiveDevices.get(deviceId);

    if (!device) {
      logger.warn(`Device with ID "${deviceId}" not found.`);
      res.status(404).send(`Device with ID "${deviceId}" not found.`);
      return;
    }

    const baseUrls = [device.presentationURL, device.baseURL].filter((url): url is string => typeof url === 'string' && url.length > 0);

    if (baseUrls.length === 0) {
      logger.error(`Device with ID "${deviceId}" does not have a presentationURL or baseURL.`);
      res.status(404).send(`Device with ID "${deviceId}" does not have a valid URL.`);
      return;
    }

    // העברת כל הכותרות הרלוונטיות מהבקשה המקורית
    const excludedHeaders = ['host', 'connection', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'accept-encoding', 'accept-language'];
    const proxyHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!excludedHeaders.includes(key.toLowerCase()) && value) {
        proxyHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }
    logger.info(`Forwarding headers: ${Object.keys(proxyHeaders).join(', ')}`);

    let deviceResponse: globalThis.Response | null = null;

    for (const baseUrl of baseUrls) {
      try {
        // const targetUrl = new URL(resourcePath, baseUrl).toString();
        const targetUrl = new URL(fullTargetPath, baseUrl).toString();
        logger.info(`Attempting to forward request to: ${targetUrl}`);

        const response = await fetch(targetUrl, { headers: proxyHeaders });

        if (response.ok) {
          deviceResponse = response;
          logger.info(`Successfully fetched from ${targetUrl}`);
          break; // יציאה מהלולאה לאחר קבלת תשובה תקינה
        } else {
          logger.warn(`Request to ${targetUrl} failed with status: ${response.status}`);
        }
      } catch (error) {
        logger.error(`Error fetching from ${baseUrl}:`, error);
        // ממשיכים ל-URL הבא
      }
    }

    if (!deviceResponse) {
      logger.error(`Failed to fetch resource from all available URLs for device "${deviceId}".`);
      res.status(502).send('Bad Gateway: Could not fetch resource from device.');
      return;
    }

    // העברת ה-headers מהתשובה של המכשיר לתשובה שלנו
    deviceResponse.headers.forEach((value, name) => {
      res.setHeader(name, value);
    });

    // העברת ה-status code
    res.status(deviceResponse.status);

    // הזרמת גוף התשובה ישירות לקליינט
    if (deviceResponse.body) {
      const bodyStream = Readable.fromWeb(deviceResponse.body as any);
      await new Promise((resolve, reject) => {
        bodyStream.pipe(res);
        bodyStream.on('end', resolve);
        bodyStream.on('error', reject);
      });
    } else {
      res.end();
    }

  } catch (error) {
    logger.error(`Proxy error for device "${deviceId}" and path "${resourcePath}":`, error);
    if (!res.headersSent) {
      res.status(502).send('Bad Gateway: Error fetching resource from device.');
    }
  }
}
