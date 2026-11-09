# LetsGetFit

A mobile-first fitness and nutrition web app for **letsgetfit.site**. It helps adults understand their daily energy needs, see a balanced maintenance-day example, and keep simple workout and weight logs. Food tracking, exercise routines, optional accounts and AI meal scanning follow in later phases.

All figures are presented as estimates. The app does not give medical advice or promise any outcome.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Calculator and local tracking: static, no backend | ✅ Complete (not yet deployed) |
| 2 | Food diary and nutrient data (PHP food search) | Next |
| 3 | Exercise library, routines, progress trends | Planned |
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

## Run it locally

Requirements: Node.js 20 or newer (only for the local server and tests; the app itself has no build step).

```bash
npm ci                     # installs Playwright for the browser tests
npm run serve              # http://127.0.0.1:8080/
```

Any static web server also works: `python3 -m http.server -d public 8080`.

## Tests

```bash
npm run test:unit          # formulas, conversions, validation, storage (node:test)
npm run check:static       # public/ is a complete, safe static release
npm run test:deploy        # scripts/deploy.sh against temporary directories
npx playwright install chromium   # once, if Chromium is not already installed
npm run test:e2e           # browser smoke tests: forms, persistence, keyboard, mobile layout
npm test                   # all of the above
```

GitHub Actions runs all of these on every push and pull request (`.github/workflows/ci.yml`). It also uploads a `letsgetfit-public-<sha>.tar.gz` artifact for manual upload. The FTP deploy tests run against a local FTPS server. They need `lftp` and Python with `pyftpdlib` and `pyOpenSSL`, and are skipped locally if those are missing.

## Project structure

```
public/            Web root: the only folder that gets deployed
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

Phase 1 uses none. Later phases will document each service here, together with how to run without production credentials (mocks and development fixtures):

| Service | Phase | Needed for |
|---|---|---|
| USDA FoodData Central API | 2 | Food search |
| Open Food Facts (under evaluation) | 2 | Irish and EU branded products and barcodes |
| SMTP / email provider | 4 | Account verification and password reset |
| AI vision provider | 5 | Meal photo suggestions |

## Sources and limits

Formulas, reference values and their sources are in [docs/FORMULAS.md](docs/FORMULAS.md). Data handling is in [docs/PRIVACY.md](docs/PRIVACY.md).
