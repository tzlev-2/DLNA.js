# פקודת-משימה — `dlna-js-publish-finish` (A2→D עד סיום)

> **תאריך**: 2026-09-04 · **כותב**: autorun (Cursor) · **צרכן**: מרדכי (planner)
> **סטטוס**: ✅ נעולה
> **Base (DLNA.js)**: `integration/run-dlna-js-publish` @ **`90d0b5f`**
> **ענף-ההרצה**: `integration/run-dlna-js-publish` (קיים — להמשיך עליו)
> **Worktree**: `/home/user/Projects/DLNA.js/.worktrees/run-dlna-js-publish`
>
> **סוג מסמך**: פקודת-משימה — הרובד מעל הבריף.
> **תוכנית-אב**: `docs-repo/dlna.js/publish-0.1.0-plan.md` @ `7e466d5`
> **A1**: הושלם — ריצה 39 · כלב GO · tip קוד `9eb6708` · סגירה `90d0b5f`
> **מאגר-דוחות**: `$BDS_REPORTS/DLNA.js/`
>
> **בחירת-תור**: המשתמש — «רוץ autorun עד לסיום»

---

## §1 — המטרה, במונחי חוויה

בסוף הריצה: `dlna.js@0.1.0` **אמיתי** ב-npm (לא placeholder), עם ליבה שקטה, לוגר באפליקציה, build+test ירוקים ב-`dlna-core`, README תואם API, אריזה תקינה. השרת במונוריפו ממשיך ללוגג דרך Winston מקומי.

---

## §2 — גבולות ה-scope

| | בפנים | בחוץ |
|---|---|---|
| סלייסים | **A2 → B → C → D** ברצף עד סיום | מיזוג ל-`main` · שינוי בעלות npm ל-tzlev-2 |
| קוד | לפי התוכנית לכל סלייס | WebOS UI / proxy / mqtt |

### 🔴 משפחת-סלייסים — **המשך מאושר עד D**

המשתמש אישר במפורש «עד לסיום». אחרי כל סלייס: מיזוג ל-ענף-ההרצה + נקודת-סטטוס (tg) + דוח קצר ב-`$BDS_REPORTS/DLNA.js/` — **ואז ממשיכים** לסלייס הבא **בלי** לחכות למשתמש.

```
A2  Winston → packages/server + bootstrapLogging + מיגרציה
B   node-cache / debugger / build+test ירוקים + typescript/@types/node
C   README/API alignment + files/metadata
D   אריזה + npm publish 0.1.0 (musicode1 כבר מחובר)
```

דוח-ריצה מלא אחד בסוף (ריצה 40), לא ארבעה דוחות-ריצה נפרדים — כן דוחות אביגיל/כלב פר-סלייס.

---

## §3 — אילוצים בלתי-ניתנים למשא-ומתן

1. 🔴 מקור אמת ל-A2: נספח «עיצוב הלוגר בפועל» ב-`publish-0.1.0-plan.md` — `bootstrapLogging` לפני `./app`, העתקת winston **בלי** exceptionHandlers, `setLoggerFactory`, examples עם `setLogger(console)`.
2. 🔴 Winston הישן: לשחזר מ-`db85968:packages/dlna-core/src/logger.ts` (A1 מחק אותו מה-HEAD).
3. 🔴 **הקפאת Claude** — `cli=cursor` בלבד. מרדכי/אביגיל = Grok · אליעזר+כלב = Composer 2.5. `BDS_SLICE=<שם-הסלייס-הנוכחי>`. תמיד `noWait`.
4. ⛔ מיזוג ל-`main` — המשתמש בלבד.
5. 🔴 D: לפרסם מ-`musicode1` (placeholder שלו; `npm whoami` = musicode1). `--dry-run` לפני publish. OTP/CLI auth אם נדרש — tg למשתמש עם לינק, לא לעצור את A2–C.
6. 🔴 שערי צופה: אל תסמוך על `expect-commits 1` מעל בריף — בסיס הצופה = hash **אחרי** קומיט הבריף של אותו סלייס.

### שמות סלייסים (BDS_SLICE)

| שלב | BDS_SLICE |
|-----|-----------|
| A2 | `dlna-js-logger-server` |
| B | `dlna-js-build-green` |
| C | `dlna-js-readme-align` |
| D | `dlna-js-npm-publish` |

---

## §4 — הרשאות-מראש

כל ברירות `MISSION_TEMPLATE.md` §4 מאושרות. Cursor בלבד.

**חריגה מאושרת:** המשך משפחת-סלייסים עד D בלי אישור ביניים (ר' §2).

---

## §5 — plan-gate

סבב אביגיל **אחד לכל סלייס**. תיקון-במקום. לא לולאת READY.

---

## §6 — תנאי-עצירה (חזרה למשתמש)

1. npm publish נחסם ב-403/בעלות (לא musicode1).
2. OTP/CLI auth לפרסום — לשלוח לינק ב-tg ולהמתין; לא לבטל את A2–C.
3. NEEDS-REWORK עיצובי אחרי rewrite אחד על אותו סלייס.
4. מיזוג ל-`main` (לא בסcope).

---

## §7 — נקודות-העיניים

אין UI. מיזוג ל-`main` — משתמש. אחרי D: קישור npm ב-tg.

חוזה-קצב: tg בכל מעבר-שער + כל 30 דק' שקט.

---

## §8 — חובת-ראיה

**מאגר-דוחות:** `$BDS_REPORTS/DLNA.js/` בלבד.

### שערי A2 (אדום על base @ 90d0b5f)

| שער | אדום? |
|---|---|
| אין `packages/server/src/logger.ts` / `bootstrapLogging.ts` | ✅ אין קבצים |
| `createModuleLogger` מ-`dlna.js` ב-server בלי `setLoggerFactory` | ✅ rg מאשר |
| winston לא ב-`server/package.json` deps | ✅ jq מאשר |
| examples מייבאים `../packages/dlna-core/src/logger` | ✅ לפחות 3 קבצים |

### שערי B

| שער | אדום? |
|---|---|
| `node-cache` לא ב-`dlna-core/package.json` | ✅ (רק ב-server) |
| `debugger;` ב-`upnpDeviceProcessor.ts:332` | ✅ |
| `bun run build` / טסטי processor נופלים על node-cache | ✅ (כלב A1 תיעד) |

### שערי C

| שער | אדום? |
|---|---|
| README מזכיר `ApiDevice` / `getService` | ✅ rg |
| repository → MusiCode1 | ✅ package.json |
| אין `engines` / `exports` | ✅ |

### שערי D

| שער | איך |
|---|---|
| `npm pack` + install בתיקייה ריקה מחוץ למונוריפו | ירוק אחרי C |
| `npm view dlna.js version` = 0.1.0 עם README אמיתי | אחרי publish |

---

## §9 — סדר-ההרצה

לכל סלייס: brief → אביגיל×1 → אליעזר → כלב → מיזוג ל-integration → tg → הבא.

בסוף D: דוח-ריצה 40 ב-`brief-driven-slices/autonomous-runs/runs/`.

---

## §10 — מסירה

`kickoff-mordechai.md`. cwd = worktree. מודל Grok למרדכי.

---

## §11 — עובדות שנמדדו (2026-09-04)

### (א) Base ✅
`90d0b5f` על `integration/run-dlna-js-publish` — A1 סגור.

### (ב) server בלי winston deps ✅
`jq '.dependencies' packages/server/package.json` — אין winston/logtail.

### (ג) index.ts process handlers קיימים ✅
`index.ts:45,53` — uncaughtException / unhandledRejection עם exit(1). ⇒ אל תכפיל ב-logger של server.

### (ד) logger ישן לשיחזור ✅
`git show db85968:packages/dlna-core/src/logger.ts` → 364 שורות.

### (ה) node-cache + debugger ✅
`upnpDeviceProcessor.ts:6` import · `:332` debugger · deps רק ב-server.

### (ו) README שבור ✅
`ApiDevice` / `getService` ב-README.md (מספר שורות).

### (ז) npm ✅
`npm whoami` → `musicode1` (מתאים ל-placeholder).

### Preflight

| # | תוצאה |
|---|---|
| 1 בסיס | 90d0b5f + קוד A1 |
| 2 שערים | אדומים על base לכל A2–C; D אחרי pack |
| 3 קשת | A2→B→C→D |
| 4 DoD אינו | לא טוענים מיזוג ל-main / העברת בעלות tzlev |
| 5 דוחות | `$BDS_REPORTS/DLNA.js/` |
| 6 שיגור | MCP cursor; Grok/Composer; Claude מוקפא |

---

## DoD סופי (אחרי D)

1. `npm view dlna.js version` → `0.1.0`
2. tarball: אין winston; import שקט
3. `packages/server` מזריק לוגר ב-bootstrap
4. `bun run build` + `bun test` ירוקים ב-`dlna-core` (או מוטציית Map במקום node-cache)
5. README בלי `getService`/`ApiDevice` שבורים (או alias מיוצא)
6. הכל על `integration/run-dlna-js-publish` — לא `main`
