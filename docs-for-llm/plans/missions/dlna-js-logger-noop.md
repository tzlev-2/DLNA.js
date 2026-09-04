# פקודת-משימה — `dlna-js-logger-noop` (A1 בלבד)

> **תאריך**: 2026-09-04 · **כותב**: autorun (Cursor) · **צרכן**: מרדכי (planner)
> **סטטוס**: ✅ נעולה
> **Base (DLNA.js)**: `main` @ **`db85968d4d3649b7ad149e24b38bef21e811f48b`**
> **ענף-ההרצה**: `integration/run-dlna-js-publish`
> **Worktree**: `/home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish`
>
> 🔴 סלייס = `slice/dlna-js-logger-noop` **מתוך** ה-worktree הזה (`checkout -b`), לא worktree שני.
>
> **סוג מסמך**: פקודת-משימה — הרובד מעל הבריף.
> **תוכנית-אב**: `docs-repo/dlna.js/publish-0.1.0-plan.md` (קומיט `7e466d5`) — **סלייס A1 בלבד**
> **מאגר-דוחות**: `$BDS_REPORTS/DLNA.js/` (= `/home/user/Projects/brief-driven-slices/main/reports/DLNA.js/`)
>
> **בחירת-תור**: המשתמש — «רוץ על התוכנית עם autorun»

---

## §1 — המטרה, במונחי חוויה

אחרי הסלייס: `import 'dlna.js'` (או ייבוא מודול מהליבה) **לא** יוצר `logs/`, **לא** נרשם ל-`uncaughtException`/`unhandledRejection`, ו**אין** Winston/Logtail בתלויות החבילה. אפשר להזריק לוגר מאוחר יותר ב-`setLogger` / `setLoggerFactory` והלוגים באמת מגיעים (late binding).

אין שינוי נראה למשתמש קצה ב-UI — תשתית לפרסום npm.

---

## §2 — גבולות ה-scope

| | בפנים | בחוץ |
|---|---|---|
| קוד | `packages/dlna-core/src/logger.ts` → ממשק `DlnaLogger` + no-op + `setLogger`/`setLoggerFactory` + `createModuleLogger` עם late binding · 5 אתרי `logger.trace` → `debug` ב-`activeDeviceManager.ts` · מחיקת `testLogger.test.ts` · הסרת `winston` + `@logtail/*` מ-`dependencies` · טסט קבלת late-binding (spy) | **A2** (העברת Winston ל-`packages/server` + מיגרציית 12+7 קבצים) · B (node-cache/debugger/build) · C (README) · D (publish) · שאר החבילות · מיזוג ל-`main` |
| תור | A1 מתוך התוכנית | A2→D — סבבים הבאים אחרי דוח-ריצה |

### 🔴 משפחת-סלייסים — עצור אחרי A1

```
A1 (הריצה הזו)  dlna-js-logger-noop     ← רק זה
A2 (סבב הבא)     logger → packages/server
B → C → D        build/docs/publish
```

אחרי מיזוג A1 ל־`integration/run-dlna-js-publish` — **דוח-ריצה**, בלי לפתוח A2 באותו סבב.

---

## §3 — אילוצים בלתי-ניתנים למשא-ומתן

1. 🔴 **Late binding חובה.** `createModuleLogger('X')` ברמת מודול (הדפוס בכל הליבה) חייב לקרוא ל-`factory` **בזמן הלוג**, לא לתפוס מצביע ב-import. בדיקת קבלה: import ליבה → `setLogger(spy)` → פעולה שמלוגגת → spy נקרא.
2. 🔴 **ארבע מתודות בלבד** בממשק: `error`/`warn`/`info`/`debug` — varargs. **אין** `trace` בממשק (`console.trace` ≠ debug). חמשת אתרי ה-`trace` עוברים ל-`debug`.
3. 🔴 **`createModuleLogger` / `createLogger` נשארים מיוצאים** מ-`index.ts` — מגובים ב-no-op. אין שבירת API לייבואנים פנימיים של השם.
4. 🔴 **אפס** `exceptionHandlers` / `rejectionHandlers` / כתיבה ל-CWD / listeners על process מהליבה.
5. 🔴 **הקפאת Claude** — `cli=cursor` בלבד. מרדכי/אביגיל/כלב-heavy = **Grok** · אליעזר+כלב = Composer 2.5. `BDS_SLICE=dlna-js-logger-noop`. תמיד `noWait`.
6. ⛔ מיזוג החוצה מ־ענף־ההרצה ל-`main` — **המשתמש בלבד**.
7. 🔴 המפרט המלא: נספח «עיצוב הלוגר בפועל» ב-`publish-0.1.0-plan.md` — לא לסטות ממנו בלי תיעוד.

### הכרעות נעולות (מהתוכנית)

| # | הכרעה |
|---|---|
| Winston | עובר ל-`packages/server` ב-**A2**, לא כאן. ב-A1 רק מוסר מהליבה |
| חבילת logger נפרדת | **נשלל** |
| 15 קבצי ליבה | **לא נוגעים** חוץ מ-5×`trace` + החלפת `logger.ts` + מחיקת טסט |

---

## §4 — הרשאות-מראש

כל ברירות `MISSION_TEMPLATE.md` §4 מאושרות. Cursor בלבד (הקפאת Claude). מודל לפי `docs/dispatch.md`.

---

## §5 — plan-gate

סבב אביגיל **אחד** על הבריף שתכתוב מתוך התוכנית+נספח.  
תיקון־במקום + שאילתה. לא לולאת READY.

שער-כשירות מכני לפני אביגיל: כל שורת-DoD עם פלט אדום-על-base מודבק; אין DoD על 📖/🔮.

---

## §6 — תנאי-עצירה (חזרה למשתמש לפני §7)

1. גילוי ש-A1 דורש שינוי ב-`packages/server` כדי שהשרת לא יישבר בזמן ריצה מקומית — **עצור** (אמור להיות A2; אם השרת נשבר בגלל הסרת winston מה-hoisting, לתעד ולהציע סדר A1→A2 מהיר, לא למזג לבד ל-main).
2. פעולה בלתי-הפיכה / publish ל-npm.
3. אחרי אביגיל: עדיין NEEDS-REWORK עיצובי אחרי rewrite אחד.

---

## §7 — נקודות-העיניים

1. **אין פריוויו UI** לסלייס הזה.
2. **אישור merge** החוצה מ-`integration/run-dlna-js-publish` — המשתמש בלבד.

### חוזה-קצב

| מתי | מה |
|---|---|
| כל מעבר-שער | tg עם `--title` |
| שקט 30 דק' | שורה אחת: מה רץ / מתי / הבא |

---

## §8 — חובת-ראיה

**מאגר-דוחות יחיד:** `$BDS_REPORTS/DLNA.js/`  
אין מאגר שני. verdict נספר רק עם שיגור מתועד + דוח שם.

### שערי A1 — אדום על base (נמדד 2026-09-04)

| שער | מה גורם לכישלון | אדום על base? |
|---|---|---|
| G1: `winston`/`@logtail/*` ב-`packages/dlna-core/package.json` dependencies | עדיין מופיעים אחרי הסלייס | ✅ כן — ר' §11 |
| G2: `exceptionHandlers`/`rejectionHandlers` ב-`logger.ts` | עדיין קיימים | ✅ כן |
| G3: ייבוא מודול ליבה יוצר/נוגע ב-`logs/` תחת CWD | `fs.existsSync('logs')` אחרי import בתיקייה ריקה | ✅ כן — `packages/dlna-core/logs/` כבר קיים מעץ העבודה |
| G4: late-binding spy | `setLogger(spy)` אחרי import לא מקבל קריאות | ⬜ נבנה בסלייס (אדום לפני המימוש / ירוק אחרי) |
| G5: `logger.trace` ב-`activeDeviceManager.ts` | עדיין קיים | ✅ כן — 5 אתרים |
| G6: `bun test` ב-`dlna-core` — בלי כשל על `logger.http` מ-`testLogger` | הקובץ עדיין קיים ונופל | ✅ כן |

מוטציה: להחזיר זמנית `exceptionHandlers` או `winston` dependency → G2/G1 חייבים להאדים.

---

## §9 — סדר-ההרצה

```
מרדכי כותב brief(A1) מתוך publish-0.1.0-plan.md נספח הלוגר
  → אביגיל ×1
  → אליעזר על slice/dlna-js-logger-noop מתוך worktree ההרצה
  → כלב (phase; heavy אם מורכבות גבוהה — התוכנית מכנית → phase מספיק אלא אם אביגיל דורשת)
  → מיזוג ל-integration/run-dlna-js-publish
  → עצירה + דוח (לא A2)
```

בריף נכתב מאפס; התוכנית+נספח הם המקור.

---

## §10 — מסירה למרדכי

ר' `brief-driven-slices/autonomous-runs/prompts/kickoff-mordechai.md`.

שיגור: MCP `session_open` + `session_send` `noWait: true`.  
`cli=cursor`, מודל Grok מהרשימה אחרי open.  
`cwd` = worktree ההרצה.  
`BDS_SLICE=dlna-js-logger-noop`.

---

## §11 — עובדות שנמדדו לפני הבריף

### (א) Base hash ✅
```
git -C /home/user/Projects/DLNA.js rev-parse HEAD
→ db85968d4d3649b7ad149e24b38bef21e811f48b
```
ענף-הרצה נפתח מ-hash זה: `integration/run-dlna-js-publish` ב-`.worktrees/run-dlna-js-publish`.

### (ב) winston + logtail ב-dependencies של הליבה ✅
```
git show db85968:packages/dlna-core/package.json | jq '.dependencies | keys'
→ ["@logtail/node","@logtail/types","@logtail/winston",...,"winston",...]
```
⇒ G1 אדום על base.

### (ג) exceptionHandlers ב-logger.ts ✅
```
rg -n "exceptionHandlers|rejectionHandlers" packages/dlna-core/src/logger.ts
→ 343: exceptionHandlers: [
→ 349: rejectionHandlers: [
```
⇒ G2 אדום על base. (winston רושם process listeners — אין `process.on` מפורש לחיפוש.)

### (ד) createModuleLogger ברמת מודול — 9 אתרים ✅
נמדד ב-rg על `packages/dlna-core/src` (ללא test):  
`activeDeviceManager`, `upnpDeviceExplorer`, `upnpDeviceProcessor`, `ssdpSocketManager`, `upnpSoapClient`, `genericHttpParser`, `didlLiteUtils`, `utils`, + `contentDirectoryService` בבנאי.  
⇒ מלכודת late binding אמיתית; 15 קבצים לא אמורים להשתנות מעבר ל-trace.

### (ה) חמישה אתרי logger.trace ✅
```
rg -n "logger\.trace\(" packages/dlna-core/src/activeDeviceManager.ts
→ 164, 193, 436, 446, 520
```

### (ו) logs/ כבר קיים בעץ (side effect) ✅
```
ls packages/dlna-core/logs/
→ exceptions.log, rejections.log (ריקים, נוצרו 2026-09-04 21:12)
```
`.gitignore` תופס את התיקייה.

### (ז) testLogger.test.ts קורא לרמות winston לא קיימות 📖
הקובץ קיים; קורא ל-`logger.http` וכו'. לפי התוכנית — **למחוק**, לא לתקן.

### (ח) תוכנית מאומתת מול הקוד ✅
`docs-repo/dlna.js/publish-0.1.0-plan.md` @ `7e466d5` — כולל נספח עיצוב לוגר, פיצול A1/A2, תיקון ממצא parseNumbers.

### Preflight autorun (חמש הבדיקות)

| # | תוצאה |
|---|---|
| 1 בסיס | הקוד ב-`db85968` — `logger.ts` + deps קיימים |
| 2 שער בר-הרצה | G1–G3,G5–G6 אדומים על base; G4 נבנה בסלייס עם מוטציה |
| 3 תלות-קשת | A1 לפני A2 — אין תלות הפוכה; השרת עלול להישבר עד A2 (מתועד ב-§6) |
| 4 DoD אינו טוען | לא טוענים ש-A2 בוצע / ש-npm פורסם / שהשרת ירוק בלי Winston מקומי |
| 5 נתיב דוחות | `$BDS_REPORTS/DLNA.js/` בלבד |
| 6 מי מריץ | MCP session_*; מרדכי=cursor/Grok; אליעזר=cursor/Composer; Claude מוקפא |

---

## DoD (A1) — מה כלב מודד

1. אין `winston` / `@logtail/*` ב-`packages/dlna-core/package.json` dependencies.
2. `logger.ts` ללא File exception/rejection handlers; import בתיקיית `/tmp` נקייה לא יוצר `logs/`.
3. טסט late-binding: import → `setLogger(spy)` → קריאה → spy נקרא (וההפך: בלי setLogger — שקט).
4. `setLogger(console)` מתקמפל בלי cast.
5. אין `logger.trace` ב-src.
6. `testLogger.test.ts` נמחק.
7. `createModuleLogger` / `setLogger` / `setLoggerFactory` מיוצאים.
8. מיזוג ל-`integration/run-dlna-js-publish` בלבד.
