# Slice — `dlna-js-logger-noop` — בריף (A1 בלבד)

> **תאריך**: 2026-09-04 · **סטטוס**: הושלם (אליעזר C0+C1)
> **אימות אביגיל**: **READY** (0 ממצאים) · דוח: `$BDS_REPORTS/DLNA.js/dlna-js-logger-noop-avigail.md`
> **Dispatch**: סבב אביגיל אחד. אין לולאת READY.
> **Complexity**: 2/10 → `calev` light/phase · **`depends_on`**: `[]`
> **Base קוד**: `main` @ `db85968d4d3649b7ad149e24b38bef21e811f48b`
> **ענף-ההרצה**: `integration/run-dlna-js-publish` @ `06cb745` (bds-init מעל אותו קוד)
> **סלייס**: `slice/dlna-js-logger-noop` — `checkout -b` מתוך ה-worktree, לא worktree שני
> **Worktree**: `/home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish`
> **מקורות**: `publish-0.1.0-plan.md` נספח הלוגר (`7e466d5`) · `missions/dlna-js-logger-noop.md`
> **דוחות**: `$BDS_REPORTS/DLNA.js/` בלבד

---

## §0 — Pre-flight

אין `AGENTS.md` בפרויקט. פרוטוקול: סוכן `eliezer` + `EXECUTOR_DISPATCH.md`.
`main` **אינו** יעד-מיזוג. אין UI, אין דפדפן, אין פורטים. `onecli` לא רלוונטי.
קוד חדש באנגלית (בלי מחרוזות עברית). המפרט בנספח — לא לסטות בלי תיעוד בסטיות.

### תלויות

אין. בנוי על `main` @ `db85968` (ה-tip של ענף-ההרצה מוסיף רק מצביע-משימה).

### Worktree — כבר קיים (אל תפתח כפיל)

```bash
cd /home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish
git checkout -b slice/dlna-js-logger-noop
bun install   # ה-worktree בלי node_modules (נמדד)
```

אחרי C1 (הסרת deps): `bun install` שוב כדי לרענן `bun.lock`.

### איך להריץ

```bash
cd packages/dlna-core
bun test src/logger.late-binding.test.ts
bun test                         # אחרי C1 — בלי testLogger.test.ts
bun run build                    # tsc -p tsconfig.json (exclude של *.test.ts)
```

אין BE/FE/דפדפן.

### Reading list

**must-read**: נספח הלוגר ב-`publish-0.1.0-plan.md` · `logger.ts` (מוחלף) · `index.ts` (`default as createLogger`) · `activeDeviceManager.ts` (`logger.trace(` חי) · `activeDeviceManager.test.ts` (`mock.module('./logger')` עם `debug`, בלי `trace` — **שורד**) · `package.json` dependencies.

**reference**: `testLogger.test.ts` (**מחיקה**) · `packages/server/src/proxyHandler.ts` (`createLogger` מ-`dlna.js`) · `upnpDeviceProcessor.ts` (`// logger.trace` — **אל תיגע**).

### מקורות חיצוניים

אין תלות חדשה. הממשק מכוון ל-`console` (ארבע מתודות varargs). התאמת winston מבנית היא יעד **A2**, לא כאן.

### עובדות שנמדדו (2026-09-04)

cwd = worktree אלא אם צוין main (שם יש `node_modules`). `createTextFormat`/`fileFormat` — אין צרכן מחוץ ל-`logger.ts`. Worktree בלי `node_modules`.

```
git show db85968:packages/dlna-core/package.json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print([k for k in d['dependencies'] if 'winston' in k or 'logtail' in k])"
→ ['@logtail/node','@logtail/types','@logtail/winston','winston']

rg -n "exceptionHandlers|rejectionHandlers" packages/dlna-core/src/logger.ts
→ exceptionHandlers: [  ·  rejectionHandlers: [

# G3 cwd=/tmp/dlna-g3-probe · import מ-main (אותו logger.ts)
createModuleLogger('G3Probe'); logger.info('probe')
→ logs/exceptions.log + logs/rejections.log (ריקים)
# worktree: אין packages/dlna-core/logs/ · main: side-effect ישן

rg setLogger|setLoggerFactory|DlnaLogger packages/dlna-core/src  → אין
# יש רק testLogger.test.ts — אין late-binding test

rg -n '^\s*logger\.trace\(' packages/dlna-core/src
→ activeDeviceManager.ts (חמש קריאות חיות)
# הערות // logger.trace( ב-upnpDeviceProcessor — מחוץ לסקופ

# G6 מ-main:
bun test packages/dlna-core/src/testLogger.test.ts
→ TypeError: logger.http is not a function
# worktree בלי install: Cannot find package 'winston'

rg createLogger|createModuleLogger|setLogger packages/dlna-core/src/index.ts
→ default as createLogger,  ·  createModuleLogger
```

`createModuleLogger('X')` ברמת מודול בליבה (`ActiveDeviceManager`, `upnpDeviceExplorer`, `utils`, …). מלכודת late binding — **אין לשכתב את האתרים**.

---

## §1 — מטרה

`import` מ-`dlna.js` / ממודול ליבה לא יוצר `logs/`, לא נרשם ל-`uncaughtException`/`unhandledRejection`, ואין Winston/Logtail בתלויות החבילה. אחרי `setLogger(spy)` / `setLoggerFactory` הלוגים מגיעים גם אם הלוגר נתפס ב-`const logger = createModuleLogger('X')` ברמת המודול **לפני** ההזרקה.

אין שינוי UI. תשתית לפרסום npm. A2 (Winston ב-`packages/server`) **לא** בריצה הזו.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|-----|
| החלפת `packages/dlna-core/src/logger.ts` ב-`DlnaLogger` + no-op + late binding | ✅ | C1 |
| `setLogger` / `setLoggerFactory` + ייצוא מ-`index.ts` (כולל `createLogger` default) | ✅ | C1 |
| טסט late-binding (spy) + `setLogger(console)` בלי cast | ✅ | C0→C1 |
| קריאות `^\s*logger\.trace\(` ב-`activeDeviceManager.ts` → `debug` | ✅ | C1 |
| מחיקת `testLogger.test.ts` | ✅ | C1 |
| הסרת `winston` + `@logtail/*` מ-`dependencies` + רענון `bun.lock` | ✅ | C1 |
| 15 קבצי ליבה אחרים / הערות `trace` ב-`upnpDeviceProcessor` | ❌ | לא נוגעים |
| Winston → `packages/server` / `bootstrapLogging` / examples | ❌ | **A2** |
| node-cache / `debugger` / README / publish / מיזוג ל-`main` | ❌ | B/C/D · המשתמש |

---

## §3 — Architecture

```
לפני: createModuleLogger('X')@import → winston + exception/rejection File → CWD/logs/ + process listeners
אחרי: factory=()=>noop · wrapper קורא factory(name) בזמן הלוג · setLogger(l)=setLoggerFactory(()=>l??noop)
15 קבצי ליבה + createLogger default — ללא שינוי. A2 (לא כאן): server setLoggerFactory אחרי dotenv
```

---

## §4 — Commits בסדר

### C0 — טסט late-binding אדום (approach: tdd)

**חדש**: `packages/dlna-core/src/logger.late-binding.test.ts`

הטסט **מייבא** `createModuleLogger` וקורא `const logger = createModuleLogger('LateBind')` **ברמת המודול** (לפני `setLogger`). אחרת הוא לא בודק late binding.

מקרים:

1. אחרי ה-import: `setLogger(spy)` → `logger.info('hi', { n: 1 })` → `spy.info` נקרא עם אותם ארגומנטים. אותו דבר ל-`error`/`warn`/`debug`.
2. בלי הזרקה, או אחרי `setLogger(null)`: הקריאות שקטות (spy/console לא נקראים).
3. `setLogger(console)` מופיע **בלי** `as` / cast — שער טיפוס (הקובץ excluded מ-`tsc -p tsconfig.json`; ר' Verification).

`beforeEach`/`afterEach`: `setLogger(null)` (או `setLoggerFactory(null)`) כדי לא להדביק מודולים.

אחרי C0 הקובץ **נכשל** (אין `setLogger` ב-`logger.ts`). אל תממש עדיין.

**Verification** (מצב אחרי C0 בלבד):

```bash
cd packages/dlna-core
bun test src/logger.late-binding.test.ts   # חייב ליפול — setLogger חסר
test -f src/testLogger.test.ts             # עדיין קיים
rg -n "winston" package.json               # עדיין יש
```

---

### C1 — no-op + ייצוא + trace + מחיקת טסט + deps (approach: tdd)

**מוחלף במלואו**: `packages/dlna-core/src/logger.ts`

אפס `import` חיצוני. המפרט = הנספח. חתימות + ה-wrapper (זה החוזה, לא פסבדו):

```ts
export interface DlnaLogger {
  error(message: string, ...meta: unknown[]): void;
  warn (message: string, ...meta: unknown[]): void;
  info (message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}
export type LoggerFactory = (moduleName: string) => DlnaLogger;

export function setLoggerFactory(f: LoggerFactory | null): void
export function setLogger(l: DlnaLogger | null): void
  // גוף: setLoggerFactory(() => l ?? noopLogger)

export function createModuleLogger(moduleName: string): DlnaLogger {
  return {
    error: (m, ...a) => factory(moduleName).error(m, ...a),
    warn:  (m, ...a) => factory(moduleName).warn(m, ...a),
    info:  (m, ...a) => factory(moduleName).info(m, ...a),
    debug: (m, ...a) => factory(moduleName).debug(m, ...a),
  };
}
export default createModuleLogger;
```

`factory(...)` בזמן הלוג בלבד (אסור מצביע/מטמון). אין `trace` / handlers / כתיבה ל-CWD / `process.on`. `null` → no-op. למחוק פורמטי winston + `createTextFormat`.

**משתנה**: `packages/dlna-core/src/index.ts` — מוסיף ייצואים, **לא** דורס את הקיימים:

```ts
export {
  default as createLogger,
  createModuleLogger,
  setLogger,
  setLoggerFactory,
} from './logger';
export type { DlnaLogger, LoggerFactory } from './logger';
```

**משתנה**: `packages/dlna-core/src/activeDeviceManager.ts` — כל `^\s*logger\.trace\(` → `logger.debug(` (אותם ארגומנטים). אל תיגע בלוגיקה.

**DELETE**: `packages/dlna-core/src/testLogger.test.ts`

**משתנה**: `packages/dlna-core/package.json` — הסר מ-`dependencies`: `winston`, `@logtail/node`, `@logtail/winston`, `@logtail/types`. אחר כך `bun install` בשורש המונוריפו (מעדכן `bun.lock`). אל תערוך `package-lock.json` ידנית (שאריות npm).

אל תיגע ב-`packages/server`, `examples/`, או בשאר קבצי הליבה.

**Verification** (`$WT` = נתיב ה-worktree):

```bash
cd $WT/packages/dlna-core
bun test src/logger.late-binding.test.ts && bun test && bun run build
python3 -c "import json; d=json.load(open('package.json')); print([k for k in d.get('dependencies',{}) if 'winston' in k or 'logtail' in k])"  # []
rg -n "exceptionHandlers|rejectionHandlers" src          # אין
rg -n '^\s*logger\.trace\(' src                          # אין (הערות // מותרות)
rg -n "setLogger|setLoggerFactory|createModuleLogger" src/index.ts
test ! -f src/testLogger.test.ts
rg -n 'setLogger\(console\)' src/logger.late-binding.test.ts
rg -n 'setLogger\(console as' src                        # 0
PROBE=$(mktemp -d) && cd "$PROBE" && bun -e \
  "import { createModuleLogger } from '$WT/packages/dlna-core/src/logger.ts'; createModuleLogger('x').info('x'); const fs=require('fs'); if (fs.existsSync('logs')) process.exit(1)"
```

**מוטציית-שער** (לא להשאיר):

1. החזר `"winston": "^3.17.0"` ל-`dependencies` → שער G1 מדפיס מפתח.
2. החזר בלוק `exceptionHandlers:` ל-`logger.ts` → `rg exceptionHandlers src` מוצא.

---

## §5 — DoD

| # | בדיקה | איך | אדום על base? |
|---|------|-----|:---:|
| 1 | אין winston/logtail ב-deps | python3 על `package.json` → `[]` | כן — ארבעה מפתחות (ר' §0) |
| 2 | אין handlers | `rg exceptionHandlers\|rejectionHandlers src` ריק | כן — שני בלוקים ב-`logger.ts` |
| 3 | import לא יוצר `logs/` | probe ב-`mktemp -d` (ר' C1) | כן — probe יצר `exceptions.log`+`rejections.log` |
| 4 | late binding | `bun test src/logger.late-binding.test.ts` ירוק; import לפני `setLogger` | כן — אין `setLogger` / אין הקובץ |
| 5 | `setLogger(console)` בלי cast | `rg 'setLogger\(console\)'` בקובץ הטסט + אפס `console as` | כן — אין הקריאה |
| 6 | אין `logger.trace(` חי | `rg '^\s*logger\.trace\(' src` ריק | כן — חמש קריאות ב-ADM |
| 7 | `testLogger.test.ts` נמחק | `test ! -f src/testLogger.test.ts` | כן — הקובץ חי ונופל על `logger.http` |
| 8 | ייצואים | `createModuleLogger` / `createLogger` / `setLogger` / `setLoggerFactory` ב-`index.ts` | חלקי — רק שני הראשונים |
| 9 | מוטציה | C1 מוטציה → #1 או #2 מאדים | חייב |
| 10 | מיזוג | רק ל-`integration/run-dlna-js-publish` | — |

**ה-DoD אינו טוען:** A2 בוצע · השרת ירוק עם לוגים · npm פורסם · `bun test` של **כל** המונוריפו · `package-lock.json` עודכן · מיזוג ל-`main`.

---

## §6 — Risks

| סיכון | מיטיגציה |
|------|----------|
| תפיסת מצביע ב-import | `factory(name)` בזמן הלוג; הטסט מייבא לפני `setLogger` |
| `rg logger.trace` תופס הערות → עריכת קובץ אסור | שער: `^\s*logger\.trace\(` |
| מחיקת default שוברת `createLogger` | `export default` + `default as createLogger` נשארים |
| mock ADM בלי `trace` | C1 → `debug`; ל-mock כבר יש |
| winston-hoist שובר server | השרת מייבא רק `createModuleLogger`/`createLogger`. יישבר → §7 |
| `package-lock.json` ידני | רק `bun.lock` דרך `bun install` |

---

## §7 — Escalation

עצור ושאל (מרדכי / המשתמש לפי פקודת-המשימה §6) רק אם:

- A1 דורש שינוי ב-`packages/server` כדי שהשרת **יישבר** בריצה מקומית (לא «שקט» — שקט עד A2 הוא צפוי)
- פעולה בלתי-הפיכה / publish
- רצון לסטות מהנספח (מטמון בליבה, `trace` בממשק, חבילת logger נפרדת)
- `WRONG-DISPATCH` / שלושה סבבי-כלב בלי GO

אל תשאל על: סדר C0→C1 · מחיקת `testLogger` · השארת הערות `trace` · מיזוג ל-integration (מותר) · פתיחת A2 (אסור).

---

## §8 — Complexity

Protocol contract ציבורי חדש (`DlnaLogger` / `setLogger*`) +2 · refactor קיים +1 · TDD −1. **Score: 2/10.** Tier: `calev` light. phase אחרי C1 (הקומיט שמחליף את `logger.ts`).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | wrapper / מטמון / `createTextFormat` / lockfile / A2 | נספח · לא בליבה · נמחק · `bun.lock` בלבד · לא בריצה | ❌ |

---

## סטיות מהתכנון (אליעזר)

- `bun run build` / חלק מ-`bun test` ב-`packages/dlna-core` נכשלים על `node-cache` חסר ב-`upnpDeviceProcessor.ts` — **אותו כשל על `integration/run-dlna-js-publish` לפני הסלייס** (slice B, מחוץ ל-A1). late-binding test + שאר שערי C1 ירוקים.
