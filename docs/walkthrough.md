# Walkthrough — DLNA.js

## 2026-09-05 02:26

### תיעוד API מעודכן + תיקון CLI אינטראקטיבי

#### מה בוצע?

**1. תיעוד חבילת `dlna-core`**

- נכתבו מחדש `README.md` ו-`README.he.md` עם ייחוס API לכל הייצוא הציבורי
- נוספו הערות על `setLogger` (שקט כברירת מחדל), `serviceList`, ו-`http-get` מול HTTPS
- קישורי GitHub עודכנו ל-`tzlev-2/DLNA.js`

**2. CLI**

- הוסר `setLogger(console)` מ-`examples/cli_device_explorer.ts` כדי שלא יציף את תפריטי Inquirer
- נוספה הצגת מספר/שמות שירותים בתפריט ההתקן

**3. בדיקות**

- `bun test` ב-`packages/dlna-core`: 63 pass

#### פתוח

- `npm publish` ל-`0.1.0` עדיין ממתין ל-OTP (ב-registry עדיין `0.0.1`)
- מיזוג ל-`main` רק באישור מפורש
