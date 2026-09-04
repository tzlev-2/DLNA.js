# Slice — `dlna-js-npm-publish` — בריף (D)

> **תאריך**: 2026-09-04 · **סטטוס**: מאומת (תיקון-במקום אחרי USABLE-AFTER-FIX)
> **סוג מסמך**: בריף ביצועי לסלייס — לא תוכנית טרום-בריף
> **אימות אביגיל**: **READY** (USABLE-AFTER-FIX → 2 תיקונים במקום, בלי סבב שני) · דוח: `$BDS_REPORTS/DLNA.js/dlna-js-npm-publish-avigail.md`
> **Dispatch**: סבב אביגיל אחד. אין לולאת READY.
> **Complexity**: 3/10 → `calev` light · phase אחרי כתיבת הבריף · **`depends_on`**: [`dlna-js-readme-align`]
> **Base קוד**: `integration/run-dlna-js-publish` @ `d71b769b9eb63727878e78b8309ef1f6e2911baa` (C מוזג)
> **סלייס**: `slice/dlna-js-npm-publish` — ייפתח אחרי קומיט הבריף; לא worktree שני
> **Worktree**: `/home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish`
> **מקורות**: `publish-0.1.0-plan.md` שלבים 4–5 · פקודת `dlna-js-publish-finish`
> **דוחות**: `$BDS_REPORTS/DLNA.js/` בלבד

---

## §0 — Pre-flight

אין `AGENTS.md`. `main` אינו יעד-מיזוג. אין UI. רק D1 הוא קומיט קוד; D2/D3 הן פעולות.

### תלויות

**C `dlna-js-readme-align`** — merged @ `d71b769`, כלב GO. repository/engines/exports/README כבר ב-C. D לא משכתב אותם.

### Worktree

```bash
cd /home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish
git checkout slice/dlna-js-npm-publish
```

### Reading list

**must-read**: `packages/dlna-core/tsconfig.json` · `packages/dlna-core/package.json` (`files` / `version` / `prepublishOnly`) · `tsconfig.base.json` (`sourceMap` / `declarationMap`).

**reference**: `publish-0.1.0-plan.md` שלבים 4–5.

### מקורות חיצוניים

אין ספרייה חדשה. פרסום מחשבון `musicode1` בלבד (ה-placeholder שלו). אין העברת בעלות ל-`tzlev-2`.

### עובדות שנמדדו (2026-09-04, cwd=worktree @ d71b769)

```
npm whoami → musicode1
npm view dlna.js version → 0.0.1  (placeholder; description: "coming soon")
npm view maintainers → musicode1 <musicode3@gmail.com>
package.json version → 0.1.0 · files → dist, LICENSE, README.md, README.he.md (אין src)
packages/dlna-core/tsconfig.json → "sourceMap": true
tsconfig.base.json → sourceMap + declarationMap true
dist/index.js.map → sources: ["../src/index.ts"]  (src לא ב-files ⇒ מפות שבורות ב-tarball)
winston לא ב-dependencies של dlna-core
prepublishOnly → bun run build
*.tgz ב-.gitignore
```

---

## §1 — מטרה

`dlna.js@0.1.0` ב-npm עם tarball בלי winston, בלי `src/`, בלי source maps שמצביעים לקבצים חסרים. התקנה מחוץ למונוריפו מצליחה. תג git מקומי `dlna.js@0.1.0`.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|-----|
| כיבוי `sourceMap` + `declarationMap` ב-`packages/dlna-core/tsconfig.json` | ✅ | D1 |
| `npm pack` + התקנה ב-`/tmp/dlna-js-npm-pack-test` | ✅ | D2 |
| `npm publish --dry-run` ואז `npm publish --access public` מ-`packages/dlna-core` | ✅ | D3 |
| תג `dlna.js@0.1.0` | ✅ | D3 |
| הוספת `src` ל-`files` | ❌ | נבחר כיבוי מפות, לא הכללת מקור |
| שינוי `version` / `exports` / repository / README | ❌ | כבר 0.1.0 + C |
| העברת בעלות npm / מיזוג ל-`main` / `0.1.0-rc` | ❌ | תנאי-עצירה / משתמש |

---

## §3 — Architecture

```
tsconfig של dlna-core: sourceMap=false, declarationMap=false
  → rm -rf dist (+ tsbuildinfo) ואז rebuild → dist בלי .map
  → tarball בלי הפניות ל-src חסר
pack מ-packages/dlna-core בלבד (לא שורש המונוריפו)
publish מ-musicode1; מספר 0.1.0 חד-פעמי
```

---

## §4 — Commits / פעולות בסדר

### D1 — כיבוי source maps (approach: none)

**משתנה**: `packages/dlna-core/tsconfig.json` בלבד. הוסף/שנה ב-`compilerOptions`:

```json
"sourceMap": false,
"declarationMap": false
```

אל תיגע ב-`tsconfig.base.json` (חבילות אחרות). אל תוסיף `src` ל-`files`. אל תשנה `version`.
הקובץ הוא JSONC (הערה + trailing comma) — **אל** תריץ עליו `json.load`.

`tsc` composite לא מוחק `*.map` ישנים. לפני **כל** rebuild: `rm -rf packages/dlna-core/dist packages/dlna-core/tsconfig.tsbuildinfo`.

**Verification**:

```bash
rg -n '"sourceMap"|"declarationMap"' packages/dlna-core/tsconfig.json
# שניהם false
rm -rf packages/dlna-core/dist packages/dlna-core/tsconfig.tsbuildinfo
cd packages/dlna-core && bun run build
python3 -c "import os; print([f for f in os.listdir('packages/dlna-core/dist') if f.endswith('.map')])"
# []
```

---

### D2 — pack + התקנה נקייה (בלי קומיט)

מ-`packages/dlna-core`:

```bash
rm -f dlna.js-0.1.0.tgz
npm pack
tar -tzf dlna.js-0.1.0.tgz | rg -i 'winston|^package/src/|\.map$'   # ריק
tar -tzf dlna.js-0.1.0.tgz | rg 'package/README.md|package/dist/index.js|package/README.he.md'
rm -rf /tmp/dlna-js-npm-pack-test
mkdir -p /tmp/dlna-js-npm-pack-test
cd /tmp/dlna-js-npm-pack-test
npm init -y
npm install /home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish/packages/dlna-core/dlna.js-0.1.0.tgz
node -e "const d=require('dlna.js'); if (!d.processUpnpDevice) process.exit(1); console.log('ok', Object.keys(d).filter(k=>['processUpnpDevice','processUpnpDeviceFromUrl','DiscoveryDetailLevel'].includes(k)))"
```

התיקייה חייבת להיות **מחוץ** למונוריפו. אם ה-tarball מכיל `.map` / `src/` / winston — אל תמשיך ל-D3.

---

### D3 — dry-run + publish + תג (בלי קומיט קוד)

```bash
npm whoami    # חייב musicode1
cd packages/dlna-core
npm publish --dry-run --access public
# רק אחרי dry-run ירוק ו-D2 ירוק:
npm publish --access public
npm view dlna.js version    # 0.1.0
git tag dlna.js@0.1.0
```

**אין ניסיון שני** על `0.1.0`. אם `npm` מבקש OTP / 401 / EOTP — עצור, `notify_parent` עם השגיאה המדויקת, אל תנחש OTP. אם 403 / `whoami` ≠ `musicode1` — עצור (תנאי-עצירה).

`git push` של התג ל-origin מותר **רק** את התג (`git push origin dlna.js@0.1.0`), לא את הענף ל-`main`. כשל push-תג אינו מבטל publish שהצליח — תעד.

אל תשנה בעלות. אל תמזג.

**מוטציה** (אחרי D1, לפני publish; לא להשאיר): `sourceMap: true` ב-tsconfig של dlna-core → `rm -rf dist` (+ tsbuildinfo) → `bun run build` → `npm pack` → `tar -tzf … | rg '\.map$'` מוצא. revert → שוב `rm -rf dist` (+ tsbuildinfo) → rebuild. עץ נקי, בלי `*.map`.

---

## §5 — DoD

| # | בדיקה | איך | אדום על base? |
|---|------|-----|:---:|
| 1 | maps כבויים ב-tsconfig של dlna-core | `rg` (לא `json.load` — JSONC) | כן — sourceMap true |
| 2 | `dist` בלי `*.map` אחרי `rm -rf dist` + build | python3 | כן — maps קיימים |
| 3 | tarball בלי winston / `src/` / `.map`; יש README + dist | `tar -tzf` | כן — maps ב-dist |
| 4 | `require('dlna.js')` מחוץ למונוריפו | `/tmp/dlna-js-npm-pack-test` | לא נמדד |
| 5 | `npm whoami` = musicode1; dry-run ירוק | npm | whoami ירוק; dry-run לא רץ |
| 6 | `npm view dlna.js version` = `0.1.0` | npm | כן — 0.0.1 |
| 7 | תג `dlna.js@0.1.0` | `git tag -l` | כן |
| 8 | מוטציה maps | D3 מוטציה → #3 מאדים | חייב |
| 9 | מיזוג | רק ל-`integration/run-dlna-js-publish` | — |

**ה-DoD אינו טוען:** מיזוג ל-`main` · `npm owner` · dual ESM · `0.1.0-rc`.

---

## §6 — Risks

| סיכון | מיטיגציה |
|------|----------|
| publish כפול / גרסה שרופה | dry-run קודם; אין retry על 0.1.0 |
| 403 מחשבון אחר | whoami=musicode1; עצירה |
| tarball עם מפות שבורות | D1 מכבה maps + `rm -rf dist`; D2 בודק `tar` |
| hoisting מונוריפו | התקנה ב-`/tmp` |
| OTP | עצירה + notify; לא לנחש |

---

## §7 — Escalation

עצור אם: `whoami` ≠ musicode1 · 403 · OTP/401 · tarball עם winston/`src`/`.map` אחרי D1 · `WRONG-DISPATCH`.

אל תשאל על: כיבוי maps מול הכללת `src` · מיזוג ל-integration · העברת בעלות.

---

## §8 — Complexity

פעולת-פרסום חד-פעמית + tsconfig. **Score: 3/10.** `calev` light. phase אחרי כתיבת הבריף.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | maps מול `src` ב-files / rc / owner tzlev | כיבוי maps · 0.1.0 ישיר · musicode1 | ❌ |

---

## סטיות מהתכנון (אליעזר)

- …
