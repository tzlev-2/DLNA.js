import './envLoader';
import * as winston from 'winston';
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";
import { ILogtailLog } from "@logtail/types";

// הרחבת טיפוסים עבור TypeScript כדי לזהות שדות מותאמים אישית ב-info object
declare module 'winston' {
  namespace Logform { // ניכנס לתוך namespace Logform
    interface TransformableInfo { // נרחיב את הממשק הקיים
      environment?: string;
      module?: string;
      // label עדיין יכול להיות קיים מפורמטים אחרים או מהגדרות קודמות,
      // והוא מוגדר בפורמט הראשי שלנו אם moduleName קיים.
      label?: string;
    }
  }
}

/*
```ps
$env:LOG_MODULES = ""
$env:LOG_LEVEL = ""
```

// הגדרת משתני סביבה לדוגמה (בפועל, הם יוגדרו מחוץ לקוד)
// process.env.LOG_LEVEL = 'debug'; // הצג את כל הרמות עד debug
// process.env.LOG_TO_CONSOLE = 'true';
// process.env.LOG_TO_FILE = 'true';
// process.env.LOG_FILE_PATH = 'logs/test_run.log'; // קובץ לוג ייעודי לבדיקה זו

*/

// הגדרת רמות לוג וצבעים (אופציונלי, winston משתמש ברמות npm כברירת מחדל)
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4 // מחליף את http, verbose, ו-silly
};

// הרחבת הטיפוס של winston.Logger כדי לכלול את המתודות של הרמות המותאמות אישית
// זה מאפשר ל-TypeScript לזהות את המתודות trace(), debug() וכו' על אובייקט הלוגר.
type CustomLogger = winston.Logger & {
  [level in keyof typeof logLevels]: winston.LeveledLogMethod;
};

// הגדרת צבעים לרמות השונות (לקונסולה)
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  trace: 'magenta' // צבע חדש עבור רמת trace
};

winston.addColors(logColors);

// --- פורמטים ---

// פורמט סינון להסתרת מודולים
const hideByModuleNameFormat = winston.format((info) => {
  const logHideModulesEnv = process.env.LOG_HIDE_MODULES;

  // אם LOG_HIDE_MODULES מוגדר
  if (logHideModulesEnv && logHideModulesEnv.trim() !== '') {
    if (info.label) {
      const hiddenModules = logHideModulesEnv.split(',').map(m => m.trim()).filter(m => m);
      // אם רשימת המודולים המוסתרים אינה ריקה והמודול הנוכחי כלול בה, סנן (הסתר)
      if (hiddenModules.length > 0 && hiddenModules.includes(info.label as string)) {
        return false;
      }
    }
  }
  return info; // אם המודול אינו מוסתר או שאין info.label, העבר את ההודעה
});

// פורמט סינון לפי שם מודול (להצגה סלקטיבית)
const filterByModuleNameFormat = winston.format((info) => {
  const logModulesEnv = process.env.LOG_MODULES;

  // אם LOG_MODULES לא מוגדר, ריק, או שווה ל-"*", אל תסנן כלום (אלא אם הוסתר קודם)
  if (!logModulesEnv || logModulesEnv.trim() === '' || logModulesEnv.trim() === '*') {
    return info;
  }

  // אם LOG_MODULES מוגדר (ולא "*"), בצע סינון
  if (info.label) {
    const allowedModules = logModulesEnv.split(',').map(m => m.trim()).filter(m => m);
    // אם רשימת המודולים המותרים אינה ריקה והמודול הנוכחי אינו כלול בה, סנן
    if (allowedModules.length > 0 && !allowedModules.includes(info.label as string)) {
      return false;
    }
  }
  return info; // אם המודול כלול או שאין info.label (נדיר), העבר את ההודעה
});

/**
 * פונקציית עזר לפורמט של מטא-דאטה, כולל טיפול בשגיאות.
 * @param metadata - אובייקט המטא-דאטה של הלוג.
 * @returns מחרוזת מפורמטת של המטא-דאטה.
 */
function formatLogMetadata(metadata: Record<string, any>): string {
  const filteredMeta = Object.entries(metadata);
  if (filteredMeta.length === 0) {
    return '';
  }

  const metaString = filteredMeta
    .map(([key, value]) => {
      if (value instanceof Error) {
        return `${key}=Error: ${value.message}${value.stack ? `\nStack: ${value.stack}` : ''}`;
      } else if (typeof value === 'object' && value !== null &&
                 ('message' in value || 'code' in value || 'stack' in value || 'errno' in value || 'syscall' in value || 'address' in value || 'port' in value)
                ) {
        let errMsg = `${key}=PotentialError: { `;
        if ('message' in value && (value as any).message) errMsg += `message: "${(value as any).message}", `;
        if ('code' in value) errMsg += `code: "${(value as any).code}", `;
        if ('errno' in value) errMsg += `errno: ${(value as any).errno}, `;
        if ('syscall' in value) errMsg += `syscall: "${(value as any).syscall}", `;
        if ('address' in value) errMsg += `address: "${(value as any).address}", `;
        if ('port' in value) errMsg += `port: ${(value as any).port}, `;
        errMsg = errMsg.replace(/, $/, ''); // הסרת פסיק אחרון אם קיים
        errMsg += ` }`;
        if ('stack' in value && (value as any).stack) {
             errMsg += `\nStack: ${(value as any).stack}`;
        }
        return errMsg;
      }
      try {
        return `${key}=${JSON.stringify(value)}`;
      } catch (e) {
        return `${key}=[UnstringifiableObject]`;
      }
    })
    .join(' ');
  
  return metaString ? ` ${metaString}` : ''; // הוספת רווח בהתחלה אם יש תוכן
}


// פורמט בסיסי להודעות טקסט, ניתן להתאמה עם label (משמש לקובץ)
const createTextFormat = () => winston.format.combine(
  hideByModuleNameFormat(),
  filterByModuleNameFormat(),
  winston.format.printf((info) => {
    const originalLevel = info[Symbol.for('level')];
    let levelString = 'UNKNOWN_LEVEL';
    if (typeof originalLevel === 'string') {
      levelString = originalLevel.toUpperCase();
    }
    let logMessage = `${info.timestamp} [${info.environment?.toUpperCase()}] [${levelString}]`;
    if (info.module) {
      logMessage += ` (${info.module})`;
    }
    logMessage += `: ${info.message}`;

    const {
      level, message, timestamp, label,
      module: _module, environment: _environment,
      [Symbol.for('level')]: _levelSymbol, [Symbol.for('message')]: _messageSymbol,
      stack,
      ...otherMeta
    } = info;

    if (!(info instanceof Error && info.stack)) {
      logMessage += formatLogMetadata(otherMeta);
    }

    if (stack) {
      logMessage += `\n${stack}`;
    }
    return logMessage;
  })
);

// פורמט לקונסולה
export const consoleFormat = () => winston.format.combine(
  winston.format.padLevels(),
  hideByModuleNameFormat(),
  filterByModuleNameFormat(),
  winston.format.printf((info) => {
    let logMessage = `${info.timestamp} [${info.environment?.toUpperCase()}] [${info.level.toUpperCase()}]`;
    if (info.module) {
      logMessage += ` (${info.module})`;
    }
    logMessage += `: ${info.message}`;

    const {
      level, message, timestamp, label,
      module: _module, environment: _environment,
      [Symbol.for('level')]: _levelSym, [Symbol.for('message')]: _msgSym,
      stack,
      ...rest
    } = info;

    logMessage += formatLogMetadata(rest);

    if (stack) {
      logMessage += `\n${stack}`;
    }
    return logMessage;
  }),
  winston.format.colorize({ colors: logColors, message: true, level: true, all: true }),
);

// פורמט לקובץ (ללא צבעים) - משתמש ב-createTextFormat
export const fileFormat = () => createTextFormat();


// --- טרנספורטים ---
export const consoleTransport = new winston.transports.Console({
  // הפורמט יוגדר דינמית בפונקציה createModuleLogger
  // או שניתן להגדיר פורמט דיפולטיבי כאן אם רוצים
});

export const fileTransport = (filePath?: string) => new winston.transports.File({
  filename: filePath || process.env.LOG_FILE_PATH || 'logs/app.log',
  format: fileFormat(), // שימוש בפורמט הקובץ שהוגדר, הוא יקבל module ו-environment מה-info object
  maxsize: 5242880, // 5MB
  maxFiles: 5,
  tailable: true,
});


// --- פונקציה ליצירת לוגר ---

// פונקציה חדשה לאתחול הטרנספורט של Logtail
function setupLogtailTransport(moduleName: string, environment: string): winston.transport | null {
  const logtailSourceToken = process.env.LOGTAIL_SOURCE_TOKEN;
  const logtailIngestingHost = process.env.LOGTAIL_INGESTING_HOST;
  const logToLogtail = process.env.LOG_TO_LOGTAIL === 'true';

  if (logToLogtail && logtailSourceToken && logtailIngestingHost) {
    try {
      const logtail = new Logtail(logtailSourceToken, {
        endpoint: `https://${logtailIngestingHost}`,
      });

      // Middleware להוספת קונטקסט מותאם אישית ללוגים הנשלחים ל-Logtail
      const envLocationForLogtail = process.env.ENV_LOCATION; // קריאה פעם אחת

      async function addCustomContextToLogtail(log: ILogtailLog): Promise<ILogtailLog> {
        // יצירת עותק של הלוג כדי לא לשנות את האובייקט המקורי שעשוי להיות בשימוש על ידי טרנספורטים אחרים
        const logWithContext: ILogtailLog & { env_location?: string; original_level?: string; } = { ...log };
        
        if (envLocationForLogtail) {
          logWithContext.env_location = envLocationForLogtail;
        }

        // מיפוי רמת 'trace' המותאמת אישית שלנו לרמת 'debug' הנתמכת על ידי Logtail, תוך שמירת הרמה המקורית
        if ((logWithContext as any).level === 'trace') {
          logWithContext.original_level = 'trace'; // שמירת הרמה המקורית
          (logWithContext as any).level = 'debug';   // מיפוי ל-debug
        }
        
        // environment ו-module כבר מתווספים ל-info object על ידי הפורמט הראשי של Winston,
        // ו-Logtail אמור לאסוף אותם אוטומטית.
        return logWithContext;
      }

      logtail.use(addCustomContextToLogtail);
      
      // Logtail יאסוף את environment ו-module מה-info object, ו-env_location מהמידלוור
      const transport = new LogtailTransport(logtail);
      
      if (process.env.LOG_TO_CONSOLE === 'true' || process.env.LOG_TO_CONSOLE === undefined) {
        // שימוש ב-console.log כאן מכיוון שהלוגר עצמו עדיין לא נוצר במלואו
        console.log(`[LoggerSetup] Logtail transport enabled for module: ${moduleName} in environment: ${environment}`);
      }
      return transport;

    } catch (error) {
      // שימוש ב-console.warn כאן
      console.warn(`[LoggerSetup] Failed to initialize Logtail transport for module: ${moduleName} in environment: ${environment}. Error:`, error);
      return null;
    }
  } else if (logToLogtail) {
    // אם LOG_TO_LOGTAIL=true אבל חסרים טוקנים
    if (process.env.LOG_TO_CONSOLE === 'true' || process.env.LOG_TO_CONSOLE === undefined) {
      console.warn(`[LoggerSetup] Logtail transport is enabled (LOG_TO_LOGTAIL=true) but LOGTAIL_SOURCE_TOKEN or LOGTAIL_INGESTING_HOST are missing. Logtail will not be initialized for module: ${moduleName} in environment: ${environment}.`);
    }
    return null;
  }
  return null; // אם logToLogtail הוא false
}

const createModuleLogger = (moduleName: string): CustomLogger => {
  const environment = process.env.NODE_ENV || 'unknown';
  const activeTransports: winston.transport[] = []; // הגדרת טיפוס מפורשת

  // טרנספורט לקונסולה
  if (process.env.LOG_TO_CONSOLE === 'true' || process.env.LOG_TO_CONSOLE === undefined) {
    // יצירת מופע חדש של הטרנספורט עם הפורמט
    // הפורמט יקבל module ו-environment מה-info object שמוגדר בלוגר הראשי
    const specificConsoleTransport = new winston.transports.Console({
      format: consoleFormat()
    });
    activeTransports.push(specificConsoleTransport);
  }

  // טרנספורט לקובץ
  if (process.env.LOG_TO_FILE === 'true') {
    // יצירת מופע חדש של הטרנספורט עם הפורמט
    // הפורמט יקבל module ו-environment מה-info object שמוגדר בלוגר הראשי
    const specificFileTransport = new winston.transports.File({
      filename: process.env.LOG_FILE_PATH || 'logs/app.log',
      format: fileFormat(),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true,
    });
    activeTransports.push(specificFileTransport);
  }
  
  // --- Logtail Transport ---
  const logtailTransportInstance = setupLogtailTransport(moduleName, environment);
  if (logtailTransportInstance) {
    activeTransports.push(logtailTransportInstance);
  }
 
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels: logLevels,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format((info) => {
        info.environment = environment;
        if (moduleName) {
          info.module = moduleName;
        }
        // ודא ש-label עדיין מוגדר אם פורמטים אחרים מצפים לו, למרות שאנחנו עוברים ל-module
        // עם זאת, hideByModuleNameFormat ו-filterByModuleNameFormat מצפים ל-info.label
        // אז נצטרך להגדיר אותו כאן אם moduleName קיים.
        if (moduleName) {
            info.label = moduleName;
        }
        return info;
      })(),
      winston.format.errors({ stack: true })
    ),
    transports: activeTransports,
    exitOnError: false, // חשוב - לא לצאת מהתהליך במקרה של שגיאה בלוגר עצמו או ב-exception handler
  }) as CustomLogger; // המרת טיפוס מפורשת ל-CustomLogger
};

export { createModuleLogger };
export const createLogger = createModuleLogger;
export default createModuleLogger;

// ייצוא נוסף של הפורמטים והטרנספורטים הבסיסיים לשימוש חיצוני אם נדרש
// (למרות שהטרנספורטים עצמם כבר מיוצאים למעלה, כאן זה יותר להמחשה של הפורמטים)
export { createTextFormat }; // createTextFormat כבר לא מקבל moduleLabel
// שימו לב: consoleTransport ו-fileTransport כבר מיוצאים למעלה.
// fileTransport היא פונקציה, אז השימוש בה יהיה fileTransport()