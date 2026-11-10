# Project status

| Phase | Scope | Status |
|---|---|---|
| 1 | Calculator and local tracking (static) | **Complete**: implemented and tested. Automatic FTPS deploy to cPanel is configured; the first live deploy depends on the server setup in docs/DEPLOY-CPANEL.md. |
| 2 | Food diary and nutrient data (manual diary, PHP FoodData Central adapter, Open Food Facts evaluation) | **Complete**: implemented and tested; deployed by the FTPS workflow. Barcode lookup is deferred (see docs/FOOD-DATA.md). |
| 3 | Workouts library, routines and progress trends | **Complete**: implemented and tested; deployed by the FTPS workflow. |
| 4 | Optional accounts and cloud sync, user panel and admin panel | **Built and tested; switched OFF in production** until the database and email secrets are added and the privacy checklist is signed off (docs/PRIVACY.md §3). Sign-in is by emailed code with an optional password; `ADMIN_EMAIL` becomes the admin. |
| 5 | Goals and AI meal scan | **Goals: complete and live.** **Meal scan: built and tested; switched OFF until an `OPENAI_API_KEY` secret is set** (see docs/PRIVACY.md §4). |

## Phase 1 acceptance

| Criterion | How it is verified |
|---|---|
| Representative formula outputs | `tests/unit/energy.test.mjs` (hand-worked Mifflin–St Jeor and PAL cases). `tests/e2e/smoke.mjs` checks the on-screen values, for example 1,780 kcal resting and 3,290 kcal maintenance. |
| BMI boundaries | `tests/unit/bmi.test.mjs` covers 18.4/18.5, 24.9/25.0, 29.9/30.0, 34.9/35.0, 39.9/40.0 and one-decimal rounding. The e2e test checks that BMI 25.0 shows as overweight. |
| Invalid and missing values | `tests/unit/validate.test.mjs`. The e2e tests check the error summary, inline errors and `aria-invalid`. |
| Age eligibility | Unit tests for ages 19, 20, 78 and 79. The e2e tests check the under-20, over-78 and pregnancy messages. |
| Imperial conversions | `tests/unit/units.test.mjs` (exact factors, round trips). The e2e test checks that 5 ft 9 in and 12 st 8 lb are stored as 175.3 cm and 79.8 kg. |
| Mobile layout | The e2e test checks iPhone SE and Pixel 7 emulation for no horizontal scroll on every view and a bottom navigation bar. |
| Keyboard use | The e2e test checks the skip link, visible focus outline, navigating views with Tab and Enter, focus moving to the view heading, and tab order through the form. |
| Log persistence after reload | The e2e tests add, edit and delete workouts and weight entries, reload, and check localStorage. Clear-all is tested. Corrupted data recovers with a notice. |
| Works on a static web server | Served by `scripts/serve.mjs` (static files only) in tests. `scripts/check-static.mjs` checks every reference and import resolves without a build. |
| No double counting of workouts | The e2e test checks maintenance is unchanged after logging a workout. |
| Reduced motion | The e2e test checks animation is disabled with `prefers-reduced-motion: reduce`. |

### Open items before public launch

- Manually tick off the primary sources marked "needs manual check" in `docs/FORMULAS.md`, and review the 2024 Adult Compendium MET values.
- Create `.letsgetfit-docroot` in the document root, confirm the FTP secrets, check the first **Deploy to cPanel (FTPS)** run, then work through the verification checklist in `docs/DEPLOY-CPANEL.md` on the live site.
- Run a screen reader pass (VoiceOver on iOS, TalkBack on Android). The automated checks do not cover this.

## Phase 2 acceptance

| Criterion | How it is verified |
|---|---|
| Diary by date and meal; custom foods; grams; edit and delete; daily totals | e2e: "food: empty day, search, add…", "custom food…", "edit grams and meal…", date navigation and persistence after reload |
| Calories, macros, fibre, and iron, calcium, potassium, vitamin D, B12 with units | Unit: `tests/unit/food.test.mjs` (canonical units, scaling, totals). e2e checks potassium 161 mg for 150 g apple. |
| Missing values shown as unknown; incomplete totals flagged | Unit: "sum flags incomplete totals". e2e: "custom food with unknown values flags incomplete totals" |
| Conversions | Unit: g, mg, µg; kcal, kJ; Greek mu; IU vitamin D (PHP). PHP: `Nutrients::convert` and mapping tests |
| Source, source ID, per-100 g values, serving grams and nutrient snapshot stored | e2e checks the stored record; unit test "snapshot does not change when the library food changes"; e2e edit after library change (52 not 999 kcal) |
| FoodData Central adapter with server-side key, timeouts, rate limits and caching | PHP tests (key in header only, timeouts passed, 429 + Retry-After, global cap, cache hit, IP hashed). API integration: real `php -S` with 2 s timeout against a mock that sleeps 4 s, giving 504. |
| API failures keep manual entry available | e2e: timeout message, then "Add a food yourself" opens the form with the name filled in; broken response; search unavailable (no PHP) |
| Duplicates; raw, cooked and branded | Unit and PHP de-duplication tests; e2e duplicate custom food reuse; badges and the `100ml` basis |
| Old local logs readable after the update | Unit: v1 to v2 migration; e2e: "Phase 1 data is kept after the upgrade" |
| Open Food Facts evaluated; barcode only once product data works | `docs/FOOD-DATA.md` (evaluated, not adopted; barcode deferred) |

### Open items for Phase 2

- Add the `FDC_API_KEY` repository secret (free key). Until then, search uses the low-limit `DEMO_KEY`.
- Check the first deploy's "Server health" line, then search for a food on the live site.
- Review the Open Food Facts terms before any barcode work.

## Phase 3 acceptance

| Criterion | How it is verified |
|---|---|
| Exercise library with form cues, equipment, difficulty and substitutions | Unit: library integrity (unique IDs, every exercise has 2+ cues and resolvable substitutions, cardio maps to a MET activity). e2e: "library: filters by equipment and type, shows cues and swaps" |
| Starter home and gym routines | Unit: routines reference real exercises; home and gym options exist; Home starter needs no weights. e2e: running "Home with dumbbells" and "Gym full body A" |
| Log sets, reps, load, duration and perceived effort | Unit: session validation (metric and imperial load, time and cardio sets, empty sets dropped, errors). e2e: logging loads, a timed carry, session effort 6/10, linked error summary, edit without duplicating |
| Substitutions during a session; draft not lost | e2e: swap keeps 3 sets; draft survives reload and resumes |
| Workout history and weekly summaries | Unit: Monday-start weeks, counts, minutes, strength days, sets and volume. e2e: history details, "This week" card, weekly table |
| Weight trend from actual data, no single-day conclusions | Unit: 7-day trailing average, same-day readings averaged, change only with 4+ readings over 21+ days. e2e: a 2 kg one-day drop is not reported as change; 30-day series reports the trend change |
| Chart accessibility | e2e: legend, keyboard focus with Home and arrow keys shows the tooltip, pointer hover, table view, no horizontal scroll on a phone. Chart colours validated for both themes. |
| CSV or JSON export | Unit: RFC 4180 quoting, formula-injection guard, headers. e2e: four CSV downloads with headers; `=SUM(A1)` neutralised. JSON export from Phase 1. |
| Exercise calorie estimates separate and labelled | Unit: session estimate is optional, 3.5 MET net. e2e: "About 115 kcal active energy (estimate, not added…)" and maintenance unchanged |
| Older data readable | Unit and e2e: v1 to v3 and v2 to v3 migrations keep workouts, weights, diary and foods |

## Phase 4 acceptance

| Criterion | How it is verified |
|---|---|
| Anonymous use stays available | The Account tab only appears when the server reports accounts are enabled (e2e smoke: hidden on static or disabled). Disabled accounts answer `{"enabled":false}` with no error. |
| Join and log in by email code; optional password | API tests (`tests/api/accounts.test.mjs`, real PHP + MariaDB) cover codes (hashed, single use, 10-minute expiry, 5 wrong guesses, 5 emails an hour per address), consent before an account is created, closed sign-ups, and adding, changing and removing a password. Browser tests (`tests/e2e/accounts.mjs`) cover the full flow with emailed codes. |
| Admin panel | API and browser tests: database setup with the one-time token (wrong token refused, rate-limited), `ADMIN_EMAIL` becomes admin, members are refused (role checked on every request), encrypted and masked API keys applied straight away, disable/enable/admin/delete with self-protection, audit log without personal data, test email |
| Maintained primitives and libraries | `password_hash` with Argon2id, `random_int` codes stored as HMAC, libsodium for stored keys, PHP sessions, and PHPMailer (Composer, built in CI) for SMTP |
| Secure session cookies, CSRF, rate limits, safe recovery | Tests cover HttpOnly and SameSite=Lax cookies, a new session ID at login, CSRF/JSON/Origin checks (403 and 415), login rate limit (429 + Retry-After), and generic responses for code requests and login (no account enumeration). Password changes and "log out everywhere" log out other devices. |
| Ownership enforced on every read and write | Test "two users can never read or change each other's records": same record ID, pulls, deletions, exports, a client-supplied user ID ignored, and 401 when logged out |
| Opt-in migration with preview and duplicate protection | Unit `sync.test.mjs` (preview: upload, download, already there, conflicts, likely duplicates). Browser test: the second device skips a duplicate weight and receives the account's workout. |
| Sync including deletions | Unit (last write wins, tombstones, newer local edits kept); API (cursor paging including 300 same-millisecond records); browser (a deletion on device 2 reaches device 1) |
| Account export and deletion | API and browser tests: export JSON (no hashes); deletion needs the password (or a recent code login), removes the user and records, and leaves device data untouched |
| Migrations, backup and restore documented | `server/migrations/*.sql`, `bin/migrate.php` (tested: applies once, status, CLI only), `docs/DATABASE.md` |
| Privacy documentation before collecting health data | `docs/PRIVACY.md` (inventory, purposes, lawful bases, retention, processors, access controls, launch checklist including the EU review and DPIA) and `docs/PRIVACY-NOTICE-ACCOUNTS-DRAFT.md` |
| Private data kept out of logs and errors | Error logs record exception class only; the cleanup script prints counts only (tested); deploy never prints secrets (tested) |
| SMTP and recovery tested in staging | Automated tests use a private outbox. Real SMTP delivery is a manual staging check (`docs/DATABASE.md` §7) and is **not done yet**. |

### What is needed to switch accounts on

1. Database and user created on the host (`docs/DATABASE.md` §1), plus `DB_*` secrets.
2. A mailbox, plus `SMTP_*` and `MAIL_FROM` secrets, and SPF, DKIM and DMARC DNS records.
3. `APP_HASH_SECRET`, `ADMIN_EMAIL` and `ADMIN_SETUP_TOKEN` secrets.
4. The privacy launch checklist (`docs/PRIVACY.md` §3), with the accounts privacy notice published.
5. The `ACCOUNTS_ENABLED` variable set to `true`, a deploy, then **#admin → Set up the database**, log in as the admin, and send a test email.

## Phase 5 acceptance

| Criterion | How it is verified |
|---|---|
| Goals: healthy weight range, maintenance and allowed calories, targets with safeguards | Unit `goals.test.mjs`: range, the 7,700 kcal/kg plan and timeline, the floor and the reduced pace, rate cap at 1% of body weight, healthy-range limits, no loss goal when underweight, eligibility. Browser: loss plan, Food page reference, floor notice, gain cap. |
| Photo picker and mobile camera | `capture="environment"` input for camera, and a separate file picker. Browser re-encode (orientation, ≤1600 px, metadata dropped). |
| Explain and ask before sending | Consent panel (server, OpenAI, retention, limits). Browser test: nothing sent before consent. Server refuses uploads without `X-Scan-Consent: yes` (API test). |
| Server-side type and size checks, metadata removal, quotas, rate limits, temporary images deleted | PHP: MIME sniffing, size and pixel limits, decompression-bomb guard, GPS marker removed after re-encode. API: non-images rejected before any AI call; per-visitor and site-wide limits; no image files left in storage. |
| Credentials on the server; timeouts and cost controls | Key only in the `Authorization` header (PHP test). 5 s connect and 30 s total timeout (API timeout test). Low-detail images, an output token cap and a daily cap. |
| Model suggests foods and portion ranges, matched to the Phase 2 database | API: suggestions come with up to 3 USDA candidates, and there are no nutrient numbers in the AI output. Browser: totals use database values (120 g apple = 62 kcal). |
| Editable ingredients and grams; questions about oils and sauces; unknown nutrients | Browser: change grams, remove an item, add a missing item by search, questions shown, unknown fibre stays unknown |
| Explicit confirmation before saving; manual entry on every failure | Browser: saving blocked until every item is matched and the box is ticked. Timeout, not-food and bad-file paths all offer "Add the food yourself". |
| Mixed dishes, poor images, wrong matches, timeouts, duplicate submissions, corrections | Mock OpenAI modes (ok, slow, refuse, notfood, 500). A repeated request ID gives one AI call (API) and a double tap gives one request (browser). Match switching and corrections are in the browser tests. |
| Provider mocks in CI | `tests/php/mock-openai.php`, `tests/php/mock-fdc.php`, FakeHttp in PHP unit tests |

### Open items for Phase 5

- Add `OPENAI_API_KEY` (secret) and optionally `OPENAI_MODEL` and `SCAN_DAILY_LIMIT` (variables). Then check `aiScan: enabled` in the deploy log and test with a real photo.
- Complete the privacy items in `docs/PRIVACY.md` §4: OpenAI and Anthropic DPAs, DPIA update and transfer basis.
- Compare providers: set "Photo scan AI" to "Alternate between both" in the admin panel for a few weeks, then choose using the comparison table (cost per scan, success rate, speed, suggestions kept).
- Manually check the goal guidance values in `docs/FORMULAS.md`.
