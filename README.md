# LetsGetFit

A mobile-first fitness and nutrition web app for **letsgetfit.site**. It helps adults understand their daily energy needs, see a balanced maintenance-day example, and keep simple workout and weight logs. Food tracking, exercise routines, optional accounts and AI meal scanning follow in later phases.

All figures are presented as estimates. The app does not give medical advice or promise any outcome.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Calculator and local tracking: static, no backend | ✅ Complete, live |
| 2 | Food diary and nutrient data (PHP food search) | ✅ Complete |
| 3 | Exercise library, routines, progress trends | Next |
| 4 | Optional accounts and sync | Planned |
| 5 | AI meal scan | Planned |

Details and acceptance checks: [docs/STATUS.md](docs/STATUS.md).

## What Phase 1 does

- **Overview:** an onboarding form for age, height, weight, equation coefficient, usual activity, and pregnancy or breastfeeding. Each field explains why it is needed. Units are metric by default, with feet/inches and stone/pounds available.
- **Resting energy** (Mifflin–St Jeor, often called BMR), **maintenance energy** (resting energy × documented activity level), and **BMI** with the CDC adult screening category and its limits.
- Only adults aged 20–78 who are not pregnant or breastfeeding get estimates. Others see a clear explanation.
- A **maintenance-day example** in grams of protein, carbohydrate, fat and fibre, with balanced food examples from the Healthy Ireland food pyramid.
- **Workouts:** log the activity type, duration and notes, with an optional MET-based active-calorie estimate that is never added to maintenance. Edit and delete entries.
- **Progress:** a dated weight log with edit and delete.
- **Settings:** units, an explanation of what stays on the device, JSON export, and clear all data.

Everything is stored in the browser's `localStorage`. Nothing is sent to a server.

## What Phase 2 adds

- **Food:** a diary by date with breakfast, lunch, dinner and snacks; amounts in grams; edit and delete; and daily totals. Totals cover energy, protein, carbohydrate, fat, fibre, iron, calcium, potassium, vitamin D and B12.
- **Unknown, not zero:** missing nutrient values show as *unknown*, and totals that include unknowns are flagged as incomplete.
- **Adding foods:**
  - search USDA FoodData Central through a PHP endpoint, with the key kept server-side, timeouts, rate limits and a cache;
  - pick from **My foods**;
  - create your own food from a label (per 100 g, raw or cooked, generic or branded).
- **Reliable records:** every diary entry stores the source, source ID, per-100 g values with units, grams and a nutrient snapshot, so old entries never change. Duplicates are detected.
- **Manual entry always works,** including on a static server or when search fails.
- Details: [docs/FOOD-DATA.md](docs/FOOD-DATA.md), including the Open Food Facts evaluation.

## Run it locally

Requirements: Node.js 20 or newer (only for the local server and tests; the app itself has no build step).

```bash
npm ci                     # installs Playwright for the browser tests
npm run serve              # http://127.0.0.1:8080/
```

Any static web server also works: `python3 -m http.server -d public 8080`. Without PHP, food search shows as unavailable and manual entry is used.

To try food search locally with PHP, point it at a private folder whose `app` folder is a link to `server/`, and add your own key:

```bash
mkdir -p /tmp/lgf-private/config && ln -s "$PWD/server" /tmp/lgf-private/app
cp config/app.example.php /tmp/lgf-private/config/app.php   # put your FDC key in it, or '' for DEMO_KEY
LETSGETFIT_PRIVATE_DIR=/tmp/lgf-private php -S 127.0.0.1:8080 -t public
```

## Tests

```bash
npm run test:unit          # formulas, conversions, validation, storage, food diary (node:test)
npm run check:static       # public/ is a complete, safe static release
npm run test:php           # PHP lint + unit tests (needs PHP 8.3+ with curl, mbstring)
npm run test:api           # PHP API against a mock FoodData Central (php -S)
npm run test:deploy        # scripts/deploy.sh against temporary directories
npx playwright install chromium   # once, if Chromium is not already installed
npm run test:e2e           # browser smoke tests: forms, persistence, keyboard, mobile layout
npm test                   # all of the above
```

GitHub Actions runs all of these on every push and pull request (`.github/workflows/ci.yml`). It also uploads a `letsgetfit-public-<sha>.tar.gz` artifact for manual upload. The FTP deploy tests run against a local FTPS server. They need `lftp` and Python with `pyftpdlib` and `pyOpenSSL`, and are skipped locally if those are missing.

## Project structure

```
public/            Web root: deployable files and thin PHP entry points (api/)
server/            PHP code for the API, deployed OUTSIDE the web root
  assets/js/lib/       Pure calculation and validation logic (unit-tested)
  assets/js/storage/   Versioned browser storage
  assets/js/ui/        Views and DOM helpers
scripts/           Local server, static check, deploy scripts (FTPS and cPanel Git)
tests/             unit/, deploy/, e2e/
config/            Example server-local settings (placeholders only)
docs/              Deployment, formulas, architecture, status, privacy
.cpanel.yml        cPanel Git Version Control deployment tasks
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deployment

See **[docs/DEPLOY-CPANEL.md](docs/DEPLOY-CPANEL.md)**.

- **Active:** every push to `main` that passes CI is uploaded to cPanel over FTPS by `.github/workflows/deploy.yml`. It uses the repository secrets `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` and `FTP_DIR`. It can also be run by hand from the Actions tab, to redeploy, roll back to an older commit, or do a dry run.
- **One-time server step:** create an empty `.letsgetfit-docroot` file in the letsgetfit.site document root. Deploys refuse to run without it.
- **Alternative:** cPanel Git Version Control with `.cpanel.yml`.

## External services

Each service, and how to run without production credentials:

| Service | Phase | Needed for |
|---|---|---|
| USDA FoodData Central API | 2 (live) | Food search. Optional `FDC_API_KEY` secret; without it the public DEMO_KEY is used. Tests use a mock server and fixtures. |
| Open Food Facts | Evaluated, not adopted | Irish and EU branded products and barcodes (see docs/FOOD-DATA.md) |
| SMTP / email provider | 4 | Account verification and password reset |
| AI vision provider | 5 | Meal photo suggestions |

## Sources and limits

Formulas, reference values and their sources are in [docs/FORMULAS.md](docs/FORMULAS.md). Data handling is in [docs/PRIVACY.md](docs/PRIVACY.md).
