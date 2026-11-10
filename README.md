# LetsGetFit

A mobile-first fitness and nutrition web app for **letsgetfit.site**. It helps adults understand their daily energy needs, see a balanced maintenance-day example, and keep simple workout and weight logs. Food tracking, exercise routines, optional accounts and AI meal scanning follow in later phases.

All figures are presented as estimates. The app does not give medical advice or promise any outcome.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Calculator and local tracking: static, no backend | ✅ Complete, live |
| 2 | Food diary and nutrient data (PHP food search) | ✅ Complete, live |
| 3 | Exercise library, routines, progress trends | ✅ Complete, live |
| 4 | Optional accounts, sync, user and admin panels | ✅ Built and tested · switched off until the database and email secrets are added |
| 5 | Goals and AI meal scan (OpenAI or Claude) | ✅ Goals live · scan built, switched off until an OpenAI or Anthropic key is added |

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

## What Phase 3 adds

- **Workouts:**
  - an **exercise library** of 31 exercises, each with form cues, equipment, difficulty and substitutions;
  - five **starter routines** (Home starter, Home with dumbbells, Gym full body A and B, Core in 15 minutes);
  - a **session logger** for sets, reps and load (kg or lb), timed holds and cardio minutes, with an overall effort rating (1–10). The logger offers swaps and a safety note. A session in progress survives a page reload.
- **History:** each session shows sets, volume and effort, with an expandable list of exercises.
- **This week:** workouts, active minutes and strength days, next to the WHO adult guideline for comparison.
- **Progress:**
  - a **weight trend** chart with daily readings and a 7-day average, including a tooltip, keyboard reading and a table view;
  - a trend change that appears only once there are at least 4 readings over 3 weeks;
  - a **weekly summary** table for the last 8 weeks.
- **Export:** CSV downloads for workouts, sets, weights and the food diary, alongside the JSON copy.

Calorie estimates for sessions stay optional, labelled and separate from daily energy.

## What Phase 4 adds (switched off in production)

- **Optional accounts (Account tab):**
  - join or log in with a 6-digit code sent by email; new accounts give explicit consent for health data first;
  - add a password (6+ characters) or a 6-digit PIN later to skip the code; change or remove it; log out everywhere.
- **Admin panel (`#admin`):** the `ADMIN_EMAIL` account becomes admin. Set up the database with a one-time token, manage API keys (stored encrypted), pause scanning or sign-ups, manage members (disable, admin, delete), send a test email, and read the activity log. Admins never see members' health records.
- **Sync, opt-in for each device:**
  - a preview shows what will be copied each way;
  - likely duplicates are skipped, the newer change wins, and deletions sync.
- **Account controls:** download all account data, and delete the account with your password.
- **Security:**
  - Argon2id password hashes, hashed single-use login codes, and hardened session cookies;
  - CSRF and origin checks, rate limits, and no way to tell whether an email has an account;
  - every record is scoped to the logged-in user.
- **Operations:** MySQL or MariaDB migrations, run from the admin page or by hand, plus a cleanup script. **How to enter the database and email details**, backup and restore are in [docs/DATABASE.md](docs/DATABASE.md); privacy and the launch checklist are in [docs/PRIVACY.md](docs/PRIVACY.md).

## What Phase 5 adds

- **Goals** (Overview):
  - a healthy weight range for your height (BMI 18.5–24.9), shown as a range rather than one "ideal" weight;
  - maintenance energy, and the allowed daily energy for losing, maintaining or gaining weight, with the difference, a macro split and an estimated date.
  - **Safeguards:** no target below or above the healthy range; at most 1% of body weight and 1 kg a week; never below 1,200 or 1,500 kcal; adults only, not during pregnancy; and a link to Bodywhys (Irish eating-disorder support).
- **AI meal scan** (Food → Scan photo, once an OpenAI or Anthropic key is set):
  - take or choose a photo, read where it goes, then confirm;
  - OpenAI or Claude (chosen in the admin panel, or alternating to compare them) suggests foods and portion ranges, and each is matched to USDA FoodData Central;
  - the admin panel compares the two on real scans: cost per scan, speed, success rate, and how many suggestions people kept;
  - you correct matches and grams and add hidden items such as oil;
  - nutrients are calculated from the database, and nothing is saved until you confirm.
  - **Privacy and cost:** photos are stripped of metadata and not stored, with consent checked on the server, per-visitor and daily limits, and repeat-submission protection.

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
npm run test:api           # PHP API: mock FoodData Central, and accounts on MariaDB (php -S)
npm run test:e2e:accounts  # account browser tests (php -S + MariaDB); skipped without a database
npm run test:deploy        # scripts/deploy.sh against temporary directories
npx playwright install chromium   # once, if Chromium is not already installed
npm run test:e2e           # browser smoke tests: forms, persistence, keyboard, mobile layout
npm test                   # all of the above
```

GitHub Actions runs all of these on every push and pull request (`.github/workflows/ci.yml`). It also uploads a `letsgetfit-public-<sha>.tar.gz` artifact for manual upload. The FTP deploy tests run against a local FTPS server. They need `lftp` and Python with `pyftpdlib` and `pyOpenSSL`, and are skipped locally if those are missing.

## Project structure

```
public/            Web root: deployable files and thin PHP entry points (api/)
server/            PHP code for the API, deployed OUTSIDE the web root (src/, migrations/, bin/, composer.json)
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
| OpenAI API (vision) | 5 (off) | Meal photo suggestions. Secret `OPENAI_API_KEY`; tests use `tests/php/mock-openai.php`. |
| Anthropic Claude API (vision) | 5 (off) | Meal photo suggestions, instead of or alongside OpenAI. Secret `ANTHROPIC_API_KEY`, variables `ANTHROPIC_MODEL`, `SCAN_PROVIDER`; official PHP SDK (`anthropic-ai/sdk`); tests use `tests/php/mock-anthropic.php`. |
| Open Food Facts | Evaluated, not adopted | Irish and EU branded products and barcodes (see docs/FOOD-DATA.md) |
| MySQL / MariaDB | 4 (off) | Accounts and sync. Tests use a throwaway database (`LGF_TEST_DB_*` variables); CI uses a MariaDB service. |
| SMTP / email provider | 4 (off) | Login code emails. Development and tests use a private outbox (`mail_transport: outbox`). |
| AI vision provider | 5 | Meal photo suggestions |

## Sources and limits

Formulas, reference values and their sources are in [docs/FORMULAS.md](docs/FORMULAS.md). Data handling is in [docs/PRIVACY.md](docs/PRIVACY.md).
