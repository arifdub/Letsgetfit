# Project status

| Phase | Scope | Status |
|---|---|---|
| 1 | Calculator and local tracking (static) | **Complete**: implemented and tested. Automatic FTPS deploy to cPanel is configured; the first live deploy depends on the server setup in docs/DEPLOY-CPANEL.md. |
| 2 | Food diary and nutrient data (manual diary, PHP FoodData Central adapter, Open Food Facts evaluation) | **Complete**: implemented and tested; deployed by the FTPS workflow. Barcode lookup is deferred (see docs/FOOD-DATA.md). |
| 3 | Workouts library, routines and progress trends | Not started. Next. |
| 4 | Optional accounts and cloud sync | Not started |
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

## Phase 3 plan (summary)

Exercise library and starter home and gym routines (form cues, equipment, difficulty, substitutions); set, rep, load, duration and effort logging; workout history and weekly summaries; weight trend from real entries with smoothing (no single-day conclusions); CSV and JSON export. Workout calorie estimates stay separate and labelled.
