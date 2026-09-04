# Slice — `dlna-js-build-green` — בריף (B)

> **תאריך**: 2026-09-04 · **סטטוס**: מאומת
> **אימות אביגיל**: **READY** (0 ממצאים) · דוח: `$BDS_REPORTS/DLNA.js/dlna-js-build-green-avigail.md`
> **Dispatch**: סבב אביגיל אחד. אין לולאת READY.
> **Complexity**: 2/10 → `calev` light · phase אחרי C1 · **`depends_on`**: [`dlna-js-logger-server`]
> **Base קוד**: `integration/run-dlna-js-publish` @ `475fc5630dd220f24ded61ed35750bc9ae14e149` (A2 מוזג)
> **סלייס**: `slice/dlna-js-build-green` — `checkout -b` מתוך ה-worktree, לא worktree שני
> **Worktree**: `/home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish`
> **מקורות**: `publish-0.1.0-plan.md` שלב 2 · פקודת `dlna-js-publish-finish`
> **דוחות**: `$BDS_REPORTS/DLNA.js/` בלבד

---

## §0 — Pre-flight

אין `AGENTS.md`. פרוטוקול: `eliezer` + `EXECUTOR_DISPATCH.md`.
`main` אינו יעד-מיזוג. אין UI / דפדפן / פורטים. קוד חדש באנגלית.

### תלויות

**A2 `dlna-js-logger-server`** — merged @ `475fc56`, כלב GO. B לא נוגע בלוגר. `testLogger.test.ts` כבר נמחק ב-A1 — אל «תתקן logger.http».

### Worktree — כבר קיים

```bash
cd /home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish
git checkout slice/dlna-js-build-green   # ייפתח אחרי קומיט הבריף; אל תפתח worktree שני
```

### איך להריץ

```bash
cd packages/dlna-core
bun run build          # tsc -p tsconfig.json (exclude *.test.ts)
bun test
```

### Reading list

**must-read**: `packages/dlna-core/src/upnpDeviceProcessor.ts` (`import NodeCache` · `macAddressCache` · `^\s*debugger;`) · `packages/dlna-core/package.json`.

**reference**: אתר `macAddressCache.get`/`set` באותו קובץ · `tsconfig.json` / `tsconfig.base.json`.

### מקורות חיצוניים

אין ספרייה חדשה. **אל תוסיף `node-cache` לליבה** — הנספח מעדיף `Map` + TTL. גרסאות dev: `typescript@^5.8.3` (שורש המונוריפו) · `@types/node@^22` (כמו `webos-remote-ui` / `mqtt-router`).

### עובדות שנמדדו (2026-09-04, cwd=worktree @ 475fc56)

```
python3 … dlna-core/package.json  → dependencies בלי node-cache; dev = ['@types/xml2js']
rg '^\s*debugger;' packages/dlna-core/src → upnpDeviceProcessor.ts (מופע יחיד, ענף catch כללי)
rg NodeCache packages/dlna-core/src → import + new NodeCache({ stdTTL: 60*60*2, checkperiod: 120 }) + get/set
bun run build → TS2307 Cannot find module 'node-cache'
bun test → 30 pass / 2 fail: upnpDeviceProcessor.test.ts + activeDeviceManager.test.ts
           שניהם Unhandled error: Cannot find package 'node-cache'
```

`if (cacheAddr)` אחרי `get` — מחרוזת ריקה היא falsy (כשל-MAC לא נשמר בפועל). **לשמור** את הסמנטיקה; לא «לתקן».

---

## §1 — מטרה

`bun run build` ו-`bun test` ירוקים מתוך `packages/dlna-core` בלי hoisting של `node-cache` מהשרת. אין `debugger;` בליבה. החבילה מצהירה `typescript` + `@types/node` ב-devDependencies.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|-----|
| החלפת `NodeCache` ב-`Map` + TTL (שעתיים) ב-`upnpDeviceProcessor.ts` | ✅ | C1 |
| מחיקת `^\s*debugger;` | ✅ | C2 |
| `typescript` + `@types/node` ב-devDependencies + `bun.lock` | ✅ | C3 |
| build + test ירוקים ב-`dlna-core` | ✅ | C3 |
| הוספת `node-cache` לליבה | ❌ | נשלל |
| README / publish / Winston / מיזוג ל-`main` | ❌ | C/D · המשתמש |

---

## §3 — Architecture

```
לפני: import NodeCache (חסר מ-package.json) → tsc TS2307 + bun test fail
אחרי: Map<ip, {value, expiresAt}> · TTL = 2h · expire ב-get
      debugger; נמחק · logger.error נשאר
      typescript + @types/node ב-devDependencies של החבילה
```

---

## §4 — Commits בסדר

### C1 — Map + TTL במקום node-cache (approach: none)

**משתנה**: `packages/dlna-core/src/upnpDeviceProcessor.ts` בלבד.

DELETE: `import NodeCache from "node-cache";` ו-`const macAddressCache = new NodeCache({...})`.

החלף במטמון מקומי (חתיכות — לא גוף מלא מעבר לזה):

```ts
const MAC_TTL_MS = 60 * 60 * 2 * 1000;
const macAddressCache = new Map<string, { value: string; expiresAt: number }>();
```

`get`/`set` הקיימים (`macAddressCache.get(deviceIp)` / `.set(deviceIp, mac)` / `.set(deviceIp, '')`) חייבים להמשיך לעבוד באותם אתרים — עטוף בפונקציות מקומיות או אובייקט עם אותן מתודות. ב-`get`: אם פג `expiresAt` — מחק והחזר `undefined`. ב-`set`: `expiresAt = Date.now() + MAC_TTL_MS`.

אין ייצוא חדש. אין קובץ חדש. אל תשנה את תנאי `if (cacheAddr)`.

**Verification**:

```bash
rg -n "node-cache|NodeCache" packages/dlna-core/src   # ריק
rg -n "macAddressCache\.(get|set)" packages/dlna-core/src/upnpDeviceProcessor.ts  # האתרים החיים נשארים
```

---

### C2 — מחיקת debugger (approach: none)

**DELETE**: המופע היחיד של `^\s*debugger;` ב-`upnpDeviceProcessor.ts` (ענף ה-`else` של ה-catch ב-`fetchAndParseDeviceDescriptionXml`, מיד לפני `logger.error(...)`). אל תיגע ב-`logger.error`.

**Verification**:

```bash
rg -n '^\s*debugger;' packages/dlna-core/src   # ריק
```

---

### C3 — devDependencies + build/test ירוקים (approach: integration)

**משתנה**: `packages/dlna-core/package.json` — הוסף ל-`devDependencies`: `typescript` `^5.8.3`, `@types/node` `^22`. אחר כך `bun install` בשורש. לא `package-lock.json` ידני.

אל תוסיף `node-cache`.

**Verification**:

```bash
cd packages/dlna-core
bun run build    # יציאה 0
bun test         # 0 fail
python3 -c "import json; d=json.load(open('package.json')); print('node-cache' in d.get('dependencies',{}), d['devDependencies'].get('typescript'), d['devDependencies'].get('@types/node'))"
# → False  ^5.8.3  ^22…
```

**מוטציה** (לא להשאיר): החזר `import NodeCache from "node-cache"` → `rg NodeCache src` מוצא. אחר כך revert.

---

## §5 — DoD

| # | בדיקה | איך | אדום על base? |
|---|------|-----|:---:|
| 1 | אין `node-cache`/`NodeCache` ב-`src` | `rg` C1 ריק | כן |
| 2 | אין `debugger;` חי | `rg '^\s*debugger;' src` ריק | כן |
| 3 | `bun run build` ירוק | cwd=`packages/dlna-core` יציאה 0 | כן — TS2307 |
| 4 | `bun test` ירוק | 0 fail ב-`dlna-core` | כן — 2 fail על node-cache |
| 5 | typescript + `@types/node` ב-devDependencies; אין node-cache ב-deps | python3 C3 | כן |
| 6 | מוטציה | C3 מוטציה → #1 מאדים | חייב |
| 7 | מיזוג | רק ל-`integration/run-dlna-js-publish` | — |

**ה-DoD אינו טוען:** README / `getService` · npm publish · עליית שרת · מיזוג ל-`main` · תיקון סמנטיקת cache של `''`.

---

## §6 — Risks

| סיכון | מיטיגציה |
|------|----------|
| הוספת `node-cache` «כדי לירוק מהר» | נשלל ב-§2; שער #5 |
| שינוי `if (cacheAddr)` / לוגיקת MAC | רק החלפת האחסון |
| `rg debugger` תופס הערות | שער: `^\s*debugger;` |
| `package-lock.json` ידני | רק `bun.lock` |

---

## §7 — Escalation

עצור רק אם: `bun test` נכשל אחרי הסרת node-cache מסיבה אחרת · רצון להשאיר `debugger` · `WRONG-DISPATCH` / שלושה סבבי-כלב בלי GO.

אל תשאל על: Map מול node-cache (הוכרע) · סדר C1→C3 · מיזוג ל-integration · C/D.

---

## §8 — Complexity

Refactor +1 · TDD לא נדרש. **Score: 2/10.** Tier: `calev` light. phase אחרי C1.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | node-cache vs Map / גרסאות TS / C/D | Map · ^5.8.3 + ^22 · לא בריצה | ❌ |

---

## סטיות מהתכנון (אליעזר)

- …
