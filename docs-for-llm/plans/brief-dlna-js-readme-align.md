# Slice — `dlna-js-readme-align` — בריף (C)

> **תאריך**: 2026-09-04 · **סטטוס**: מאומת (תיקון-במקום אחרי USABLE-AFTER-FIX)
> **סוג מסמך**: בריף ביצועי לסלייס — לא תוכנית טרום-בריף
> **אימות אביגיל**: **READY** (USABLE-AFTER-FIX → 2 תיקונים במקום, בלי סבב שני) · דוח: `$BDS_REPORTS/DLNA.js/dlna-js-readme-align-avigail.md`
> **Dispatch**: סבב אביגיל אחד. אין לולאת READY.
> **Complexity**: 2/10 → `calev` light · phase אחרי כתיבת הבריף · **`depends_on`**: [`dlna-js-build-green`]
> **Base קוד**: `integration/run-dlna-js-publish` @ `e0ba0b5a7a41552eeb4d3102adf4fa6b68f1eebd` (B מוזג)
> **סלייס**: `slice/dlna-js-readme-align` — ייפתח אחרי קומיט הבריף; לא worktree שני
> **Worktree**: `/home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish`
> **מקורות**: `publish-0.1.0-plan.md` שלב 3 + שערי C בפקודה · פקודת `dlna-js-publish-finish`
> **דוחות**: `$BDS_REPORTS/DLNA.js/` בלבד

---

## §0 — Pre-flight

אין `AGENTS.md`. `main` אינו יעד-מיזוג. אין UI / דפדפן.

### תלויות

**B `dlna-js-build-green`** — merged @ `e0ba0b5`, כלב R2 GO. C לא נוגע ב-processor/MAC.

### Worktree

```bash
cd /home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish
git checkout slice/dlna-js-readme-align
```

### Reading list

**must-read**: `packages/dlna-core/README.md` · `README.he.md` · `src/types.ts` (`ServerApiDevice`) · `src/index.ts` (`export * from './types'`) · `package.json` (`files` / `repository`).

**reference**: `processUpnpDevice` / `processUpnpDeviceFromUrl` ב-`upnpDeviceProcessor.ts` — ארגומנט שני הוא `DiscoveryDetailLevel`, לא `{ detailLevel }`.

### מקורות חיצוניים

אין. מפתחות `serviceList`: `normalizeServiceTypeToKey` → שמות קצרים (`AVTransport`, `ContentDirectory`). `README.he.md` כבר משתמש ב-`serviceList.get('AVTransport')`.

### עובדות שנמדדו (2026-09-04, cwd=worktree @ e0ba0b5)

```
rg ApiDevice packages/dlna-core/README.md     → events + import type + handlers
rg getService packages/dlna-core/README.md    → הוראה + 4 קריאות בדוגמאות
rg getService packages/dlna-core/src          → ריק (אין המתודה)
rg ServerApiDevice packages/dlna-core/src/types.ts → interface extends FullDeviceDescription
rg "export type ApiDevice" packages/dlna-core → ריק
README.he.md: serviceList.get כבר נכון; processUpnpDeviceFromUrl(..., { detailLevel: 'full' }) שגוי כמו EN
package.json repository/bugs/homepage → MusiCode1/DLNA.js
jq '.files,.engines,.exports' package.json → files בלי README.he.md; אין engines/exports
git remote: tzlev-2/DLNA.js
```

---

## §1 — מטרה

צרכן שקורא את README ב-npm רואה API שקיים: `ServerApiDevice` (ו-alias `ApiDevice`), `serviceList.get(...)`, חתימות `processUpnpDevice*`. קישור עברית לא נשבר. מטא-דאטה מצביע ל-`tzlev-2`. `engines` + `exports` CJS-only.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|-----|
| `export type ApiDevice = ServerApiDevice` | ✅ | C1 |
| README.md: `getService` → `serviceList.get`; חתימות `processUpnpDevice*` | ✅ | C2 |
| README.he.md: חתימות `processUpnpDevice*` (getService כבר נכון) | ✅ | C2 |
| `README.he.md` ב-`files` + הערת early-release ב-README.md | ✅ | C2 |
| `repository`/`bugs`/`homepage` → `tzlev-2/DLNA.js` · `engines` · `exports` CJS | ✅ | C3 |
| מתודת `getService` חדשה | ❌ | לא — דוקו בלבד |
| source maps / `src` ב-`files` / npm publish / מיזוג ל-`main` | ❌ | D · המשתמש |

---

## §3 — Architecture

```
טיפוס: ServerApiDevice חי · alias ApiDevice לייצוא (export * כבר מ-types)
שירות: Map serviceList, מפתח קצר — לא device.getService
process*: (x, DiscoveryDetailLevel, AbortSignal?) — לא options object
אריזה-C: tzlev-2 + engines node>=18 + exports CJS בלבד (אין "type":"module")
```

---

## §4 — Commits בסדר

### C1 — alias ApiDevice (approach: none)

**משתנה**: `packages/dlna-core/src/types.ts` — אחרי `ServerApiDevice`:

```ts
export type ApiDevice = ServerApiDevice;
```

`index.ts` כבר `export * from './types'` — אל תוסיף ייצוא כפול.

**Verification**:

```bash
rg -n "export type ApiDevice = ServerApiDevice" packages/dlna-core/src/types.ts
cd packages/dlna-core && bun run build
```

---

### C2 — README (approach: none)

**`README.md`**:
- כל `device.getService(...)` / `rendererDevice.getService(...)` → `device.serviceList.get(...)` עם **שם קצר** (`AVTransport` / `ContentDirectory`), לא URN מלא. אותו דבר להוראה בפרוזה (`Get the service`).
- `import type { ApiDevice }` יכול להישאר (alias) או לעבור ל-`ServerApiDevice` — שניהם כשרים אחרי C1.
- בלוק `processUpnpDevice(basicDevice, options)` / `processUpnpDeviceFromUrl(locationUrl, options)` ו-`processUpnpDeviceFromUrl(url, { detailLevel: 'full' })` → חתימה האמיתית: `(basicDevice, detailLevel, abortSignal?)` / `(locationUrl, detailLevel, abortSignal?)` עם `DiscoveryDetailLevel` (enum מיובא), לא אובייקט `{ detailLevel: 'full' }`.
- דוגמאות `ActiveDeviceManager` שמשתמשות בערך enum `'full'` **נשארות** — השער הוא האובייקט בלבד.
- שורה 1: הקישור ל-`README.he.md` **נשאר** (ייכנס ל-`files` ב-C3 / כאן).
- פסקה קצרה: early release, API may change.

**`README.he.md`**: תקן רק את חתימת `processUpnpDeviceFromUrl` (אותה טעות options). אל תשכתב `serviceList.get`.

**`package.json` `files`**: הוסף `README.he.md`.

**Verification**:

```bash
rg -n "getService" packages/dlna-core/README.md packages/dlna-core/README.he.md   # ריק
rg -n "serviceList.get" packages/dlna-core/README.md
rg -n "{ detailLevel: 'full' }" packages/dlna-core/README.md packages/dlna-core/README.he.md  # ריק — לא את ערך ה-enum `'full'` ב-ADM
python3 -c "import json; print(json.load(open('packages/dlna-core/package.json'))['files'])"
# מכיל README.he.md
```

---

### C3 — מטא-דאטה + exports (approach: none)

**משתנה**: `packages/dlna-core/package.json` בלבד.

- `repository.url` / `bugs.url` / `homepage`: `MusiCode1` → `tzlev-2` (שמור את שאר ה-URL).
- `engines`: `{ "node": ">=18" }`
- `exports` **CJS בלבד** לצד `main`/`types`. אין `"type": "module"`. בערך:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "require": "./dist/index.js",
    "default": "./dist/index.js"
  }
}
```

אל תכבה source maps כאן (D). אל תפרסם.

**Verification**:

```bash
python3 -c "import json; d=json.load(open('packages/dlna-core/package.json')); print(d['repository'], d.get('engines'), d.get('exports'), d.get('type'))"
rg -n "MusiCode1" packages/dlna-core/package.json   # ריק
cd packages/dlna-core && bun run build && bun test   # 0 fail (רגרסיה)
```

**מוטציה** (לא להשאיר): החזר `getService` ל-README.md → `rg getService README.md` מוצא. revert.

---

## §5 — DoD

| # | בדיקה | איך | אדום על base? |
|---|------|-----|:---:|
| 1 | alias `ApiDevice` | `rg` C1 | כן |
| 2 | אין `getService` ב-READMEs; יש `serviceList.get` ב-EN | `rg` C2 | כן — EN מלא getService |
| 3 | אין `{ detailLevel: 'full' }` ב-READMEs | `rg` C2 | כן |
| 4 | `README.he.md` ב-`files` | python3 | כן |
| 5 | אין MusiCode1 ב-package.json; יש engines + exports; אין `"type"` | python3 + rg | כן |
| 6 | `bun run build` + `bun test` ירוקים | cwd=dlna-core | לא — B ירוק; רגרסיה |
| 7 | מוטציה | C3 מוטציה → #2 מאדים | חייב |
| 8 | מיזוג | רק ל-`integration/run-dlna-js-publish` | — |

**ה-DoD אינו טוען:** `npm pack` / publish · source maps · מתודת `getService` · מיזוג ל-`main`.

---

## §6 — Risks

| סיכון | מיטיגציה |
|------|----------|
| הוספת `getService` «כדי שהדוקו יישאר» | נשלל ב-§2 |
| URN מלא כמפתח Map | מפתחות קצרים כמו HE |
| dual ESM ב-exports | CJS-only, אין `"type"` |
| שבירת suite | #6 רגרסיה |

---

## §7 — Escalation

עצור אם: `bun test` נשבר · רצון ל-`getService` אמיתי · dual-package · `WRONG-DISPATCH` / שלושה סבבי-כלב.

אל תשאל על: alias מול שינוי README · מיזוג ל-integration · D.

---

## §8 — Complexity

Docs + metadata +1. **Score: 2/10.** `calev` light. phase אחרי כתיבת הבריף.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | alias vs rename ב-README / getService method / D | alias כשר · דוקו בלבד · לא בריצה | ❌ |

---

## סטיות מהתכנון (אליעזר)

- …
