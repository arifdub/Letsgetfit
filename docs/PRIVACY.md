# Data protection and privacy

LetsGetFit processes data about physical health (body weight, food intake, exercise, and pregnancy or breastfeeding status). Under the GDPR this is **special category data** (Article 9). This document records what is processed today, what optional accounts would add, and what must be done **before accounts are switched on**.

The public notice is `public/privacy.html`. It currently describes on-device use and food search. A draft that covers accounts is in `docs/PRIVACY-NOTICE-ACCOUNTS-DRAFT.md`.

## 1. Today (accounts switched off)

| Data | Where | Purpose | Retention |
|---|---|---|---|
| Profile (age, height, weight, equation coefficient, activity level, pregnancy or breastfeeding answer), food diary, saved foods, workouts, sessions, weights, preferences | Browser `localStorage` on the user's device only | Calculations and the user's own logs | Until the user clears it (Settings → Clear all data) or clears browser data |
| Food search text | Sent to our PHP endpoint, forwarded to USDA FoodData Central. Results are cached by query text only. | Finding foods | Cache 7 days. Not logged. |
| IP address | Keyed hash (HMAC) in rate-limit files | Abuse prevention | Under 24 hours |
| Web server access logs | Hosting provider | Security and operations | Host's policy |

No server-side health data is collected. There is no analytics, advertising, tracking cookie or third-party script, and the Content Security Policy blocks third-party requests.

## 2. With optional accounts (built, tested, switched OFF)

| Data | Purpose | Lawful basis (to confirm in review) | Retention |
|---|---|---|---|
| Email address | Account login by emailed code | Contract (Art. 6(1)(b)) | Until account deletion |
| Password hash (Argon2id), optional | Authentication without a code | Contract | Until account deletion or removal |
| Role, last login, disabled date | Running the service, admin tools | Legitimate interests | Until account deletion |
| Synced records: profile, weights, diary, foods, workouts, preferences | Use the same data on several devices | **Explicit consent** (Art. 9(2)(a)), given by a separate unticked checkbox at sign-up and recorded as `health_consent_at` | Until the user deletes it or deletes the account. Unconfirmed sign-ups are deleted after 7 days. |
| Session cookie (`__Host-lgf_session`, HttpOnly, Secure, SameSite=Lax) | Keep the user logged in | Strictly necessary | 30 days |
| Login code hashes (keyed) | Sign-in | Contract | 10 minutes; deleted when used, and by cleanup |
| Audit log (user ID, action, setting name) | Security and accountability | Legitimate interests | 1 year |
| API keys saved by admins | Running food search and scanning | — (not personal data) | Encrypted until removed |
| Database backups | Recovery | Legitimate interests | 30 days rolling (`docs/DATABASE.md`) |

**User controls (implemented):**
- Sync is opt-in for each device, with a preview of exactly what will be copied.
- Download all account data as JSON.
- Delete the account, which needs the password (or a code login in the last 15 minutes) and removes the user and every record immediately.
- Log out on this device, or on every device. Setting, changing or removing a password logs out other devices.
- Data on the device is never deleted by account actions.

**Access controls (implemented):**
- Every query is scoped to the user ID from the server-side session. A client-supplied ID is ignored, and tests prove two users cannot read or change each other's records.
- CSRF token, JSON-only requests and a same-origin check on every change.
- Rate limits on code requests (per IP, and 5 emails an hour per address), code checks (5 wrong guesses per code), password login (per IP and per email), push, delete, setup and admin changes.
- Generic messages that do not reveal whether an email has an account.
- Login codes are stored only as keyed hashes. The database user has privileges on its own database only.
- **Admins** see members' emails, roles and dates, and counts of synced records, but never the records themselves. The role is checked in the database on every admin request, and every admin change is in the audit log. An admin cannot disable, demote or delete themselves.
- Configuration and secrets live outside the web root with permission 600.
- Logs record error types only: never emails, search text, tokens, passwords or health data. Error responses carry no personal data.

**Processors** (to confirm and list in the notice, with a data processing agreement for each):
- **Hosting:** Eco Web Hosting. Confirm the data centre location (UK or EU) and that their DPA covers special category data. If the servers are in the UK, the EU adequacy decision for the UK applies.
- **Email delivery:** the chosen SMTP provider. If it is a US provider, check its EU–US Data Privacy Framework certification or standard contractual clauses.
- **USDA FoodData Central:** receives search text only, never account data.

## 3. Launch checklist before switching accounts on

All must be done and signed off by the controller. The person running letsgetfit.site is responsible for this; it is not an engineering task.

- [ ] Name the **controller** and add contact details in the privacy notice.
- [ ] **DPIA** (Data Protection Impact Assessment): processing health data at any scale through an app is likely to need one under Art. 35 and the Irish Data Protection Commission's guidance. Record risks and the mitigations above.
- [ ] Confirm the **lawful bases** in section 2, particularly explicit consent for health data, and check that the consent text at sign-up matches the notice.
- [ ] Sign **DPAs** with the host and the email provider. Record their locations and any transfer mechanism.
- [ ] Finalise the **retention** periods, including inactive accounts. The current proposal is to email after 24 months of inactivity and delete 30 days later. This is not yet automated, so add it before launch or state that it doesn't happen.
- [ ] Publish the **privacy notice** for accounts (from `docs/PRIVACY-NOTICE-ACCOUNTS-DRAFT.md`), linked from sign-up.
- [ ] Set up a process for **data subject rights**: access (in-app export), erasure (in-app deletion), rectification (edit in the app and sync), and requests by email within one month.
- [ ] Write a **breach response** plan: who decides, the 72-hour notification to the Data Protection Commission, and informing users.
- [ ] Confirm **minimum age**. The calculator is for adults of 20 and over; state that accounts are for adults only.
- [ ] Test **backups and restore** (`docs/DATABASE.md` §4–5) and **email delivery in staging** (§7).
- [ ] Have a qualified person carry out an **EU privacy review** of the above.
- [ ] Then set `ACCOUNTS_ENABLED=true`, run migrations, deploy, and check `/api/health.php`.

## 4. AI meal scan (Phase 5: built, OFF until an OpenAI key is set)

| Data | Where it goes | Purpose | Retention |
|---|---|---|---|
| Meal photo | Browser → our server → OpenAI API (US) | Suggest foods and amounts | Our server holds it **in memory only**. PHP's temporary upload file is deleted straight away, and nothing is written to disk or logged. OpenAI states that API data is not used for training and may be kept up to 30 days for abuse monitoring. **Confirm current terms before launch.** |
| Photo metadata (location, camera, date) | Removed twice: re-encoded in the browser, then re-encoded with GD on the server, before anything reaches OpenAI | — | Never sent |
| Scan result (suggested foods and amounts) | Our server's private cache, keyed by a hash of IP and request ID | Lets a repeated submission return the first result without a second charge | 10 minutes |
| IP address | Keyed hash in rate-limit files | Per-visitor quotas (5 per 10 minutes, 20 a day) and a site-wide daily cap | Under 24 hours |

**Controls:**
- The user must confirm every photo after reading where it goes; the server refuses uploads without that confirmation header.
- Only JPEG, PNG and WebP are accepted, with size and pixel limits.
- Users are told not to send photos of people.
- The model is told to ignore text in the image.
- Its output is sanitised and is never used for nutrient values.
- The OpenAI key lives only in the private settings file.

**Before switching it on**, add these to the launch checklist:
- [ ] Sign OpenAI's data processing addendum (DPA). Record the US transfer mechanism (EU–US Data Privacy Framework or standard contractual clauses) and check the retention options, including zero data retention if available.
- [ ] Update the DPIA: photos may show people, places or health information; the data goes to a US processor; AI output can be wrong.
- [ ] Publish the scan section in `public/privacy.html` (already written) and confirm it matches OpenAI's current terms.
- [ ] Set `SCAN_DAILY_LIMIT` and a monthly spending limit in the OpenAI dashboard.
