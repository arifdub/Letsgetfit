# Project status

| Phase | Scope | Status |
|---|---|---|
| 1 | Calculator and local tracking (static) | **Complete**: implemented and tested. Not yet deployed. |
| 2 | Food diary and nutrient data (manual diary, PHP FoodData Central adapter, Open Food Facts evaluation) | Not started. Next. |
| 3 | Workouts library, routines and progress trends | Not started |
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
- Deploy to cPanel by following `docs/DEPLOY-CPANEL.md`, then run its verification checklist on the live site.
- Run a screen reader pass (VoiceOver on iOS, TalkBack on Android). The automated checks do not cover this.

## Phase 2 plan (summary)

1. Manual food diary first, all in the browser: date picker; breakfast, lunch, dinner and snacks; custom foods with per-100 g nutrients; servings in grams; edit and delete; daily totals. Missing nutrients show as "unknown", and totals are flagged as incomplete. Storage moves to schema v2 with a migration that keeps v1 logs readable.
2. Diary entries store `source`, `sourceId`, per-100 g nutrients with explicit units, `servingG` and a nutrient snapshot.
3. A PHP 8.3 adapter for USDA FoodData Central (`public/api/foods.php` as a thin entry point, with logic in `src/`). The API key stays in the private config. It adds timeouts, per-IP rate limits and a file cache outside the web root. Manual entry still works when the API is down.
4. An Open Food Facts evaluation (ODbL licence and attribution, data completeness for Irish and EU products) written up before adoption. Barcode lookup only after product data works.
5. Primary navigation gains **Food** only when the diary works.

**Decision needed before step 3:** confirm the host's PHP version and that outbound HTTPS is allowed, and get a FoodData Central API key. Steps 1–2 do not need these.
