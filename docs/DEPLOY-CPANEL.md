# Deploying LetsGetFit to cPanel

This guide covers deploying letsgetfit.site from GitHub to ordinary shared cPanel hosting. Nothing in the repository deploys automatically. You pull and deploy from cPanel when you choose to.

- **Repository:** `https://github.com/arifdub/Letsgetfit` (GitHub shows the name as `Letsgetfit`)
- **Branch to deploy:** `main`
- **Primary strategy:** cPanel Git Version Control clones the repo outside the web root. **Deploy HEAD Commit** runs `.cpanel.yml`, which runs `scripts/deploy.sh`. That script copies only `public/` into the document root.
- **Build step:** none. Phase 1 is plain HTML, CSS and JavaScript modules, so a clean checkout is deployable as-is. CI also produces a `letsgetfit-public-<sha>.tar.gz` artifact for the manual-upload fallback.

> cPanel menus differ slightly between hosts and themes. If a name below does not match, use your host's search box in cPanel. Ask your host if a feature (Git Version Control, Terminal, SSH) is missing.

---

## What you need for each phase

### Phase 1: static app (current)

| Item | Where in cPanel | Notes |
|---|---|---|
| letsgetfit.site added to the account | **Domains** | Note the exact **Document Root** it shows. Do not assume `public_html`. Addon domains often use `/home/USER/letsgetfit.site`. |
| DNS pointing to the host | Your registrar, or **Zone Editor** if the host runs DNS | See [DNS](#dns). Keep existing email records. |
| HTTPS | **SSL/TLS Status** (AutoSSL) or your host's certificate tool | Run AutoSSL after DNS resolves. `.htaccess` redirects HTTP to HTTPS, so get the certificate first. |
| Git Version Control | **Git Version Control** | Preferred. If missing, use the [manual upload fallback](#fallback-manual-upload). |
| Terminal or SSH (optional) | **Terminal**, or **SSH Access** | Makes the one-off setup easier. Everything can also be done in **File Manager**. |

No PHP, database or secrets are needed for Phase 1.

### Phase 2: food diary and food search (planned)

- **MultiPHP Manager:** set letsgetfit.site to PHP 8.3 or newer. Check **MultiPHP INI Editor** and **Select PHP Version → Extensions** (CloudLinux), or a `phpinfo()` page that you delete straight after. Confirm the version and that `curl`, `json`, `mbstring` and `openssl` are enabled. Phase 2 will list exactly which extensions it uses.
- **Outbound HTTPS** from PHP to `api.nal.usda.gov` (FoodData Central) and, if adopted, `world.openfoodfacts.org`. Some hosts block outbound requests; ask if search fails with a connection error.
- **Private config** outside the web root, for example `~/.config/letsgetfit/app.php`, with `chmod 600`. A template will be added as `config/app.example.php`.
- **FoodData Central API key:** free from <https://fdc.nal.usda.gov/api-key-signup>. It goes only in the private config file, never in the repository.
- **Cache directory** outside the web root, for example `~/letsgetfit-data/cache`.

### Phase 4: accounts and sync (planned)

- **MySQL Databases** or **Database Wizard:** one database and one dedicated user with only the privileges the app needs on that database.
- **PDO MySQL** extension (`pdo_mysql`) enabled for the chosen PHP version.
- **SMTP:** an email account in cPanel, or a transactional email provider, for verification and password-reset emails. Test it in staging first.
- **Backups:** cPanel **Backup** or **JetBackup** for the database, plus documented `mysqldump` and restore steps (added in Phase 4).
- **Terminal or SSH:** recommended for running migrations by hand. Migrations never run automatically on deploy.
- **Cron Jobs (optional):** for scheduled clean-up such as expired sessions and tokens.

### Phase 5: AI meal scan (planned)

- **AI provider credentials** in the private config file only.
- **Outbound HTTPS** to the provider's API host.
- **PHP limits** (MultiPHP INI Editor): `upload_max_filesize` and `post_max_size` large enough for one compressed photo (about 8 MB); `max_execution_time` long enough for one provider call with a timeout (about 30 s).
- **Private temporary directory** outside the web root, for example `~/letsgetfit-data/tmp`. Images are deleted after processing by default, plus a cleanup cron job as a safety net.
- Short request timeouts and a clear "enter it manually instead" path. A queue is added only if the host or workload needs one.

---

## Preferred deployment flow (Phase 1)

### 1. Add the domain and find its document root

1. cPanel → **Domains** → **Create A New Domain** (or check it is already listed).
2. Enter `letsgetfit.site`. Leave the subdomain option at its default.
3. After saving, note the **Document Root** column exactly, for example `/home/CPANELUSER/letsgetfit.site`. This value is `DEPLOYPATH` in step 3.
4. Create the safety marker in that folder. In **File Manager**, open the document root, choose **+ File**, and name it `.letsgetfit-docroot` (turn on **Settings → Show Hidden Files**). Or in **Terminal**:

   ```bash
   touch /home/CPANELUSER/letsgetfit.site/.letsgetfit-docroot
   ```

   The deploy script refuses to copy anything into a folder without this file. That protects you from a typo sending the app into the wrong site.

### 2. Clone the repository outside the web root

cPanel → **Git Version Control** → **Create**:

- **Clone a Repository:** on
- **Clone URL:**
  - Public repo: `https://github.com/arifdub/Letsgetfit.git`
  - Private repo: `git@github.com:arifdub/Letsgetfit.git` (needs the deploy key below)
- **Repository Path:** `repositories/letsgetfit` (that is, `/home/CPANELUSER/repositories/letsgetfit`). It must **not** be inside the document root.
- **Repository Name:** `LetsGetFit`

After it clones, open **Manage** and make sure the checked-out branch is `main`.

#### If the repository is private: read-only deploy key

The repository is public at the time of writing. If you make it private, cPanel needs an SSH key that can only read this one repository.

1. In **Terminal** (or **SSH Access → Manage SSH Keys → Generate a New Key** with no passphrase):

   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   ssh-keygen -t ed25519 -f ~/.ssh/letsgetfit_deploy -N "" -C "cpanel deploy letsgetfit"
   cat >> ~/.ssh/config <<'EOF'
   Host github.com
     HostName github.com
     User git
     IdentityFile ~/.ssh/letsgetfit_deploy
     IdentitiesOnly yes
   EOF
   chmod 600 ~/.ssh/config
   ```

   If `~/.ssh/config` already has a `github.com` entry for another site, use a host alias instead (for example `Host github-letsgetfit`) and clone from `git@github-letsgetfit:arifdub/Letsgetfit.git`.

2. Verify GitHub's host key before trusting it:

   ```bash
   ssh-keyscan -t ed25519 github.com > /tmp/github_host_key
   ssh-keygen -lf /tmp/github_host_key
   ```

   Compare the `SHA256:` fingerprint with the ed25519 fingerprint GitHub publishes at <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints>. Only if they match, run `cat /tmp/github_host_key >> ~/.ssh/known_hosts && rm /tmp/github_host_key`.

3. Copy the public key (`cat ~/.ssh/letsgetfit_deploy.pub`). On GitHub, go to **Letsgetfit → Settings → Deploy keys → Add deploy key**, paste it, and leave **Allow write access** off.
4. Test: `ssh -T git@github.com` should greet the repository by name. Then clone in **Git Version Control** as above.

### 3. Tell the deploy script where to copy

The destination lives in a server-local settings file, not in the repository. Using **Terminal**:

```bash
mkdir -p ~/.config/letsgetfit && chmod 700 ~/.config/letsgetfit
cp ~/repositories/letsgetfit/config/deploy.env.example ~/.config/letsgetfit/deploy.env
chmod 600 ~/.config/letsgetfit/deploy.env
nano ~/.config/letsgetfit/deploy.env   # set DEPLOYPATH to the Document Root from step 1
```

Without Terminal, use **File Manager**: create the folder `.config/letsgetfit` in your home directory, create `deploy.env` there containing `DEPLOYPATH=/home/CPANELUSER/letsgetfit.site`, then set its permissions to `600`.

What `.cpanel.yml` and `scripts/deploy.sh` do:

- They read `DEPLOYPATH` (and the optional `BACKUP_DIR` and `KEEP_BACKUPS`) as plain text. The file is never executed.
- They stop **without copying anything** if the settings file is missing, or if the path is relative, missing, `/`, your home directory, inside the checkout, or lacks `.letsgetfit-docroot`. They also stop if the checkout sits inside the document root.
- They back up any files they are about to overwrite to `~/letsgetfit-backups/docroot-<UTC time>.tar.gz` (newest 5 kept).
- They copy only the contents of `public/`: `index.html`, `404.html`, `.htaccess`, `favicon.svg`, `robots.txt` and `assets/`. They never copy `.git`, `scripts/`, `tests/`, `docs/`, `config/`, logs, backups or uploads.
- They never delete anything in the document root. `.well-known` (AutoSSL), `cgi-bin` and other host files are left alone.
- They set files to `644` and folders to `755`.
- They append a line to `~/.local/state/letsgetfit/deploy.log` with the time and commit.
- They never run database migrations.

### 4. Build strategy

There is no build step in Phase 1, so cPanel deploys straight from the clean checkout. This is the chosen strategy, and `tests/deploy/deploy.test.mjs` tests it in CI. If a later phase adds a frontend build or Composer packages that cannot run on the host, the plan is a CI-built release branch (for example `release`) that contains only deployable output. cPanel would then check out that branch instead. This will be documented when it is needed.

### 5. First deployment

1. cPanel → **Git Version Control** → **Manage** (LetsGetFit) → **Pull or Deploy** tab.
2. Click **Update from Remote** to fetch the latest `main` from GitHub.
3. Click **Deploy HEAD Commit**. cPanel runs `.cpanel.yml`.
4. Check the result. The **Last Deployment Information** panel shows the commit, and `~/.local/state/letsgetfit/deploy.log` has a new line. If it failed, cPanel shows the error. The script's messages start with `deploy: ERROR:`.

cPanel only deploys when the checkout has a committed `.cpanel.yml` and no uncommitted local changes. Never edit files inside `~/repositories/letsgetfit` on the server.

**Automatic deploys** (a GitHub webhook or Action that triggers cPanel) are a later opt-in and are not set up. Until you decide otherwise, every release is the two clicks above.

### Fallback: manual upload

If Git Version Control is not available:

1. On GitHub, open **Actions**, pick the latest green run on `main`, and download the `letsgetfit-public-<sha>` artifact. It holds `letsgetfit-public-<sha>.tar.gz`. Or download the repo ZIP and use only its `public/` folder.
2. cPanel → **File Manager** → the document root. Upload the archive, then **Extract** it there. Make sure `.htaccess` came across (turn on **Show Hidden Files**).
3. Delete the uploaded archive from the document root.

SFTP from your computer, if your host offers it, works the same way. Upload the *contents* of `public/` and nothing else.

### 6. After deploying

#### Verify

- [ ] `https://letsgetfit.site/` loads with a valid certificate (padlock) and no browser warnings.
- [ ] `http://letsgetfit.site/` redirects to `https://`.
- [ ] Enter sample details: 30 years, 180 cm, 80 kg, male coefficient, moderately active. Results should show **1,780 kcal** resting and **3,290 kcal** maintenance.
- [ ] Add a workout, reload the page, and check it is still there. Then delete it.
- [ ] `https://letsgetfit.site/does-not-exist` shows the LetsGetFit "Page not found" page.
- [ ] `https://letsgetfit.site/.letsgetfit-docroot` and `https://letsgetfit.site/.htaccess` are refused (403).
- [ ] In the browser developer tools, the **Console** has no errors and the response headers include `Content-Security-Policy`.

#### Logs

- cPanel → **Errors** (or **Metrics → Errors**) shows recent Apache errors for the account.
- Deploy history is in `~/.local/state/letsgetfit/deploy.log`.

#### Secrets (from Phase 2 onwards)

Production settings go in `~/.config/letsgetfit/` with permissions `600`, never in the repository or the document root. Example files with placeholders live in `config/`.

#### Database migrations (from Phase 4 onwards)

These are run by hand in **Terminal** after a deploy that needs them, following the steps in that phase's release notes. Take a database backup first. Migrations are never part of `.cpanel.yml`.

#### Rolling back

Use whichever is quickest:

1. **Revert on GitHub (preferred).** Revert the bad commit on `main`, then **Update from Remote** and **Deploy HEAD Commit**.
2. **Restore the previous files.** Every deploy backs up what it overwrote:

   ```bash
   ls -1 ~/letsgetfit-backups/
   tar -xzf ~/letsgetfit-backups/docroot-YYYYMMDDTHHMMSSZ.tar.gz -C /home/CPANELUSER/letsgetfit.site
   ```

3. **Deploy an older commit by hand:**

   ```bash
   cd ~/repositories/letsgetfit
   git checkout <known-good-sha> && bash scripts/deploy.sh
   git checkout main
   ```

Because deploys never delete files, a file removed in a newer release stays in the document root until you delete it. Phase 1 has no such files.

---

## DNS

Do this where the domain's DNS is hosted. That is your registrar, unless the nameservers point to your cPanel host, in which case use cPanel → **Zone Editor**.

- **Option A: use the host's nameservers.** Set the domain's nameservers at the registrar to the ones your host gave you. cPanel then creates the records. If the domain already has email elsewhere (for example Microsoft 365 or Google Workspace), recreate those `MX`, `TXT` (SPF, DKIM, DMARC) and `CNAME` records in **Zone Editor** before switching. Otherwise email stops.
- **Option B: keep DNS at the registrar.** Add or change only these records:
  - `A` record for `letsgetfit.site` → your cPanel server's shared IP address (shown in cPanel under **General Information** / **Server Information**)
  - `CNAME` for `www` → `letsgetfit.site` (or a second `A` record to the same IP)
  - If your host gives you an IPv6 address, an `AAAA` record. Otherwise make sure no old `AAAA` record points elsewhere.

  Leave every `MX`, `TXT` and other email-related record exactly as it is.

DNS changes can take from a few minutes to 48 hours. Check with `dig +short letsgetfit.site` or an online DNS checker. Then run **SSL/TLS Status → Run AutoSSL**. AutoSSL needs `/.well-known/` to be reachable over HTTP, and the `.htaccess` rules allow that.

When HTTPS works for both `letsgetfit.site` and `www.letsgetfit.site`, you can enable the `Strict-Transport-Security` line in `public/.htaccess`.
