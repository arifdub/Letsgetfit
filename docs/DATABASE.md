# Database: setup, migrations, backups and restore (Phase 4)

The database is only used by **optional accounts**. Accounts are **off** until you complete the launch checklist in `docs/PRIVACY.md` and set the secrets below. Anonymous, on-device use never needs it.

## What is stored

| Table | Contents |
|---|---|
| `users` | Random UUID, lower-cased email, Argon2id password hash (bcrypt if Argon2id is unavailable), the dates the email was confirmed and health-data consent was given, a session version, and timestamps |
| `auth_tokens` | The SHA-256 **hash** of each email-confirmation (48 h) or password-reset (1 h) token. The token itself exists only in the email link. Single use. |
| `records` | One row per synced item (profile, preferences, workout, weight entry, saved food, diary entry): JSON data, a deleted flag, the client's change time and the server's change time. The primary key is `(user_id, collection, record_id)`. |
| `schema_migrations` | Which migration files have been applied |

`records` and `auth_tokens` rows are removed automatically with their user (`ON DELETE CASCADE`). Sessions are PHP session files in `letsgetfit-private/storage/sessions/`, not in the database.

## 1. Create the database (once)

In the Eco Web Hosting control panel (cPanel: **MySQL Database Wizard**):

1. Create a database, for example `cpuser_letsgetfit`.
2. Create a **dedicated** user with a long generated password, for example `cpuser_lgfapp`.
3. Give that user these privileges on **that database only**: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES and DROP. DROP is needed only by future migrations. It is never used in normal operation.
4. Note the host. It is usually `localhost`.

Requirements: MySQL 8.0+ or MariaDB 10.6+, with the `pdo_mysql` PHP extension. `https://letsgetfit.site/api/health.php` reports `"pdoMysql": true` when the extension is present.

## 2. Secrets and switch-on

Repository → **Settings → Secrets and variables → Actions**:

| Name | Kind | Example |
|---|---|---|
| `DB_HOST` | secret (optional) | `localhost` |
| `DB_PORT` | secret (optional) | `3306` |
| `DB_NAME` | secret | `cpuser_letsgetfit` |
| `DB_USER` | secret | `cpuser_lgfapp` |
| `DB_PASSWORD` | secret | long random |
| `SMTP_HOST` | secret | `mail.letsgetfit.site`, or your email provider's host |
| `SMTP_PORT` | secret (optional) | `587` (STARTTLS) or `465` |
| `SMTP_SECURE` | secret (optional) | `tls` (default) or `ssl` |
| `SMTP_USER` | secret | `no-reply@letsgetfit.site` |
| `SMTP_PASSWORD` | secret | the mailbox password |
| `MAIL_FROM` | secret | `no-reply@letsgetfit.site` |
| `APP_HASH_SECRET` | secret (recommended) | 64 random characters (letters, digits, - or _) |
| `ACCOUNTS_ENABLED` | **variable** | `true` to switch accounts on; leave unset otherwise |

The deploy writes these into `letsgetfit-private/config/app.php` (outside the web root, permission 600) using `scripts/write-config.php`. That script escapes every value. If `ACCOUNTS_ENABLED` is `true` but any required secret is missing, the deploy **stops before uploading anything**.

## 3. Run migrations (by hand, never on deploy)

Take a backup first (section 4). Then use **one** of these methods.

**Terminal or SSH** (if your plan has it):

```bash
php ~/domains/letsgetfit.site/letsgetfit-private/app/bin/migrate.php --status
php ~/domains/letsgetfit.site/letsgetfit-private/app/bin/migrate.php
```

The exact path depends on where the deploy put `letsgetfit-private`. It is next to the site's `public_html`.

**phpMyAdmin** (no SSH needed):

1. Open the database.
2. Go to **Import** and choose `server/migrations/001_accounts.sql` from the repository. Import each pending file in number order.
3. The last line of each file records it in `schema_migrations`.
4. Check with `SELECT * FROM schema_migrations;`.

The migration CLI refuses to run from a browser. The migration files are not inside the web root.

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
3. Run `migrate.php --status` and apply any migrations newer than the backup.
4. Switch accounts back on (`ACCOUNTS_ENABLED=true`, then redeploy).
5. Sign in with a test account and check that sync works.

Devices keep their own copies, so the next sync re-uploads anything changed since the backup (last write wins).

**Test a restore** into a scratch database at least once before launch, and after any schema change.

## 6. Maintenance (optional cron job)

cPanel → **Cron Jobs**, once a day, for example at 03:17:

```
17 3 * * * php /home/USER/domains/letsgetfit.site/letsgetfit-private/app/bin/cleanup.php > /dev/null 2>&1
```

It removes expired tokens, sign-ups never confirmed within 7 days, and old cache and rate-limit files. Expired sessions are cleaned up by PHP itself.

## 7. Test email and account recovery in staging first

Before switching accounts on for everyone:

1. Create a **staging** copy: a subdomain such as `staging.letsgetfit.site` with its own database and its own `letsgetfit-private` folder. You can also switch accounts on for a short test window on the live site with no public announcement.
2. With the real SMTP settings, check:
   - sign-up emails arrive, including in Gmail and Outlook, and land in the inbox rather than spam;
   - the confirmation link works once only;
   - "Forgot password" emails arrive and the link expires after 1 hour;
   - after a reset, other logged-in devices are logged out.
3. Make sure the sending domain has SPF and DKIM DNS records (from the mail provider) and a DMARC record, so messages are not marked as spam.
4. Check `api/health.php` shows `"accounts":"enabled"` and `"pdoMysql":true`.

Automated tests already cover all of this against a real MariaDB with a test outbox (`tests/api/accounts.test.mjs`, `tests/e2e/accounts.mjs`). Only real email delivery needs this manual check.
