// שינוי לשימוש ב-API החדש של @inquirer/prompts
import { select, input as inquirerInput, confirm as inquirerConfirm, Separator } from '@inquirer/prompts';
import inquirer from 'inquirer'; // נשאיר לייבוא של Separator הישן אם עדיין בשימוש במקומות אחרים, או שנמחק אם לא צריך

import {
  discoverSsdpDevicesIterable, // <-- הוספנו את הפונקציה הנכונה
  DiscoveryDetailLevel,
  type FullDeviceDescription,
  type ServiceDescription,
  type Action,
  type StateVariable,
  type ActionArgument, // שונה מ-Argument
  // UpnpSoapClient לא מיוצא, נשתמש ב-sendUpnpCommand
  sendUpnpCommand, // הפונקציה המיוצאת לשליחת פקודות
} from 'dlna.js'; // ייבוא יחסי לחבילת הליבה

// Keep library quiet so Inquirer menus stay usable on a TTY.
const logger = {
  info: (m: string, ...a: unknown[]) => console.log(m, ...a),
  warn: (m: string, ...a: unknown[]) => console.warn(m, ...a),
  error: (m: string, ...a: unknown[]) => console.error(m, ...a),
  debug: (_m: string, ..._a: unknown[]) => {},
};

/**
 * מחלץ שם סוג התקן קריא מתוך ה-URN המלא.
 * @param deviceTypeUrn - ה-URN המלא של סוג ההתקן.
 * @returns שם סוג התקן קריא, או ה-URN המקורי אם החילוץ נכשל.
 */
function getFriendlyDeviceType(deviceTypeUrn?: string): string {
  if (!deviceTypeUrn) {
    return 'Unknown Type';
  }
  try {
    const parts = deviceTypeUrn.split(':');
    // בדרך כלל החלק המעניין הוא החלק שלפני האחרון, אחרי 'device'
    // למשל: urn:schemas-upnp-org:device:MediaServer:1 -> MediaServer
    if (parts.length > 2 && parts[parts.length - 2] !== 'device') {
        return parts[parts.length - 2]; // אם זה לא מכיל 'device' במקום הצפוי
    }
    if (parts.length > 1) {
        return parts[parts.length - 2]; // ברירת מחדל לחלק שלפני האחרון
    }
  } catch (e) {
    // במקרה של שגיאה, החזר את ה-URN המקורי
  }
  return deviceTypeUrn; // אם החילוץ נכשל, החזר את ה-URN המקורי
}


async function main() {
  logger.info('Starting DLNA Device Explorer CLI...');
  logger.debug('Entered main function');
  try {
    logger.debug('Calling discoverSsdpDevicesIterable...');
    const devicesIterable = discoverSsdpDevicesIterable({
      timeoutMs: 5000,
      detailLevel: DiscoveryDetailLevel.Full,
    });
    logger.debug('discoverSsdpDevicesIterable returned an iterable.');

    const devices: FullDeviceDescription[] = [];
    for await (const device of devicesIterable) {
      if (device) {
        devices.push(device as FullDeviceDescription);
      }
    }
    logger.debug(`Collected ${devices.length} devices from iterable.`);

    if (!devices || devices.length === 0) {
      logger.warn('No devices found on the network.');
      logger.debug('Exiting main function - no devices found.');
      return;
    }

    logger.info(`Found ${devices.length} raw device entries.`);

    // סינון התקנים כפולים לפי UDN
    const uniqueDevicesMap = new Map<string, FullDeviceDescription>();
    for (const device of devices as FullDeviceDescription[]) { // devices כבר אמור להיות FullDeviceDescription[]
      if (device.UDN && !uniqueDevicesMap.has(device.UDN)) {
        uniqueDevicesMap.set(device.UDN, device);
      } else if (!device.UDN) {
        // במקרה שאין UDN (לא אמור לקרות עם FullDetailLevel, אבל ליתר ביטחון)
        // נשתמש ב-USN או ב-location כמפתח גיבוי, פחות אידיאלי
        const backupKey = device.usn || device.location;
        if (backupKey && !uniqueDevicesMap.has(backupKey)) {
            logger.warn(`Device ${device.friendlyName || device.usn} missing UDN, using ${backupKey} as unique key.`);
            uniqueDevicesMap.set(backupKey, device);
        }
      }
    }

    const filteredDevices = Array.from(uniqueDevicesMap.values());
    // logger.warn('Device discovery is currently commented out. Using an empty list of devices.'); // הסרנו אזהרה זו


    if (filteredDevices.length === 0) {
        logger.warn('No unique devices found after filtering (or discovery is off).');
        logger.debug('Exiting main function - no unique devices after filtering.');
        return;
    }

    logger.info(`Displaying ${filteredDevices.length} unique devices.`);
    logger.debug('Calling selectDeviceMenu...');
    const selectDeviceMenuResult = await selectDeviceMenu(filteredDevices);
    logger.debug(`Returned from selectDeviceMenu. Result: ${selectDeviceMenuResult}`);

    if (selectDeviceMenuResult === 'rediscover') {
      logger.info('Rediscovering devices as requested...');
      // קריאה רקורסיבית ל-main תתחיל את כל התהליך מחדש.
      // זה בסדר כאן כי זו פעולה מפורשת של המשתמש.
      await main();
    }
    // אם 'exit', הפונקציה פשוט תסתיים.
    // אם undefined, גם הפונקציה תסתיים (המשתמש חזר עד לפה ובחר לצאת).
  } catch (error) {
    logger.error('An error occurred during device discovery or exploration:', error);
    logger.debug('Exiting main function due to error in discovery/exploration.');
  }
  logger.debug('Exiting main function normally.');
}

async function selectDeviceMenu(devices: FullDeviceDescription[]): Promise<'rediscover' | 'exit' | void> {
  logger.debug('Entered selectDeviceMenu');
  // אין כאן לולאה, כי בחירת התקן היא חד פעמית. אם רוצים לבחור התקן אחר, צריך "rediscover".
  
  logger.debug('Prompting for device selection...');
  const selectedDeviceUDN = await select({ // שימוש ב-select החדש
    message: 'Select a device to explore (or select an option):',
    choices: [
      ...devices.map(device => ({
        name: `${device.friendlyName} (${device.modelName || 'Unknown Model'}) - [${getFriendlyDeviceType(device.deviceType)}] - ${device.baseURL}`,
        value: device.UDN,
        description: device.baseURL,
      })),
      new Separator(),
      { name: 'Restart discovery (find new devices)', value: 'rediscover' },
      { name: 'Exit explorer', value: 'exit' }
    ]
  });
  logger.debug(`select prompt for device selection returned. Selected UDN/Option: ${selectedDeviceUDN}`);

  if (selectedDeviceUDN === 'rediscover') {
      // הקוד הכפול שהיה כאן נמחק. המשתנה הנכון הוא selectedDeviceUDNValue מהקריאה ל-select למעלה.
      // השורות הבאות כבר משתמשות ב-selectedDeviceUDNValue.
    logger.debug('User chose rediscover from selectDeviceMenu.');
    return 'rediscover';
  }
  if (selectedDeviceUDN === 'exit') { // שימוש ב-selectedDeviceUDN
    logger.info('Exiting explorer.');
    logger.debug('User chose exit from selectDeviceMenu.');
    return 'exit';
  }

  const selectedDevice = devices.find(d => d.UDN === selectedDeviceUDN); // שימוש ב-selectedDeviceUDN
  if (!selectedDevice) {
    logger.error('Selected device not found. This should not happen (UDN mismatch).');
    logger.debug('Exiting selectDeviceMenu - selected device not found.');
    return; // נשארים באותו מקום, main יסתיים
  }

  logger.info(`Exploring device: ${selectedDevice.friendlyName}`);
  logger.debug('Calling deviceActionsMenu...');
  const deviceMenuResult = await deviceActionsMenu(selectedDevice);
  logger.debug(`Returned from deviceActionsMenu to selectDeviceMenu. Result: ${deviceMenuResult}`);

  if (deviceMenuResult === 'rediscover') {
    return 'rediscover';
  } else if (deviceMenuResult === 'exit') {
    return 'exit';
  }
  // אם חוזרים מ-deviceActionsMenu (כי המשתמש בחר "Back to device list"),
  // נחזור ל-main, והוא יסתיים כי אין עוד מה לעשות.
  // כדי לאפשר בחירת התקן אחר, המשתמש צריך לבחור "Restart discovery".
  logger.debug('Exiting selectDeviceMenu normally (likely means back from deviceActionsMenu).');
}

async function deviceActionsMenu(device: FullDeviceDescription): Promise<'rediscover' | 'exit' | void> {
  logger.debug(`Entered deviceActionsMenu for device: ${device.friendlyName}`);
  let keepMenuOpen = true;

  while (keepMenuOpen) {
    const serviceCount = device.serviceList?.size ?? 0;
    if (serviceCount > 0) {
      const names = Array.from(device.serviceList!.values())
        .map((s) => (s.serviceType || s.serviceId || '').split(':').slice(-2, -1)[0] || s.serviceId)
        .join(', ');
      logger.info(`Services on device (${serviceCount}): ${names}`);
    } else {
      logger.warn(`Device ${device.friendlyName} has no services in discovery result.`);
    }
    logger.debug('Prompting for device action in deviceActionsMenu loop...');
    const action = await select({
        message: `Device: ${device.friendlyName} (${getFriendlyDeviceType(device.deviceType)}) - What do you want to do?`,
        choices: [
          {
            name: serviceCount
              ? `List services & explore service (${serviceCount})`
              : 'List services & explore service (none found)',
            value: 'listServices',
            disabled: serviceCount === 0 ? '(no services)' : false,
          },
          new Separator(),
          { name: 'Back to device list (Restart discovery)', value: 'rediscover' },
          { name: 'Exit', value: 'exit' },
        ],
      });
    logger.debug(`select prompt for device action returned. Selected action: ${action}`);

    switch (action) {
      case 'listServices':
        logger.debug('Calling selectServiceMenu from deviceActionsMenu...');
        const serviceMenuResult = await selectServiceMenu(device);
        logger.debug(`Returned from selectServiceMenu to deviceActionsMenu. Result: ${serviceMenuResult}`);
        if (serviceMenuResult === 'rediscover') {
          return 'rediscover';
        } else if (serviceMenuResult === 'exit') {
          return 'exit';
        }
        // אם חוזרים מ-selectServiceMenu (כי המשתמש בחר "Back to device actions"),
        // הלולאה של deviceActionsMenu תמשיך.
        break;
      case 'rediscover':
        logger.debug('User chose rediscover from deviceActionsMenu.');
        return 'rediscover'; // אותת ל-selectDeviceMenu לצאת ולהפעיל מחדש את main
      case 'exit':
        logger.info('Exiting explorer.');
        logger.debug('User chose exit from deviceActionsMenu.');
        return 'exit'; // אותת לכל הרמות לצאת
    }
  }
  logger.debug('Exiting deviceActionsMenu function (loop ended, should not happen if logic is correct).');
  // לולאה זו אמורה להסתיים רק על ידי return מתוך ה-switch
}

async function selectServiceMenu(device: FullDeviceDescription): Promise<'rediscover' | 'exit' | void> {
  logger.debug(`Entered selectServiceMenu for device: ${device.friendlyName}`);
  let keepMenuOpen = true;

  while (keepMenuOpen) {
    if (!device.serviceList || device.serviceList.size === 0) {
      logger.warn(`Device ${device.friendlyName} has no services listed.`);
      // אין שירותים, אז אין טעם להישאר בתפריט זה. נחזור לתפריט ההתקן.
      return; // יגרום לחזרה ל-deviceActionsMenu
    }

    logger.debug('Prompting for service selection in selectServiceMenu loop...');
    const selectedServiceId = await select({
        message: `Device: ${device.friendlyName} - Select a service:`,
        choices: [
          ...Array.from(device.serviceList.values()).map((service: ServiceDescription) => ({
            name: `${service.serviceType} (ID: ${service.serviceId})`,
            value: service.serviceId,
          })),
          new Separator(),
          { name: 'Back to device actions', value: 'backToDevice' }
        ],
      });
    logger.debug(`select prompt for service selection returned. Selected service ID: ${selectedServiceId}`);

    if (selectedServiceId === 'backToDevice') {
      logger.debug('User chose backToDevice from selectServiceMenu.');
      keepMenuOpen = false; // יציאה מהלולאה של selectServiceMenu
    } else {
      const selectedService = Array.from(device.serviceList.values()).find((s: ServiceDescription) => s.serviceId === selectedServiceId);
      if (!selectedService) {
        logger.error('Selected service not found (should not happen if listed).');
        // נשארים בלולאה כדי שהמשתמש יוכל לבחור שוב
      } else {
        logger.info(`Exploring service: ${selectedService.serviceId} of device ${device.friendlyName}`);
        logger.debug('Calling serviceActionsMenu from selectServiceMenu...');
        const serviceActionResult = await serviceActionsMenu(device, selectedService);
        logger.debug(`Returned from serviceActionsMenu to selectServiceMenu. Result: ${serviceActionResult}`);
        
        if (serviceActionResult === 'backToDevice') {
          // serviceActionsMenu אותת שצריך לחזור לתפריט ההתקנים
          keepMenuOpen = false; // יציאה גם מהלולאה הזו
        } else if (serviceActionResult === 'exit') {
          // serviceActionsMenu אותת שצריך לצאת מהכל
          return 'exit';
        }
        // אם serviceActionResult הוא undefined, זה אומר שהמשתמש בחר "Back to service list"
        // ולכן הלולאה של selectServiceMenu צריכה להמשיך.
      }
    }
  }
  logger.debug('Exiting selectServiceMenu function (loop ended, likely backToDevice).');
  // אם הגענו לכאן, זה אומר שהמשתמש בחר backToDevice
}

async function serviceActionsMenu(device: FullDeviceDescription, service: ServiceDescription): Promise<'backToDevice' | 'exit' | void> {
  logger.debug(`Entered serviceActionsMenu for service: ${service.serviceId}`);
  let keepMenuOpen = true;

  while (keepMenuOpen) {
    if (!service.actionList || service.actionList.size === 0) {
      logger.warn(`Service ${service.serviceId} has no actions listed (or SCPD failed to load).`);
      // אין פעולות, אז אין טעם להישאר בתפריט זה. נחזור לתפריט השירותים.
      return; // יגרום לחזרה ל-selectServiceMenu
    }

    const choices = [
      { name: 'List actions & Invoke action', value: 'listActions' },
      { name: 'List state variables (and query)', value: 'listStateVariables' },
      new inquirer.Separator(),
      { name: 'Back to service list', value: 'backToServices' },
      { name: 'Back to device actions', value: 'backToDevice' },
      { name: 'Exit', value: 'exit' },
    ];

    logger.debug('Prompting for service action choice in serviceActionsMenu loop...');
    const actionChoice = await select({
        message: `Service: ${service.serviceId} (${getFriendlyDeviceType(service.serviceType)}) - What do you want to do?`,
        choices,
      });
    logger.debug(`select prompt for service action choice returned. Selected choice: ${actionChoice}`);

    switch (actionChoice) {
      case 'listActions':
        logger.debug('Calling selectActionMenu from serviceActionsMenu...');
        // selectActionMenu מנהל את הלולאה הפנימית שלו ויחזור לכאן כשהמשתמש יבחר "Back to service actions"
        await selectActionMenu(device, service);
        logger.debug('Returned from selectActionMenu to serviceActionsMenu loop.');
        // הלולאה של serviceActionsMenu תמשיך ותציג שוב את האפשרויות
        break;
      case 'listStateVariables':
        logger.debug('Calling listStateVariables from serviceActionsMenu...');
        // listStateVariables יבצע את פעולתו ויחזור לכאן
        await listStateVariables(device, service);
        logger.debug('Returned from listStateVariables to serviceActionsMenu loop.');
        // הלולאה של serviceActionsMenu תמשיך ותציג שוב את האפשרויות
        break;
      case 'backToServices':
        logger.debug('User chose backToServices from serviceActionsMenu.');
        keepMenuOpen = false; // יציאה מהלולאה של serviceActionsMenu
        break; // חוזרים ל-selectServiceMenu
      case 'backToDevice':
        logger.debug('User chose backToDevice from serviceActionsMenu.');
        return 'backToDevice'; // אותת ל-selectServiceMenu לצאת גם כן
      case 'exit':
        logger.info('Exiting explorer.');
        logger.debug('User chose exit from serviceActionsMenu.');
        return 'exit'; // אותת לכל הרמות לצאת
    }
  }
  logger.debug('Exiting serviceActionsMenu function (loop ended, likely backToServices).');
  // אם הגענו לכאן, זה אומר שהמשתמש בחר backToServices
}

async function selectActionMenu(device: FullDeviceDescription, service: ServiceDescription): Promise<void> {
  logger.debug(`Entered selectActionMenu for service: ${service.serviceId}`);
  if (!service.actionList || service.actionList.size === 0) {
    logger.warn(`Service ${service.serviceId} has no actions.`);
    // אין פעולות, אז נחזור לתפריט השירותים, והוא יחליט אם להציג את עצמו שוב
    return; // פשוט יוצאים, הלולאה ב-serviceActionsMenu תמשיך
  }

  let keepMenuOpen = true;
  while (keepMenuOpen) {
    logger.debug('Prompting for action selection in selectActionMenu loop...');
    
    // בדיקה אם stdin מושהה
    if (process.stdin.isPaused && process.stdin.isPaused()) {
      logger.debug('process.stdin is paused. Attempting to resume...');
      process.stdin.resume();
    } else if (typeof process.stdin.isPaused === 'function' && !process.stdin.isPaused()) { // תיקון: התנאי השני צריך להיות פשוט process.stdin.isPaused()
      logger.debug('process.stdin.isPaused is a function and returns false.');
    } else {
      // logger.debug('process.stdin.isPaused does not exist or process.stdin itself is not defined.');
      // במקרה ש-process.stdin.isPaused לא קיים כלל (פחות סביר בסביבת Node/Bun מלאה)
    }

    const selectedActionName = await select({
        message: `Service: ${service.serviceId} - Select an action to invoke:`,
        choices: [
          ...Array.from(service.actionList.values()).map((act: Action) => ({
            name: act.name,
            value: act.name,
          })),
          new Separator(), // שימוש ב-Separator החדש
          { name: 'Back to service actions', value: 'backToServiceActions' }
        ],
      });
    logger.debug(`select prompt for action selection returned. Selected action name: ${selectedActionName}`);

    if (selectedActionName === 'backToServiceActions') {
      logger.debug('User chose backToServiceActions from selectActionMenu.');
      keepMenuOpen = false; // יציאה מהלולאה הפנימית של selectActionMenu
    } else {
      const selectedAction = Array.from(service.actionList.values()).find((act: Action) => act.name === selectedActionName);
      if (!selectedAction) {
        logger.error('Selected action not found (should not happen if listed).');
        // נשארים בלולאה כדי שהמשתמש יוכל לבחור שוב
      } else {
        logger.debug('Calling invokeAction...');
        await invokeAction(device, service, selectedAction);
        logger.debug('Returned from invokeAction. Continuing selectActionMenu loop.');
        // לאחר הפעלת הפעולה, הלולאה תמשיך ותציג שוב את רשימת הפעולות
      }
    }
  }
  logger.debug('Exiting selectActionMenu function (loop ended, means user chose "Back to service actions").');
  // אין צורך להחזיר ערך, פשוט יוצאים והלולאה ב-serviceActionsMenu תמשיך
}

async function invokeAction(device: FullDeviceDescription, service: ServiceDescription, action: Action) {
  logger.info(`Preparing to invoke action: ${action.name} on service ${service.serviceId}`);
  logger.debug(`Entered invokeAction for action: ${action.name}`);

  const inputArguments: { [key: string]: string | number } = {};
  const outputArgumentNames: string[] = [];

  if (action.arguments) { // שונה ל-arguments
    for (const arg of action.arguments) { // שונה ל-arguments
      if (arg.direction === 'in') {
        // אם יש משתנה מצב קשור, נסוך להציג את הערכים האפשריים אם קיימים
        const relatedStateVariable = service.stateVariableList ? Array.from(service.stateVariableList.values()).find((sv: StateVariable) => sv.name === arg.relatedStateVariable) : undefined;
        let choices: any[] | undefined;
        let argType: 'list' | 'input' | 'password' | 'confirm' | 'checkbox' | 'rawlist' | 'expand' | 'editor' | 'number' = 'input'; // נשאר אותו דבר בינתיים

        if (relatedStateVariable?.allowedValueList && relatedStateVariable.allowedValueList.length > 0) {
          choices = relatedStateVariable.allowedValueList.map((val: string) => ({ name: val, value: val }));
          argType = 'list';
        } else if (relatedStateVariable?.dataType === 'boolean') {
            choices = [{name: 'Yes (1 or true)', value: '1'}, {name: 'No (0 or false)', value: '0'}];
            argType = 'list'; // confirm יהיה טוב יותר כאן
        }

        logger.debug(`Prompting for argument: ${arg.name} with type ${argType}`);
        let value: string | number | boolean;

        if (argType === 'list') {
          value = await select({ // שימוש ב-select עבור list
            message: `Select value for argument "${arg.name}" (type: ${relatedStateVariable?.dataType || 'unknown'}):`,
            choices: choices || [], // ודא ש-choices אינו undefined
          });
        } else if (argType === 'input' && relatedStateVariable?.dataType === 'boolean') {
            // שימוש ב-confirm עבור boolean במקום input
            value = await inquirerConfirm({ // שימוש ב-inquirerConfirm החדש
                message: `Set value for boolean argument "${arg.name}":`,
                default: relatedStateVariable.defaultValue === '1' || relatedStateVariable.defaultValue?.toLowerCase() === 'true',
            });
            value = value ? '1' : '0'; // המרה למחרוזת '1' או '0' כפי שמצפה UPnP
        } else {
          value = await inquirerInput({ // שימוש ב-inquirerInput החדש
            message: `Enter value for argument "${arg.name}" (type: ${relatedStateVariable?.dataType || 'unknown'}):`,
            // אין filter ב-API החדש של input, נצטרך לעשות זאת ידנית אם צריך
          });
        }
        
        // החלת filter ידנית אם צריך, כי ה-API החדש לא תומך בו ישירות ב-prompt
        if (argType === 'input' && (relatedStateVariable?.dataType === 'ui4' || relatedStateVariable?.dataType === 'i4' || relatedStateVariable?.dataType === 'number')) {
            value = Number(value);
        }
        
        logger.debug(`inquirerInput/select for argument "${arg.name}" returned. Value: ${value}`);
        inputArguments[arg.name] = value as string | number; // המרה לטיפוס המתאים
      } else if (arg.direction === 'out') {
        outputArgumentNames.push(arg.name); // הוספת שם ארגומנט הפלט למערך
        // הקוד הבעייתי שהיה כאן הוסר ב-diff הקודם,
        // והוחלף בלוגיקה הנכונה המשתמשת ב-select, inquirerInput, inquirerConfirm.
        // ה-diff הנוכחי רק מתקן את הודעת הלוג בשורה 428.
        // אין צורך לשחזר את הקוד הבעייתי.
      }
    }
  }

  logger.debug(`Invoking action "${action.name}" with arguments:`, inputArguments);

  try {
    const controlURL = new URL(service.controlURL, device.baseURL).toString();
    logger.debug(`Calling sendUpnpCommand for action ${action.name}...`);
    const result = await sendUpnpCommand(controlURL, service.serviceType, action.name, inputArguments);
    logger.debug(`sendUpnpCommand for action ${action.name} returned.`);

    logger.info(`Action "${action.name}" invoked successfully.`);
    if (Object.keys(result).length > 0) {
      logger.info('Output arguments:');
      for (const key in result) {
        if (outputArgumentNames.includes(key)) {
          logger.info(`  ${key}: ${result[key]}`);
        }
      }
    } else {
      logger.info('No output arguments returned or defined for this action.');
    }

  } catch (error: any) {
    logger.error(`Error invoking action "${action.name}":`, {
      message: error.message,
      statusCode: error.statusCode,
      body: error.body,
      requestArgs: inputArguments,
    });
    // נוסיף לוג מפורט יותר של השגיאה עצמה
    if (error.soapFault) {
        logger.error('SOAP Fault details:', error.soapFault);
    } else {
        logger.error('Full error object:', error);
    }
  }
  // invokeAction לא קוראת יותר ל-selectActionMenu. היא פשוט מסיימת.
  logger.debug('Exiting invokeAction normally.');
}

async function listStateVariables(device: FullDeviceDescription, service: ServiceDescription): Promise<void> {
  logger.debug(`Entered listStateVariables for service: ${service.serviceId}`);
  logger.info(`State variables for service: ${service.serviceId} (${getFriendlyDeviceType(service.serviceType)})`);
  if (!service.stateVariableList || service.stateVariableList.size === 0) { // שגיאה 484: length -> size
    logger.warn('No state variables found for this service (or SCPD failed to load).');
  } else {
    Array.from(service.stateVariableList.values()).forEach((sv: StateVariable) => { // הוספת טיפוס והמרה ל-Array
      let info = `  - ${sv.name} (dataType: ${sv.dataType})`;
      if (sv.sendEvents === 'yes') {
        info += ' (sends events)';
      }
      if (sv.defaultValue) {
        info += `, Default: ${sv.defaultValue}`;
      }
      logger.info(info);
      if (sv.allowedValueList && sv.allowedValueList.length > 0) {
        logger.info(`    Allowed values: ${sv.allowedValueList.join(', ')}`);
      }
    });
  }

  const queryableVariables = service.stateVariableList ? Array.from(service.stateVariableList.values()).filter((sv: StateVariable) => !sv.name.startsWith('A_ARG_TYPE_')) : []; // שגיאה 502: המרה ל-Array והוספת טיפוס

  if (queryableVariables.length > 0) {
    logger.info('\nAttempting to query current values for (some) state variables:');
    const controlURL = new URL(service.controlURL, device.baseURL).toString();

    for (const sv of queryableVariables) {
        const queryAction = service.actionList ? Array.from(service.actionList.values()).find((a: Action) => a.name === 'QueryStateVariable') : undefined; // שגיאה 509: המרה ל-Array והוספת טיפוס
        if (queryAction) {
            logger.debug(`Querying state variable: ${sv.name}`);
            try {
                const args = { 'varName': sv.name };
                const result = await sendUpnpCommand(controlURL, service.serviceType, 'QueryStateVariable', args);
                logger.debug(`Result for ${sv.name}:`, result);
                if (result && typeof result.return !== 'undefined') {
                    logger.info(`  ${sv.name}: ${result.return}`);
                } else {
                    logger.debug(`QueryStateVariable for ${sv.name} did not return a 'return' value or result was empty.`);
                }
            } catch (error: any) {
                logger.warn(`Could not query state variable ${sv.name}: ${error.message}`);
                logger.debug('Error details:', error);
                 if ((error as any).soapFault) {
                    logger.error('SOAP Fault details during query:', (error as any).soapFault);
                }
            }
        } else {
            logger.debug(`Service ${service.serviceId} does not have a standard QueryStateVariable action. Cannot query ${sv.name}.`);
        }
    }
  }
  // listStateVariables לא קוראת יותר ל-serviceActionsMenu. היא פשוט מסיימת.
  // המשתמש יראה את הפלט, והלולאה ב-serviceActionsMenu תציג שוב את האפשרויות.
  logger.info('Finished listing/querying state variables. Press Enter to return to service actions menu.');
  // הוספת prompt פשוט כדי שהמשתמש יאשר חזרה לתפריט
  await inquirerInput({ message: 'Press Enter to continue...' }); // שימוש ב-inquirerInput החדש
  logger.debug('Exiting listStateVariables normally.');
}


// התחלת התוכנית
logger.debug('Script execution started.');
main().catch(error => {
  logger.error('Unhandled error in main execution:', error);
  logger.debug('Script execution finished with unhandled error in main.');
}).finally(() => {
    logger.debug('Script execution finished (main promise settled).');
});