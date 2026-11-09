# Project status

| Phase | Scope | Status |
|---|---|---|
| 1 | Calculator and local tracking (static) | **Complete**: implemented and tested. Automatic FTPS deploy to cPanel is configured; the first live deploy depends on the server setup in docs/DEPLOY-CPANEL.md. |
| 2 | Food diary and nutrient data (manual diary, PHP FoodData Central adapter, Open Food Facts evaluation) | **Complete**: implemented and tested; deployed by the FTPS workflow. Barcode lookup is deferred (see docs/FOOD-DATA.md). |
| 3 | Workouts library, routines and progress trends | **Complete**: implemented and tested; deployed by the FTPS workflow. |
| 4 | Optional accounts and cloud sync | Not started. Next. |
| 5 | AI meal scan | Not started |

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

## Phase 4 plan (summary)

Optional accounts (anonymous use stays), with these pieces:

- email verification and password reset;
- secure session cookies, CSRF protection and rate limits;
- server-side ownership checks on every record, with a test that two users cannot read each other's data;
- opt-in migration of local logs, with a preview and duplicate protection (records already have stable UUIDs);
- account export and deletion;
- MySQL migrations, with backup and restore procedures.

**Before any health data is stored server-side:** complete the data inventory, retention rules, processor list, privacy policy and EU privacy review.

**Decisions needed from you before Phase 4:**
- Database details from the host (MySQL or MariaDB version, and whether you can create a dedicated user).
- An SMTP provider for verification and reset emails.
- Who will carry out the EU privacy review.
