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
| Email address | Account login, confirmation and reset emails | Contract (Art. 6(1)(b)) | Until account deletion |
| Password hash (Argon2id) | Authentication | Contract | Until account deletion |
| Synced records: profile, weights, diary, foods, workouts, preferences | Use the same data on several devices | **Explicit consent** (Art. 9(2)(a)), given by a separate unticked checkbox at sign-up and recorded as `health_consent_at` | Until the user deletes it or deletes the account. Unconfirmed sign-ups are deleted after 7 days. |
| Session cookie (`__Host-lgf_session`, HttpOnly, Secure, SameSite=Lax) | Keep the user logged in | Strictly necessary | 30 days |
| Email-confirmation and reset token hashes | Account recovery | Contract | 48 h and 1 h, then removed by cleanup |
| Database backups | Recovery | Legitimate interests | 30 days rolling (`docs/DATABASE.md`) |

**User controls (implemented):**
- Sync is opt-in for each device, with a preview of exactly what will be copied.
- Download all account data as JSON.
- Delete the account, which needs the password and removes the user, every record and every token immediately.
- Log out on this device. A password reset logs out every device.
- Data on the device is never deleted by account actions.

**Access controls (implemented):**
- Every query is scoped to the user ID from the server-side session. A client-supplied ID is ignored, and tests prove two users cannot read or change each other's records.
- CSRF token, JSON-only requests and a same-origin check on every change.
- Rate limits on sign-up, login (per IP and per email), reset, resend, push and delete.
- Generic messages that do not reveal whether an email has an account.
- Tokens are stored only as hashes. The database user has privileges on its own database only.
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

## 4. Later phases

- **Phase 5 (AI meal scan):** photos go to an AI provider only after explicit, per-use confirmation. They are stripped of metadata, kept in a private temporary folder and deleted after processing. This needs its own DPIA update, processor DPA and transfer assessment before launch.
