// packages/server/src/deviceActionService.ts
import { createModuleLogger } from './logger';
import type { ApiDevice } from './types';

const logger = createModuleLogger('deviceActionService');

// Custom Error classes for specific error handling
export class DeviceNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceNotFound';
  }
}

export class ServiceNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceNotFound';
  }
}

export class ActionNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionNotFound';
  }
}

export class ActionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionFailed';
  }
}

/**
 * מפעיל פעולת UPnP על התקן ספציפי.
 * הפונקציה מבצעת ולידציה מלאה לפני שליחת הפקודה.
 * @param activeDevices - מפת ההתקנים הפעילים.
 * @param udn - UDN של התקן המטרה.
 * @param serviceId - מזהה השירות המלא (למשל, 'urn:upnp-org:serviceId:AVTransport').
 * @param actionName - שם הפעולה להפעלה (למשל, 'Play').
 * @param args - אובייקט המכיל את הארגומנטים לפעולה.
 * @returns Promise המכיל את תוצאת הפעולה.
 * @throws {DeviceNotFound | ServiceNotFound | ActionNotFound | ActionFailed} - זורק שגיאות מותאמות.
 */
export async function invokeDeviceAction(
  activeDevices: Map<string, ApiDevice>,
  udn: string,
  serviceId: string,
  actionName: string,
  args: Record<string, any> = {}
): Promise<any> {
  logger.info(`Attempting to invoke action '${actionName}' on service '${serviceId}' for device UDN: ${udn}`);
  logger.debug('Action arguments:', args);

  // 1. ולידציה: האם ההתקן קיים?
  const device = activeDevices.get(udn);
  if (!device) {
    logger.warn(`Device with UDN ${udn} not found.`);
    throw new DeviceNotFound(`Device with UDN ${udn} not found.`);
  }

  // 2. ולידציה: האם השירות קיים בהתקן?
  const service = device.serviceList?.get(serviceId);
  if (!service) {
    logger.warn(`Service '${serviceId}' not found on device ${device.friendlyName}.`);
    throw new ServiceNotFound(`Service '${serviceId}' not found on device ${device.friendlyName}.`);
  }

  // 3. ולידציה: האם הפעולה קיימת בשירות?
  const action = service.actionList?.get(actionName);
  if (!action || typeof action.invoke !== 'function') {
    logger.warn(`Action '${actionName}' not found or is not invokable on service '${serviceId}'.`);
    throw new ActionNotFound(`Action '${actionName}' not found on service '${serviceId}'.`);
  }

  // 4. הפעלת הפעולה
  try {
    logger.debug(`Invoking action '${actionName}' on device ${device.friendlyName}.`);
    const result = await action.invoke(args);
    logger.info(`Action '${actionName}' on device ${device.friendlyName} completed successfully.`);
    logger.debug('Action result:', result);
    delete result?.$; // הסרת המאפיין $ אם קיים, כדי להקל על קריאות התוצאה
    return result;
  } catch (error: any) {
    const soapFault = error.originalError?.soapFault;
    const upnpErrorCode = soapFault?.upnpErrorCode || error.originalError?.upnpErrorCode || 'Unknown';
    const upnpErrorDescription = soapFault?.upnpErrorDescription || error.originalError?.upnpErrorDescription || 'Unknown error';
    logger.error(`Failed to invoke action '${actionName}' on device ${device.friendlyName}.`, {
      deviceName: device.friendlyName,
      actionName,
      errorMessage: error.message,
      soapFault: soapFault,
      upnpErrorCode,
      upnpErrorDescription
    });
    // העברת שגיאת ה-SOAP המקורית אם קיימת
    const errorMessage = error.soapFault?.detail || error.message || 'An unknown error occurred.';
    throw new ActionFailed(`Action '${actionName}' failed: ${errorMessage}` +
      ` upnpErrorCode: ${upnpErrorCode}, ` +
      `upnpErrorDescription: ${upnpErrorDescription}`);
  }
}