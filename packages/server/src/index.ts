// Import necessary for side effects (e.g., dotenv.config()) and for explicit calls.
import './config'; // מייבא ומריץ את config.ts, כולל dotenv.config()
import './bootstrapLogging'; // חייב לפני './app'
import { createModuleLogger } from './logger';
import { startServer } from './app';
import { stopDiscovery as stopDeviceDiscovery } from './deviceManager';
// שים לב: startDeviceDiscovery נקרא כעת מתוך startServer ב-app.ts

try {

  const logger = createModuleLogger('MainIndex'); // לוגר לקובץ הראשי

  logger.info('Application starting...');

  // הפעלת השרת. גילוי המכשירים יתחיל מתוך startServer.
  startServer();

  // כיבוי חינני
  process.on('SIGINT', () => {
    logger.info('SIGINT received. Attempting graceful shutdown...');
    stopDeviceDiscovery();
    // כאן אפשר להוסיף לוגיקה נוספת לסגירת השרת בצורה חיננית אם app.ts מייצא פונקציה כזו
    // לדוגמה, אם startServer החזיר את מופע השרת (http.Server):
    // if (serverInstance && typeof serverInstance.close === 'function') {
    //   serverInstance.close(() => {
    //     logger.info('HTTP server closed.');
    //     process.exit(0);
    //   });
    //   // קבע זמן קצוב למקרה שהסגירה נתקעת
    //   setTimeout(() => {
    //     logger.warn('HTTP server close timed out. Forcing exit.');
    //     process.exit(1);
    //   }, 5000); // 5 שניות המתנה
    // } else {
    //   process.exit(0);
    // }
    // כרגע, נצא אחרי השהייה קצרה
    setTimeout(() => {
      logger.info('Exiting process after SIGINT.');
      process.exit(0);
    }, 1000); // תן זמן קצר לסגירת תהליכים
  });

  process.on('uncaughtException', (error) => {
    logger.error('CRITICAL: Uncaught Exception:', error);
    // מומלץ לצאת מהתהליך במקרה של שגיאה לא נתפסת, לאחר רישום הלוג.
    // זה מונע מצב לא יציב של האפליקציה.
    stopDeviceDiscovery(); // נסה לעצור את הגילוי לפני היציאה
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
    stopDeviceDiscovery(); // נסה לעצור את הגילוי לפני היציאה
    process.exit(1);
  });

  logger.info('Application main index setup complete. Server startup initiated.');

} catch (error) {

  console.error('Error during application startup:', error);
  // במקרה של שגיאה קריטית, נצא מהתהליך
  process.exit(1);

}