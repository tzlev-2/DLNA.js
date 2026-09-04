// examples/mute_renderer_audio.ts
import {
  // discoverSsdpDevices, // הוסר, יש להשתמש ב-ActiveDeviceManager או discoverSsdpDevicesIterable
  DiscoveryDetailLevel,
  type FullDeviceDescription,
  type ServiceDescription, // הוספת ייבוא חסר
  createLogger,
  setLogger,
  sendUpnpCommand, // שינוי: UpnpSoapClient הוחלף ב-sendUpnpCommand
} from 'dlna.js';
setLogger(console);
import readline from 'readline/promises';

const logger = createLogger('MuteRendererAudioExample');

// קבועים עבור שירות RenderingControl
const RENDERING_CONTROL_SERVICE_ID_URN = 'urn:schemas-upnp-org:service:RenderingControl:1';
const RENDERING_CONTROL_SERVICE_TYPE_PARTIAL = 'RenderingControl'; // חלק מה-serviceType

// קבועים עבור פעולת SetMute
const SET_MUTE_ACTION = 'SetMute';
const DEFAULT_INSTANCE_ID = '0'; // בדרך כלל 0 עבור המופע הראשי של השירות
const DEFAULT_CHANNEL = 'Master'; // ערוץ אודיו ראשי, נפוץ ב-RenderingControl

async function main() {
  logger.info('Starting UPnP device discovery to find Media Renderers...');
  try {
    // 1. גילוי התקנים עם פרטים מלאים
    //    אנו זקוקים לפרטים מלאים כדי לגשת לרשימת השירותים של כל התקן.
    // const devices = await discoverSsdpDevices({ // הפונקציה הוסרה
    //   timeoutMs: 7000, // שינוי: discoveryTimeoutMs הוחלף ב-timeoutMs
    //   detailLevel: DiscoveryDetailLevel.Full,
    //   // logger: createLogger('SsdpDiscovery'), // הוסר: אין פרמטר לוגר באופציות הגילוי
    //   // unique: true, // הוסר: אין פרמטר כזה באופציות הגילוי
    // });
    const devices: FullDeviceDescription[] = []; // מערך ריק זמני
    logger.warn('Device discovery is currently commented out. Using an empty list of devices.');


    logger.info(`Discovery complete. Found ${devices.length} devices.`);

    // 2. סינון התקנים שהם MediaRenderer ויש להם שירות RenderingControl
    const renderers: FullDeviceDescription[] = [];
    for (const device of devices) {
      if (device.deviceType?.includes('MediaRenderer')) {
        const rcService = device.serviceList ? Array.from(device.serviceList.values()).find(
          (service: ServiceDescription) => // הוספת טיפוס והמרה ל-Array
            service.serviceId === RENDERING_CONTROL_SERVICE_ID_URN ||
            service.serviceType?.includes(RENDERING_CONTROL_SERVICE_TYPE_PARTIAL)
        ) : undefined;
        if (rcService) {
          renderers.push(device as FullDeviceDescription);
          logger.debug(`Found compatible renderer: ${device.friendlyName} (UDN: ${device.UDN})`);
        } else {
          logger.debug(
            `Device ${device.friendlyName} is a MediaRenderer but lacks a recognizable RenderingControl service.`
          );
        }
      }
    }

    if (renderers.length === 0) {
      logger.warn(
        'No Media Renderers with an active RenderingControl service were found on the network (or discovery is off). ' +
        'Ensure your renderers are powered on and connected to the same network.'
      );
      return;
    }

    // 3. הצגת הרנדררים למשתמש ובקשת בחירה
    logger.info('Available Media Renderers with RenderingControl service:');
    renderers.forEach((renderer, index) => {
      logger.info(
        `${index + 1}. ${renderer.friendlyName} (Model: ${renderer.modelName || 'N/A'}, UDN: ${renderer.UDN})`
      );
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let choice = -1;
    while (true) {
      const answer = await rl.question(
        `Select a renderer to mute (enter a number 1-${renderers.length}), or 0 to cancel: `
      );
      const parsedAnswer = parseInt(answer, 10);
      if (parsedAnswer === 0) {
        logger.info('Operation cancelled by user.');
        rl.close();
        return;
      }
      if (!isNaN(parsedAnswer) && parsedAnswer >= 1 && parsedAnswer <= renderers.length) {
        choice = parsedAnswer;
        break;
      }
      logger.warn('Invalid selection. Please enter a number from the list or 0 to cancel.');
    }
    rl.close();

    const selectedRenderer = renderers[choice - 1];
    logger.info(`Selected renderer: ${selectedRenderer.friendlyName}`);

    // 4. השתקת האודיו של הרנדרר הנבחר
    const renderingControlService = selectedRenderer.serviceList ? Array.from(selectedRenderer.serviceList.values()).find(
      (service: ServiceDescription) => // הוספת טיפוס והמרה ל-Array
        service.serviceId === RENDERING_CONTROL_SERVICE_ID_URN ||
        service.serviceType?.includes(RENDERING_CONTROL_SERVICE_TYPE_PARTIAL)
    ) : undefined;

    // ודא שכל הפרטים הנדרשים קיימים
    if (!renderingControlService || !renderingControlService.controlURL || !renderingControlService.SCPDURL) {
      logger.error(
        `Could not find essential RenderingControl service details (controlURL or SCPDURL) for ${selectedRenderer.friendlyName}. ` +
        `This might indicate an incomplete device description.`
      );
      return;
    }

    // בניית URL מלא ל-controlURL (ה-URL בתיאור ההתקן עשוי להיות יחסי ל-baseURL של ההתקן)
    const controlUrl = new URL(renderingControlService.controlURL, selectedRenderer.baseURL).toString();
    const serviceType = renderingControlService.serviceType || RENDERING_CONTROL_SERVICE_ID_URN; // Fallback לשם המלא אם serviceType חסר

    logger.debug(`RenderingControl details for ${selectedRenderer.friendlyName}:`);
    logger.debug(`  Service Type: ${serviceType}`);
    logger.debug(`  Control URL: ${controlUrl}`);
    logger.debug(`  SCPD URL: ${new URL(renderingControlService.SCPDURL, selectedRenderer.baseURL).toString()}`);

    // שינוי: במקום ליצור מופע של UpnpSoapClient, נשתמש ישירות בפונקציה sendUpnpCommand.
    // הפונקציה sendUpnpCommand מקבלת את ה-controlUrl, serviceType, actionName, ו-payload.
    // היא גם מקבלת לוגר אופציונלי.

    try {
      logger.info(
        `Attempting to mute audio for ${selectedRenderer.friendlyName} (InstanceID: ${DEFAULT_INSTANCE_ID}, Channel: ${DEFAULT_CHANNEL})...`
      );
      // הפעלת הפעולה SetMute באמצעות sendUpnpCommand
      const result = await sendUpnpCommand(
        controlUrl,
        serviceType,
        SET_MUTE_ACTION,
        { // payload הופך להיות הארגומנט הרביעי
          InstanceID: DEFAULT_INSTANCE_ID,
          Channel: DEFAULT_CHANNEL,
          DesiredMute: '1', // '1' עבור true (השתקה), '0' עבור false (ביטול השתקה)
        }
        // אין צורך להעביר לוגר, הפונקציה משתמשת בלוגר פנימי
      );
      // התשובה מההתקן עשויה להיות ריקה בהצלחה, או להכיל פרטים נוספים.
      logger.info(`SetMute action invoked. Response from device: ${JSON.stringify(result)}`);
      logger.info(
        `Audio for ${selectedRenderer.friendlyName} should now be muted. ` +
        `To unmute, you would typically call the SetMute action again with DesiredMute: '0'.`
      );
    } catch (error: any) {
      logger.error(`Failed to mute audio for ${selectedRenderer.friendlyName}.`);
      if (error.message) {
        logger.error(`Error message: ${error.message}`);
      }
      // שגיאות SOAP לרוב יכילו אובייקט soapResponse עם פרטי השגיאה מההתקן
      if (error.soapResponse) {
        logger.error(`SOAP Fault details: ${JSON.stringify(error.soapResponse)}`);
      } else {
        // במקרה של שגיאות רשת או אחרות, נדפיס את כל האובייקט
        logger.error('Full error details:', error);
      }
      logger.warn(
        'This could be due to network issues, the device not supporting the action as expected, or incorrect parameters.'
      );
    }
  } catch (error) {
    logger.error('An unexpected error occurred in the main process:', error);
  }
}

// הרצת הפונקציה הראשית וטיפול בשגיאות לא מטופלות ברמת התהליך
main().catch((err) => {
  logger.error('Unhandled error during script execution:', err);
  process.exit(1); // יציאה עם קוד שגיאה כדי לציין כשל
});