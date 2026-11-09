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
scripts/                serve.mjs (local server), check-static.mjs, deploy.sh (cPanel)
tests/unit|deploy|e2e   Node test runner and Playwright smoke tests
config/                 Example server-local settings (placeholders only)
docs/                   This file, formulas, deployment, status, privacy
.cpanel.yml             cPanel deployment tasks
```

Planned server additions keep the web root minimal:

```
public/api/*.php        Thin JSON entry points only (Phase 2+)
src/                    PHP application code, outside the web root (Phase 2+)
migrations/             SQL migrations, outside the web root (Phase 4)
config/*.example.php    Templates; real config lives in ~/.config/letsgetfit/ on the server
```

## Decisions

| Decision | Reason |
|---|---|
| Plain HTML, CSS and ES modules, no framework or bundler | Runs on any static host, has no build step to break on cPanel, keeps the code small, and makes testing simple. |
| Hash routing (`#overview`, `#workouts`, …) | Works on a static server without rewrite rules, and the back button works. |
| One localStorage key, `letsgetfit.data`, with `schemaVersion` | Easy to export or clear. Migrations upgrade old data on load and never discard it. Data from a newer version opens read-only. Unreadable data is backed up to a separate key. |
| Records: random UUID `id`, local `localDate` (YYYY-MM-DD), UTC `createdAt`/`updatedAt` | Stable IDs let Phase 4 merge data from devices without duplicates. The local date keeps entries on the day the user meant. |
| Metric storage (cm, kg, kcal), imperial converted once on entry | One canonical form avoids rounding drift and keeps later server storage simple. |
| Workout entries save `metUsed`, `weightKgUsed` and `estimatedActiveKcal` | Old entries do not change when the MET table or the user's weight changes. Phase 2 diary entries will snapshot nutrients the same way. |
| Units preference kept apart from the profile | Changing display units never changes stored values. |
| Logged workouts are not added to maintenance | The activity level already includes usual exercise. Adding workouts again would double-count. |
| Maintenance only; no loss or gain targets | Targets need separately reviewed eligibility rules and safeguards (see `docs/STATUS.md`). |
| Strict Content Security Policy, no inline scripts or styles | Limits damage from any injection. `scripts/check-static.mjs` enforces it. |
| User text written with `textContent` only | Notes cannot inject HTML. |
| Deploy copies `public/` only, never deletes, needs a marker file | See `docs/DEPLOY-CPANEL.md`. Protects host-managed files and avoids deploying to the wrong folder. |
| Irish English, `lang="en-IE"`, `Intl` formatting with `en-IE` | Matches the audience. Dates show as "Mon 9 Nov 2026". |
| System font stack, no web fonts | Fast, private (no third-party requests) and fits the CSP. |

## Accessibility

- A skip link, one `h1` per view, and focus moved to the view heading on navigation.
- Every input has a label and hint linked with `aria-describedby`. Errors appear inline and in a focused summary with links to each field. Invalid fields get `aria-invalid`.
- Confirmations use the native `<dialog>`. It traps focus and returns it to the button that opened it.
- Visible `:focus-visible` outline, 44 px minimum touch targets, and light and dark themes with strong contrast.
- `prefers-reduced-motion` turns off animation and transitions. `forced-colors` mode is supported.
