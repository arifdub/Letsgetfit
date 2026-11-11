# Architecture and decisions

## Principles

- **Phased releases.** Each phase works on its own. Later phases build on the same data model.
- **Separation of concerns.** Calculation logic (`lib/`), storage (`storage/`) and UI (`ui/`) are separate. External API adapters (from Phase 2) go in their own PHP classes. The `lib/` modules have no DOM access and are unit-tested in Node.
- **Shared-hosting friendly.** No build step, no Node on the server, and nothing a typical cPanel host cannot run.
- **Anonymous use always works.** Accounts (Phase 4) will be optional.

## Layout

```
public/                 Web root contents — the only folder deployed
  index.html            Single page; views are shown and hidden by hash route
  404.html, robots.txt, favicon.svg, .htaccess
  assets/css/app.css
  assets/js/
    app.js              Entry point and router
    lib/                Pure logic: units, energy, bmi, nutrition, activities, validate, dates
    storage/store.js    Versioned localStorage with migrations
    ui/                 DOM: overview, logs (workouts + weight), settings, methods, dom helpers
scripts/                serve.mjs (local server), check-static.mjs, deploy-ftp.sh (GitHub Actions FTPS), deploy.sh (cPanel Git)
tests/unit|deploy|e2e   Node test runner and Playwright smoke tests
config/                 Example server-local settings (placeholders only)
docs/                   This file, formulas, deployment, status, privacy
.cpanel.yml             cPanel deployment tasks
```

Server side (Phase 2) keeps the web root minimal:

```
public/api/*.php        Thin JSON entry points (foods.php, health.php) + bootstrap.inc.php
server/                 PHP 8.3 code, deployed OUTSIDE the web root as letsgetfit-private/app
  src/Config.php            settings from letsgetfit-private/config/app.php
  src/FoodDataCentral.php   USDA adapter + normalisation
  src/Nutrients.php         canonical nutrients, FDC mapping, unit conversion
  src/FoodSearchController.php, RateLimiter.php, FileCache.php, Api.php, Http/*
config/app.example.php  Template with placeholders; the deploy writes the real file from secrets
tests/php, tests/api    PHP unit tests (no Composer) and php -S integration tests with a mock FDC
server/migrations/      SQL migrations (Phase 4), applied by hand with server/bin/migrate.php or phpMyAdmin
server/src/Accounts, Auth, Db, Mail   accounts, sessions/CSRF, tokens, PDO, PHPMailer/outbox
server/composer.json    PHPMailer; vendor/ is built in CI and uploaded (Composer not needed on the host)
public/api/account.php  thin entry point for accounts and sync
public/api/admin.php    thin entry point for the admin panel (server/src/Admin, Settings)
```

No Composer dependencies are needed yet. Everything uses PHP's standard library and the curl extension, so nothing has to be installed on the host.

## Decisions

| Decision | Reason |
|---|---|
| Plain HTML, CSS and ES modules, no framework or bundler | Runs on any static host, has no build step to break on cPanel, keeps the code small, and makes testing simple. |
| Hash routing (`#overview`, `#workouts`, …) | Works on a static server without rewrite rules, and the back button works. |
| One localStorage key, `letsgetfit.data`, with `schemaVersion` | Easy to export or clear. Migrations upgrade old data on load and never discard it. Data from a newer version opens read-only. Unreadable data is backed up to a separate key. |
| Records: random UUID `id`, local `localDate` (YYYY-MM-DD), UTC `createdAt`/`updatedAt` | Stable IDs let Phase 4 merge data from devices without duplicates. The local date keeps entries on the day the user meant. |
| Metric storage (cm, kg, kcal), imperial converted once on entry | One canonical form avoids rounding drift and keeps later server storage simple. |
| Workout entries save `metUsed`, `weightKgUsed` and `estimatedActiveKcal` | Old entries do not change when the MET table or the user's weight changes. Phase 2 diary entries will snapshot nutrients the same way. |
| Food diary entries snapshot per-100 g values, units and scaled nutrients | Logged days never change when a source or library food changes; unknown values stay `null`, not zero. See `docs/FOOD-DATA.md`. |
| Food search proxied through PHP, never called from the browser | The API key stays on the server; caching and rate limits protect the key's quota; the Content Security Policy can stay `connect-src 'self'`. |
| Sessions live in `workouts` with `type: 'session'` (schema v3); Phase 1 entries become `type: 'activity'` | One history, one weekly summary and one export. Migration is additive. |
| Session in progress saved as `draftSession` without notifying views | Typing a set never triggers re-renders, and a reload or closed tab does not lose a workout. |
| Exercise content and routines are static modules (`lib/exercises.js`) | Reviewable in one place, tested for integrity, and no server needed. |
| Chart colours: series 1 blue (#2a78d6 light, #3987e5 dark) for the 7-day line and series 2 orange (#eb6834, #d95926) for readings | Validated with the dataviz palette checker on both app surfaces (lightness, chroma, colour-blind separation, contrast). Line and dot shapes add a second cue beyond colour. A table view is always available. |
| CSV with a formula-injection guard | Exports open safely in spreadsheet apps. |
| Accounts optional, shipped OFF | Health data is never collected server-side until the privacy launch checklist is signed off. A disabled feature answers `{"enabled":false}` and the UI hides it. |
| Sync = per-record last-write-wins with tombstones; opt-in per device with a preview | Stable UUIDs from Phase 1 make merging safe. Content keys catch the same entry saved on two devices. Logging out unlinks the device, so one person's data can never sync into another's account. |
| Composite pull cursor (server time, collection, ID) | Paging never skips records written in the same millisecond. |
| PHP sessions (files in private storage) + `session_version` | No extra infrastructure on shared hosting. Password changes and "log out everywhere" end other sessions. |
| Email codes first, password optional | Nothing to remember to join; a forgotten password is replaced after a code login. Codes are HMAC-hashed, short-lived and guess-limited. |
| Roles in the database, admin from `ADMIN_EMAIL` | No admin password in config. The role is re-read on every admin request. |
| Admin settings in the database, keys encrypted with libsodium | Keys can be changed without a redeploy; a database dump alone does not reveal them. Admin values override the GitHub secrets; clearing them falls back. |
| Database setup from `#admin` with a one-time token | Shared hosting often has no SSH. Only pending migrations run, once each. |
| Settings written with `var_export` by `scripts/write-config.php` | Secrets with quotes cannot break or inject into the PHP settings file. |
| Goals stored on the profile (`profile.goal`), with the plan computed in `lib/goals.js` | Synced with the profile; no schema change. Safeguards are enforced in validation, not just the UI. |
| AI only suggests foods and grams; nutrients always come from the database | A photo cannot measure nutrients. Database values carry units and unknowns, and diary snapshots stay consistent. |
| Scan: browser and server both re-encode the photo; in memory only; idempotency key + lock | Metadata removed twice, nothing stored, and a double tap or retry never charges twice. |
| Two vision providers behind one `VisionProvider` interface: OpenAI (Chat Completions, strict JSON schema, raw HTTP) and Claude (official Anthropic PHP SDK, structured outputs, adaptive thinking, server-side fallbacks) | Same prompt, schema and sanitising for both, so they can be swapped or compared on real scans. "Alternate" picks one at random per scan. Only counts are kept for the comparison. |
| OpenAI Chat Completions with a strict JSON schema, behind an adapter | Predictable, validated output. The provider can be swapped by replacing `server/src/Scan/OpenAiVision.php`. |
| Progressive web app: manifest + a network-first service worker | Installable, opens offline, and never serves stale code when online. The server API is never cached. |
| Web Push with VAPID through `minishlink/web-push`; subscriptions in the database; scheduler by GitHub Actions (or cron) | Works on shared hosting with no background process. VAPID keys are generated on first use and kept in private storage. Reminders are due once a day within two hours of their local time, so late runs never send at night. |
| Composer packages loaded lazily | Food search and the health check never load them, so a package problem cannot take the API down. |
| Units preference kept apart from the profile | Changing display units never changes stored values. |
| Logged workouts are not added to maintenance | The activity level already includes usual exercise. Adding workouts again would double-count. |
| Maintenance only; no loss or gain targets | Targets need separately reviewed eligibility rules and safeguards (see `docs/STATUS.md`). |
| Strict Content Security Policy, no inline scripts or styles | Limits damage from any injection. `scripts/check-static.mjs` enforces it. |
| User text written with `textContent` only | Notes cannot inject HTML. |
| Deploy copies `public/` only, never deletes, needs a marker file | See `docs/DEPLOY-CPANEL.md`. Protects host-managed files and avoids deploying to the wrong folder. |
| FTPS deploy with `lftp` in a repo script, not a third-party Action | The FTP password is only handed to tools we control and test. TLS is required and the certificate is verified by default. Only commits that passed CI are deployed. |
| Irish English, `lang="en-IE"`, `Intl` formatting with `en-IE` | Matches the audience. Dates show as "Mon 9 Nov 2026". |
| System font stack, no web fonts | Fast, private (no third-party requests) and fits the CSP. |

## Accessibility

- A skip link, one `h1` per view, and focus moved to the view heading on navigation.
- Every input has a label and hint linked with `aria-describedby`. Errors appear inline and in a focused summary with links to each field. Invalid fields get `aria-invalid`.
- Confirmations use the native `<dialog>`. It traps focus and returns it to the button that opened it.
- Visible `:focus-visible` outline, 44 px minimum touch targets, and light and dark themes with strong contrast.
- `prefers-reduced-motion` turns off animation and transitions. `forced-colors` mode is supported.

## Guided workout player

`lib/rig.js` (pose maths), `lib/demos.js` (one demonstration per exercise ID) and `lib/workout-player.js` (segments, clock, summary) are pure and unit tested. `ui/figure.js` draws a demonstration as SVG using attributes and classes only, or shows a frame of a picture sheet where a demo has one. `ui/player.js` is the full-screen `<dialog id="workout-player">`; everything on screen is derived from the session's elapsed time, so pausing stops the timer, counter, ring and animation together.
