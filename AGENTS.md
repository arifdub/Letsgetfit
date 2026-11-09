# Working on LetsGetFit

Guidance for anyone, human or AI, changing this repository.

## Workflow

- Build one phase at a time (see `docs/STATUS.md`). Each phase must work on its own and keep earlier data readable.
- Before editing, read `README.md`, `docs/STATUS.md` and `docs/ARCHITECTURE.md`, and check `git status`.
- Run `npm test` before committing. Keep commits scoped, and update `docs/STATUS.md` when a phase's state changes.
- Never commit secrets, real server paths, credentials or production config. Put examples with placeholders in `config/`.
- Pushing to `main` deploys to production. Once CI passes, `.github/workflows/deploy.yml` uploads `public/` over FTPS. Only push to `main` when it is ready to go live; use a branch and pull request otherwise.

## Code rules

- `public/` is the web root and holds deployable files only. PHP application code, migrations, fixtures and config go outside it.
- `public/assets/js/lib/` is pure logic with no DOM access, covered by unit tests. UI code lives in `ui/` and storage in `storage/`.
- No inline scripts, inline event handlers or `style=""` attributes; the Content Security Policy forbids them, and `npm run check:static` checks.
- Write user-supplied text with `textContent` or the `h()` helper, never `innerHTML`.
- Store metric units (cm, kg, kcal; nutrients with explicit units), local dates as `YYYY-MM-DD`, and timestamps in UTC ISO 8601. Give records stable UUIDs.
- Changing the storage shape means bumping `SCHEMA_VERSION` and adding a migration plus a test. Never drop user data.
- Show only working features in the primary navigation.

## Accounts and server data

- Accounts must stay optional, and switched off until the launch checklist in `docs/PRIVACY.md` is signed off. Never collect health data on the server otherwise.
- Every query on user data must be scoped by the user ID from the session, never from the request. Add a test for any new endpoint.
- Never log personal data, search text, tokens or secrets, and never put them in error responses.
- Schema changes go in a new numbered file in `server/migrations/` that ends by recording itself. They are never run automatically.

## Health content

- Verify formulas against primary sources and record the equation, units, population, assumptions, limits and source in `docs/FORMULAS.md`, `ui/methods.js` and the tests.
- Present every figure as an estimate. Use neutral wording, and make no promises about weight, body composition or health.
- Do not infer body fat, fitness or health from BMI. Weight loss and gain targets need a separate reviewed feature with eligibility checks and safeguards.

## Style

- Irish English (for example "colour", "programme", "litre"), metric first, `lang="en-IE"`.
- Phone-first layouts, visible focus, 44 px touch targets, strong contrast, and support for `prefers-reduced-motion`.
- Every view needs empty, loading, success and error states.
