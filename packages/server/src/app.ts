import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import * as url from "url";
import { createModuleLogger } from './logger';
import { config } from './config';
import apiRouter from './routes'; // ייבוא ה-router הראשי
import { startDiscovery as startDeviceDiscovery } from './deviceManager'; // שינוי שם הייבוא למניעת התנגשות פוטנציאלית

if (!__dirname) {
  // @ts-ignore
  const filePathUrl = import.meta.url; // המרת import.meta.url לנתיב קובץ רגיל
  const filePath = url.fileURLToPath(filePathUrl); // המרת URL לקובץ לנתיב קובץ רגיל

  const dirname = path.dirname(filePath);
  __dirname = dirname;
}

const logger = createModuleLogger('AppServer'); // לוגר ספציפי לקובץ זה

const app = express();

// Enable CORS for a specific origin
app.use(cors({
  origin: 'http://localhost:5173'
}));

// Middleware to parse JSON bodies
app.use(express.json());

try {
  // שימוש ב-router הראשי שהגדרנו עבור ה-API
  app.use(apiRouter);

  // הגשת הממשק החדש של SvelteKit
  const svelteGuiBuildPath = path.join(__dirname, '..', '..', 'svelte-gui', 'build');
  logger.info(`Serving SvelteKit GUI from: ${svelteGuiBuildPath}`);

  // הגשת הקבצים הסטטיים של SvelteKit (JS, CSS, וכו')
  app.use(express.static(svelteGuiBuildPath));

  // Fallback for SPA: כל בקשה אחרת שאינה API תגיש את ה-index.html של SvelteKit
  app.get('*req', (req, res, next) => {
    // ודא שהבקשה אינה מיועדת ל-API כדי למנוע חטיפת בקשות
    if (!req.originalUrl.startsWith('/api')) {
      res.sendFile(path.resolve(svelteGuiBuildPath, 'index.html'), (err) => {
        if (err) {
          // אם יש שגיאה בשליחת הקובץ (למשל, לא נמצא), העבר אותה ל-error handler
          next(err);
        }
      });
    } else {
      // אם הבקשה היא ל-API ולא נמצאה, תן ל-middleware הבא לטפל בה (שיוביל ל-404)
      next();
    }
  });
} catch (e) {
    logger.error("Error setting up static file serving or SPA fallback:", e);
    console.error("Error setting up static file serving or SPA fallback:", e);
}


// Error handling middleware - חייב להיות האחרון
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('An error occurred in an Express handler:', err);

  // אם השגיאה מכילה statusCode, נשתמש בו. אחרת, 500.
  const statusCode = (err as any).statusCode || 500;
  const message = (err as any).customMessage || err.message || "Internal Server Error";

  // הימנעות מחשיפת פרטי שגיאה רגישים בסביבת ייצור
  // בייצור, אולי נרצה להחזיר רק הודעה גנרית עבור שגיאות 500.
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    res.status(500).json({ error: "Internal Server Error" });
  } else {
    res.status(statusCode).json({ error: message, details: err.stack }); // אפשר להוסיף details רק בפיתוח
  }
});

export function startServer(): void {
  try {

    app.listen(Number(config.server.port), () => {
      logger.info(`Server listening on port ${config.server.port}`);
      logger.info(`Access the UI at: http://localhost:${config.server.port}/`); // שינוי קל בהודעה
      // התחל את גילוי המכשירים לאחר שהשרת התחיל להאזין
      startDeviceDiscovery();
    });

  } catch (error) {
    logger.error('Error starting the server:', error);
    
  }
}

export default app; // ייצוא האפליקציה לבדיקות או שימושים אחרים אם נדרש