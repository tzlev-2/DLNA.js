# Slice — `dlna-js-logger-server` — בריף (A2)

> **תאריך**: 2026-09-04 · **סטטוס**: מאומת (תיקון-במקום אחרי USABLE-AFTER-FIX)
> **אימות אביגיל**: **READY** (USABLE-AFTER-FIX → 3 תיקונים במקום, בלי סבב שני) · דוח: `$BDS_REPORTS/DLNA.js/dlna-js-logger-server-avigail.md`
> **Dispatch**: סבב אביגיל אחד. אין לולאת READY.
> **Complexity**: 2/10 → `calev` light · phase אחרי C2 · **`depends_on`**: [`dlna-js-logger-noop`]
> **Base קוד**: `integration/run-dlna-js-publish` @ `c50127867f5fb10659b7d3eb290c1d32e17678f7` (A1 מוזג @ `9eb6708`)
> **סלייס**: `slice/dlna-js-logger-server` — `checkout -b` מתוך ה-worktree, לא worktree שני
> **Worktree**: `/home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish`
> **מקורות**: נספח «עיצוב הלוגר בפועל» ב-`publish-0.1.0-plan.md` · פקודת `dlna-js-publish-finish`
> **דוחות**: `$BDS_REPORTS/DLNA.js/` בלבד

---

## §0 — Pre-flight

אין `AGENTS.md`. פרוטוקול: סוכן `eliezer` + `EXECUTOR_DISPATCH.md`.
`main` אינו יעד-מיזוג. אין UI / דפדפן / פורטים. קוד חדש באנגלית.
המפרט = הנספח. אל תסטה בלי תיעוד בסטיות.

### תלויות

**A1 `dlna-js-logger-noop`** — merged, כלב GO. מספק `setLogger` / `setLoggerFactory` / `DlnaLogger` ב-`packages/dlna-core/src/logger.ts`. בלי זה A2 אין למה להזריק.

### Worktree — כבר קיים (אל תפתח כפיל)

```bash
cd /home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish
git checkout slice/dlna-js-logger-server   # הענף כבר קיים על tip הבריף; אל תפתח worktree שני
```

אחרי C1 (הוספת deps): `bun install` בשורש המונוריפו (מרענן `bun.lock`).

### איך להריץ

```bash
cd packages/dlna-core && bun test src/logger.late-binding.test.ts
# שערי rg/jq של §5 — לא bun test של כל המונוריפו (node-cache = סלייס B)
```

### Reading list

**must-read**: נספח הלוגר · `git show db85968:packages/dlna-core/src/logger.ts` · `packages/server/src/index.ts` · `envLoader.ts`.
**reference**: `proxyHandler.ts` · `server.integration.test.ts` · C3.

### מקורות חיצוניים

אין ספרייה חדשה. גרסאות מ-`db85968` `packages/dlna-core/package.json`: `winston@^3.17.0` · `@logtail/node@^0.5.5` · `@logtail/winston@^0.5.5` · `@logtail/types@^0.5.3`.
התאמה מבנית winston→`DlnaLogger` (נספח): `setLoggerFactory(createModuleLogger)` **בלי** cast.

### עובדות שנמדדו (2026-09-04, cwd=worktree)

```
test -f packages/server/src/{logger,bootstrapLogging}.ts  → שניהם חסרים
jq '.dependencies|keys' packages/server/package.json     → אין winston/logtail
rg setLoggerFactory packages/server examples             → ריק
rg "createModuleLogger|createLogger" packages/server/src → 10 קבצי שרת + integration test (נתיב יחסי)
rg "dlna-core/src/logger" examples                       → 3 קבצים; עוד 4 כבר מ-dlna.js בלי setLogger
rg "uncaughtException|unhandledRejection" packages/server/src/index.ts → process.on + exit(1) — אל תכפיל
```

`createTextFormat` — אין צרכן חי.

---

## §1 — מטרה

השרת במונוריפו מזריק Winston דרך `setLoggerFactory` **לפני** טעינת `./app`, כך שלוגי ליבה (ADM וכו') ולוגי שרת יוצאים ל-Winston עם סינון `LOG_MODULES`. `import 'dlna.js'` בלי הזרקה נשאר שקט. דוגמאות מדפיסות דרך `setLogger(console)`. אין Winston בתלויות `dlna-core`. אין `logs/` חדש תחת `packages/dlna-core/`.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|-----|
| `packages/server/src/logger.ts` = העתקה מ-`db85968` **בלי** `exceptionHandlers`/`rejectionHandlers` + `import './envLoader'` | ✅ | C1 |
| winston + `@logtail/*` ב-`packages/server/package.json` + `bun.lock` | ✅ | C1 |
| `bootstrapLogging.ts` + סדר הייבוא ב-`index.ts` | ✅ | C2 |
| פיצול ייבוא הלוגר בקבצי השרת → `./logger` | ✅ | C2 |
| `examples/`: `setLogger(console)` בשבעה; ב-3 היחסיים — אותו specifier, לא `dlna.js` | ✅ | C3 |
| ליבה / `setLogger*` / 15 קבצי `dlna-core` | ❌ | A1 סגור |
| node-cache / `debugger` / README / publish / מיזוג ל-`main` | ❌ | B/C/D · המשתמש |

---

## §3 — Architecture

```
index.ts:  ./config → ./bootstrapLogging → ./app
bootstrapLogging: setLoggerFactory(server.createModuleLogger)
ליבה (import-time const logger = createModuleLogger('X'))
        └─ wrapper קורא factory(name) בזמן הלוג → Winston + LOG_MODULES
שרת: createModuleLogger/createLogger מ-./logger (Winston ישיר)
examples: setLogger(console) — פעם אחת לסשן
אל: setLoggerFactory בגוף index.ts (ייבואי ES רצים קודם — נספח)
אל: exceptionHandlers ב-Winston (כפול ל-process.on ב-index.ts)
```

---

## §4 — Commits בסדר

### C1 — Winston בשרת + deps (approach: none)

**חדש**: `packages/server/src/logger.ts`

מקור: `git show db85968:packages/dlna-core/src/logger.ts`. העתק כמעט verbatim.

שני שינויים בלבד:

1. שורת ראשונה אחרי ההעתקה (לפני `winston`): `import './envLoader';`
2. **DELETE** מאובייקט האפשרויות של `winston.createLogger`: המפתחות `exceptionHandlers` ו-`rejectionHandlers` (עוגן: השמות עצמם; כל אחד מצביע ל-`File` עם `logs/exceptions.log` / `logs/rejections.log`). `process.on` ב-`index.ts` נשאר — זו הסיבה למחיקה.

הוסף ייצוא מפורש ל-`createLogger` (alias), כדי ש-`proxyHandler` יוכל `import { createLogger } from './logger'`:

```ts
export { createModuleLogger };
export const createLogger = createModuleLogger;
export default createModuleLogger;
```

**משתנה**: `packages/server/package.json` — ארבע הגרסאות מ-§0 ב-`dependencies`. אחר כך `bun install` בשורש. לא `package-lock.json` ידנית.

אל תיגע ב-`packages/dlna-core`.

**Verification**:

```bash
test -f packages/server/src/logger.ts
rg -n "exceptionHandlers|rejectionHandlers" packages/server/src/logger.ts   # ריק
rg -n "import './envLoader'" packages/server/src/logger.ts
python3 -c "import json; d=json.load(open('packages/server/package.json')); print([k for k in d['dependencies'] if 'winston' in k or 'logtail' in k])"
# → ארבעה מפתחות
```

---

### C2 — bootstrap + מיגרציית שרת (approach: integration)

**חדש**: `packages/server/src/bootstrapLogging.ts` — הנספח, verbatim, **בלי** cast:

```ts
import { setLoggerFactory } from 'dlna.js';
import { createModuleLogger } from './logger';
setLoggerFactory(createModuleLogger);
```

מטמון `Map` סביב ה-factory מותר. אסור wrapper שמשטח `moduleName`.

**משתנה**: `packages/server/src/index.ts` — סדר הייבוא בראש הקובץ:

```ts
import './config';
import './bootstrapLogging';  // חייב לפני './app'
import { createModuleLogger } from './logger';
import { startServer } from './app';
import { stopDiscovery as stopDeviceDiscovery } from './deviceManager';
```

אל תמחק ייבואים קיימים. `createModuleLogger('MainIndex')` ו-`process.on` נשארים. אסור `setLoggerFactory` בגוף `index.ts`.

**פיצול ייבוא** — רק סמל הלוגר עובר ל-`./logger`; שאר `dlna.js` נשאר. הקבצים (שער: `rg createModuleLogger|createLogger` תחת `packages/server/src`):

| קובץ | מה לעשות |
|---|---|
| `app.ts` · `deviceActionService.ts` · `index.ts` | `from 'dlna.js'` של הלוגר → `from './logger'` |
| `deviceManager.ts` · `continuousDeviceExplorer.ts` · `playPresetHandler.ts` · `presetManager.ts` · `browseHandler.ts` · `rendererHandler.ts` | לפצל: לוגר מ-`./logger`, השאר מ-`dlna.js` |
| `proxyHandler.ts` | `import { createLogger } from './logger'` |
| `server.integration.test.ts` | הנתיב `../../dlna-core/src/logger` → `./logger` |

`config.ts` / `types.ts` / `routes.ts` — לא נוגעים (אין ייבוא לוגר חי).

**Verification**:

```bash
rg -n "import './bootstrapLogging'" packages/server/src/index.ts
python3 -c "
import pathlib
t=pathlib.Path('packages/server/src/index.ts').read_text()
print('order-ok' if t.find(\"import './bootstrapLogging'\") < t.find(\"from './app'\") else 'ORDER-BAD')
"
python3 -c "
import pathlib,re
bad=[]
for p in pathlib.Path('packages/server/src').rglob('*.ts'):
    t=p.read_text()
    if 'dlna-core/src/logger' in t: bad.append(p.name+':rel')
    for m in re.finditer(r'import\s+(?:type\s+)?(?:\{[^}]*\}|\w+)\s+from\s+[\'\"]dlna\.js[\'\"]', t, re.S):
        if re.search(r'\b(createModuleLogger|createLogger)\b', m.group(0)):
            bad.append(p.name)
print('clean' if not bad else bad)
"
rg -n "setLoggerFactory\(createModuleLogger\)" packages/server/src/bootstrapLogging.ts
rg -n "setLoggerFactory\(createModuleLogger as" packages/server   # 0
cd packages/dlna-core && bun test src/logger.late-binding.test.ts
```

---

### C3 — examples + `setLogger(console)` (approach: none)

שבעה קבצים. **לא** `browse-files.ts` (אין לוגר).

**שלושה עם נתיב יחסי ל-logger** — **אל תחליף ל-`dlna.js`**. `examples/package.json` בלי התלות (נמדד: `Cannot find package 'dlna.js'`). `setLogger` מאותו specifier כמו הלוגר, כדי ש-ADM ו-factory יישבו באותו מודול `src` (לא `dist`):

- `examples/active_device_manager_example.ts`
- `examples/active_device_manager_output_test.ts`
- `examples/server_api_devices_fetch_test.ts`

```ts
import { createModuleLogger, setLogger } from '../packages/dlna-core/src/logger';
setLogger(console);
```

אל תשנה ייבוא `../packages/dlna-core/src/index` אם קיים. `const logger = createModuleLogger(...)` נשאר. ארבעת הקבצים שכבר על `dlna.js` — לא חובת A2 לתקן את `examples/package.json`.

**ארבעה שכבר מייבאים `createLogger` מ-`dlna.js`** — הוסף `setLogger` לאותו import + `setLogger(console);` אחרי הייבואים, לפני הלוג הראשון:

- `examples/cli_device_explorer.ts`
- `examples/cli_device_explorer_iterable_test.ts`
- `examples/mute_renderer_audio.ts`
- `examples/play_on_renderer_example.ts`

**Verification**:

```bash
rg -n "setLogger\(console\)" examples    # שבע התאמות — אחד לכל קובץ ברשימה
rg -n "from 'dlna.js'" examples/active_device_manager_example.ts examples/active_device_manager_output_test.ts examples/server_api_devices_fetch_test.ts  # ריק
rg -n "setLogger" examples/active_device_manager_example.ts   # מ-src/logger, לא מ-dlna.js
rg -n "setLogger\(console as" examples   # 0
PROBE=$(mktemp -d) && cd "$PROBE" && bun -e \
  "import { createModuleLogger } from '$WT/packages/dlna-core/src/logger.ts';
   createModuleLogger('x').info('x');
   const fs=require('fs'); if (fs.existsSync('logs')) process.exit(1)"
```

(`$WT` = נתיב ה-worktree.)

**מוטציית-שער** (לא להשאיר): החזר בלוק `exceptionHandlers:` ל-`packages/server/src/logger.ts` → `rg exceptionHandlers packages/server/src` מוצא. אחר כך revert.

---

## §5 — DoD

| # | בדיקה | איך | אדום על base? |
|---|------|-----|:---:|
| 1 | logger+bootstrap קיימים; אין handlers | `test -f` + `rg exceptionHandlers\|rejectionHandlers` ריק תחת `packages/server/src` | כן |
| 2 | winston+logtail ב-deps של server | python3 על `package.json` → ארבעה מפתחות | כן — אפס |
| 3 | bootstrap לפני `./app` | סדר המחרוזות ב-`index.ts` (ר' C2) | כן — אין הייבוא |
| 4 | אין לוגר מ-`dlna.js` בשרת | python C2 → `clean` (קובץ, לא שורה) | כן |
| 5 | 3 examples יחסיים: `setLogger` מ-`src/logger`, לא מ-`dlna.js` | `rg` C3 | כן — אין `setLogger` |
| 6 | `setLogger(console)` בשבעה, בלי cast | `rg` C3 | כן — אפס |
| 7 | `setLoggerFactory(createModuleLogger)` בלי cast | `rg` C2 | כן |
| 8 | late-binding של A1 חי | `bun test src/logger.late-binding.test.ts` | לא — כבר ירוק; רגרסיה |
| 9 | import ליבה שקט | probe C3 — אין `logs/` | לא על worktree (A1); חובה שלא יישבר |
| 10 | מוטציה | C3 מוטציה → #1 מאדים | חייב |
| 11 | מיזוג | רק ל-`integration/run-dlna-js-publish` | — |

**ה-DoD אינו טוען:** `bun test`/`build` של כל `dlna-core` (node-cache=B) · השרת עולה · `import 'dlna.js'` מ-`examples/` (אין התלות — מצב קדם) · LOG_MODULES חי · npm publish · מיזוג ל-`main`.

---

## §6 — Risks

| סיכון | מיטיגציה |
|------|----------|
| `setLoggerFactory` בגוף `index.ts` → שורת `AppServer` + לוגי ליבה נבלעים | ייבוא side-effect לפני `./app` |
| העתקה verbatim משאירה handlers | DELETE מפורש + שער `rg` + מוטציה |
| פיצול ייבוא שובר סמלי `dlna.js` אחרים | רק סמל הלוגר זז; טבלת C2 |
| `createLogger` חסר בשרת | alias מפורש ב-C1 |
| תלות-סדר env | `import './envLoader'` בראש logger |
| `package-lock.json` ידני | רק `bun.lock` דרך `bun install` |
| `setLogger` מ-`dlna.js` + ADM מ-`src/index` = שני factory | ב-3 היחסיים — אותו specifier |

---

## §7 — Escalation

עצור (מרדכי / §6 של הפקודה) רק אם:

- `setLoggerFactory(createModuleLogger)` נכשל ב-tsc בלי cast (הנספח טוען שזה מתקמפל)
- ההעתקה מ-`db85968` חסרה / שונה מ-364 שורות
- רצון להשאיר Winston בליבה, או `exceptionHandlers`, או חבילת logger נפרדת
- `WRONG-DISPATCH` / שלושה סבבי-כלב בלי GO

אל תשאל על: סדר C1→C3 · `setLogger(console)` · מיזוג ל-integration · B/C/D.
אל תרדוף קריסת `node-cache` מ-`dlna-core/dist` בטעינת השרת — סלייס B.

---

## §8 — Complexity

Refactor +1 · >5 קבצים בשתי חבילות +1 · TDD לא רלוונטי (מיגרציה מכנית). **Score: 2/10.** Tier: `calev` light. phase אחרי C2 (סדר הייבוא).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | מטמון Map ב-factory / `createLogger` alias / lockfile / B | אופציונלי · חובה · `bun.lock` · לא בריצה | ❌ |

---

## סטיות מהתכנון (אליעזר)

- …
