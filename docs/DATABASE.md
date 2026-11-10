# Database, email, accounts and admin: setup, backups and restore

The database is only used by **optional accounts** and the admin panel. Accounts are **off** until you complete the launch checklist in `docs/PRIVACY.md` and set the secrets below. Anonymous, on-device use never needs it.

## What is stored

| Table | Contents |
|---|---|
| `users` | Random UUID, lower-cased email, an optional Argon2id password hash (bcrypt if Argon2id is unavailable; empty for code-only accounts), role (`user` or `admin`), when health-data consent was given, when the account was disabled (if it was), last login, a session version, and timestamps |
| `login_codes` | 6-digit email login codes, stored only as keyed hashes (HMAC with `APP_HASH_SECRET`) next to a keyed hash of the email. Valid for 10 minutes, 5 wrong guesses at most, one live code per address, deleted when used. |
| `records` | One row per synced item (profile, preferences, workout, weight entry, saved food, diary entry): JSON data, a deleted flag, the client's change time and the server's change time. The primary key is `(user_id, collection, record_id)`. |
| `settings` | Settings saved in the admin panel. API keys are encrypted (libsodium secretbox, key derived from `APP_HASH_SECRET`). |
| `audit_log` | Account and admin actions: who did it (user ID), the action and a short detail such as a setting name. Never values, emails or health data. Kept for a year. |
| `schema_migrations` | Which migration files have been applied |

`records` rows are removed automatically with their user (`ON DELETE CASCADE`). Sessions are PHP session files in `letsgetfit-private/storage/sessions/`, not in the database.

## How people sign in

- **Join or log in** on the **Account** tab: enter an email address and we email a 6-digit code. A new address is asked for explicit health-data consent before the account is created.
- **Password (optional):** once logged in, a member can add a password and use it instead of a code. A forgotten password is replaced by logging in with a code and setting a new one within 15 minutes. Changing or removing it logs out other devices.
- **Admin:** whoever logs in with a code sent to `ADMIN_EMAIL` becomes an admin. Admins can make other members admins.

| User panel (`#account`) | Admin panel (`#admin`, admins only) |
|---|---|
| Account details and an admin link for admins | Counts: members, new, active, admins, disabled, synced records |
| Turn on sync for this device, with a preview; sync now | API keys (OpenAI, USDA) and model, stored encrypted, shown only as the last 4 characters |
| Add, change or remove a password | Pause photo scanning, scan limits, open or pause sign-ups, privacy contact email |
| Log out on every device | Members: search, disable or enable, make or remove admin, log out everywhere, delete |
| Download account data (JSON), delete the account | Send a test email; activity log |

Admins never see members' health or fitness records: only counts.

## 1. Create the database and mailbox (once)

In the Eco Web Hosting control panel:

1. **MySQL Database Wizard** (or **MySQL Databases**): create a database, for example `cpuser_letsgetfit`.
2. Create a **dedicated** user with a long generated password, for example `cpuser_lgfapp`.
3. Give that user these privileges on **that database only**: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES and DROP. DROP is needed only by migrations.
4. Note the host. It is usually `localhost`.
5. **Email Accounts:** create a mailbox for sending, for example `no-reply@letsgetfit.site`, with a strong password. **Connect Devices** (or **Mail Client Configuration**) shows the outgoing SMTP server (often `mail.letsgetfit.site`) and port (`465` SSL or `587` STARTTLS).

Requirements: MySQL 8.0+ or MariaDB 10.6+, with the `pdo_mysql` PHP extension. `https://letsgetfit.site/api/health.php` reports `"pdoMysql": true` when the extension is present.

## 2. Secrets and switch-on

GitHub repository → **Settings → Secrets and variables → Actions**. Add each under **Secrets** (or **Variables** where shown):

| Name | Kind | Example |
|---|---|---|
| `DB_NAME` | secret | `cpuser_letsgetfit` |
| `DB_USER` | secret | `cpuser_lgfapp` |
| `DB_PASSWORD` | secret | the database user's password |
| `DB_HOST` | secret (optional) | `localhost` (default) |
| `DB_PORT` | secret (optional) | `3306` (default) |
| `SMTP_HOST` | secret | `mail.letsgetfit.site` |
| `SMTP_PORT` | secret (optional) | `465` or `587` (default 587, or 465 with `ssl`) |
| `SMTP_SECURE` | secret (optional) | `ssl` for port 465, `tls` (default) for 587 |
| `SMTP_USER` | secret (optional) | the mailbox address; defaults to `MAIL_FROM` |
| `SMTP_PASSWORD` | secret | the mailbox password |
| `MAIL_FROM` | secret | `no-reply@letsgetfit.site` |
| `MAIL_FROM_NAME` | variable (optional) | `LetsGetFit` |
| `APP_HASH_SECRET` | secret | 64 random letters and digits. Required with accounts: it protects login codes and encrypts API keys saved in the admin panel. Do not change it later, or saved keys must be entered again. |
| `ADMIN_EMAIL` | secret | the email address that becomes the admin |
| `ADMIN_SETUP_TOKEN` | secret | 24+ random letters and digits, used once to create the tables |
| `ACCOUNTS_ENABLED` | **variable** | `true` to switch accounts on; leave unset otherwise |

To make a random value, use a password manager's generator (letters and digits only), or run `openssl rand -hex 32`.

The deploy writes these into `letsgetfit-private/config/app.php` (outside the web root, permission 600) using `scripts/write-config.php`, which escapes every value. If `ACCOUNTS_ENABLED` is `true` but a required secret is missing, the deploy **stops before uploading anything** and names the missing secrets.

## 3. Create the tables

After the deploy with `ACCOUNTS_ENABLED=true`, use **one** of these methods. Take a backup first if the database already has data (section 4).

**From the website (easiest):**

1. Open `https://letsgetfit.site/#admin`. It says the database needs setting up.
2. Enter the `ADMIN_SETUP_TOKEN` value and press **Set up the database**. Only pending migrations run, once each. Wrong tokens are rate-limited.
3. Open the **Account** tab, enter the `ADMIN_EMAIL` address, and enter the code from the email. You are now the admin; **Open the admin panel** appears.
4. In the admin panel, press **Send me a test email**, and add API keys if you want to manage them there instead of in GitHub.

Later migrations show up the same way: the admin page offers to run them (admins can run them without the token).

**Terminal or SSH** (if your plan has it):

```bash
php ~/domains/letsgetfit.site/letsgetfit-private/app/bin/migrate.php --status
php ~/domains/letsgetfit.site/letsgetfit-private/app/bin/migrate.php
```

**phpMyAdmin:** import each pending file from `server/migrations/` in number order. The last line of each file records it in `schema_migrations`.

The migration CLI refuses to run from a browser, and the migration files are not inside the web root.

## 4. Backups

- **Host backups:** check that the hosting plan's automatic backups include databases, and how long they are kept. Eco Web Hosting and cPanel offer **Backup** or **JetBackup** screens to download or restore a database.
- **Before every migration**, and at least weekly while accounts are live, take your own dump:

  ```bash
  mysqldump --single-transaction --routines --no-tablespaces -h localhost -u cpuser_lgfapp -p cpuser_letsgetfit | gzip > ~/letsgetfit-backups/db-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
  chmod 600 ~/letsgetfit-backups/*.sql.gz
  ```

  Without SSH, use phpMyAdmin → **Export** → **Custom** → gzipped. Store dumps outside the web root, and delete old ones in line with the retention policy in `docs/PRIVACY.md` (keep 30 days).
- Backups contain health data. Keep them encrypted at rest where possible, never email them, and restrict access to the account owner.

## 5. Restore

1. Put the site in a safe state: set the `ACCOUNTS_ENABLED` variable to empty and run the deploy. The app keeps working on devices, and the account section is hidden.
2. Restore the dump into an **empty** database (a new one, or the same one after dropping its tables):

   ```bash
   gunzip < ~/letsgetfit-backups/db-YYYYMMDDTHHMMSSZ.sql.gz | mysql -h localhost -u cpuser_lgfapp -p cpuser_letsgetfit
   ```

   Or use phpMyAdmin → **Import**.
3. Apply any migrations newer than the backup (`migrate.php`, or the admin page after step 4).
4. Switch accounts back on (`ACCOUNTS_ENABLED=true`, then redeploy).
5. Log in with a test account and check that sync works.

Devices keep their own copies, so the next sync re-uploads anything changed since the backup (last write wins).

**Test a restore** into a scratch database at least once before launch, and after any schema change.

## 6. Maintenance (optional cron job)

cPanel → **Cron Jobs**, once a day, for example at 03:17:

```
17 3 * * * php /home/USER/domains/letsgetfit.site/letsgetfit-private/app/bin/cleanup.php > /dev/null 2>&1
```

It removes expired login codes, audit entries older than a year, and old cache, outbox and rate-limit files. Expired sessions are cleaned up by PHP itself.

## 7. Test email and account recovery in staging first

Before switching accounts on for everyone:

1. Create a **staging** copy: a subdomain such as `staging.letsgetfit.site` with its own database and its own `letsgetfit-private` folder. You can also switch accounts on for a short test window on the live site with no public announcement.
2. With the real SMTP settings, check:
   - the admin panel's **Send me a test email** works;
   - code emails arrive within a minute, including in Gmail and Outlook, and land in the inbox rather than spam;
   - a code works once only, and stops working after 10 minutes;
   - setting a password logs out other devices.
3. Make sure the sending domain has SPF and DKIM DNS records (from the mail provider) and a DMARC record, so messages are not marked as spam.
4. Check `api/health.php` shows `"accounts":"enabled"` and `"pdoMysql":true`.

Automated tests already cover all of this against a real MariaDB with a test outbox (`tests/api/accounts.test.mjs`, `tests/e2e/accounts.mjs`). Only real email delivery needs this manual check.
