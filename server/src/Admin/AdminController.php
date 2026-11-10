<?php

declare(strict_types=1);

namespace LetsGetFit\Admin;

use LetsGetFit\Accounts\AccountController;
use LetsGetFit\Accounts\Audit;
use LetsGetFit\Auth\SessionManager;
use LetsGetFit\Config;
use LetsGetFit\Db\Migrator;
use LetsGetFit\Mail\Mailer;
use LetsGetFit\RateLimiter;
use LetsGetFit\Settings\SettingsStore;
use PDO;

/**
 * /api/admin.php?action=...
 *
 * GET  status (no login needed: only says whether database setup is needed)
 * POST setup {setupToken}  creates the tables, with the one-time token from the private settings
 * Admins only (role checked in the database on every request):
 * GET  overview | settings | users[&q=] | audit
 * POST settings {values} | user {id, op} | test-email
 *
 * Admins manage accounts and settings. They never see anyone's health or fitness records:
 * only counts. Every change is written to the audit log without personal data.
 */
final class AdminController
{
    public function __construct(
        private PDO $pdo,
        private SessionManager $session,
        private Mailer $mailer,
        private RateLimiter $limiter,
        private Config $fileConfig,
        private Config $config,
        private SettingsStore $settings,
        private Migrator $migrator,
    ) {
    }

    /** @return array{0: int, 1: array<string, mixed>, 2: array<string, string>} */
    public function handle(array $server, array $query, string $rawBody): array
    {
        $this->session->start();
        $method = (string) ($server['REQUEST_METHOD'] ?? 'GET');
        $action = is_string($query['action'] ?? null) ? $query['action'] : '';
        $ip = (string) ($server['REMOTE_ADDR'] ?? '');

        if ($method === 'GET' && $action === 'status') {
            return $this->status();
        }
        if ($method === 'POST' && $action === 'setup') {
            [$ok, $body] = AccountController::readPost($server, $rawBody, $this->session, $this->config);

            return $ok ? $this->setup($body, $ip) : $body;
        }
        if ($this->migrator->pending() !== []) {
            return AccountController::error(409, 'setup_required', 'The database needs setting up first.');
        }
        $adminId = $this->adminId();
        if ($adminId === null) {
            return AccountController::error(403, 'not_admin', 'Log in with an admin account to use this page.');
        }
        if ($method === 'GET') {
            return match ($action) {
                'overview' => $this->overview(),
                'settings' => $this->settingsView(),
                'users' => $this->users($query),
                'audit' => [200, ['entries' => Audit::recent($this->pdo, 100)], self::noStore()],
                default => AccountController::error(404, 'unknown_action', 'Unknown action.'),
            };
        }
        if ($method !== 'POST') {
            return AccountController::error(405, 'method_not_allowed', 'Use GET or POST.');
        }
        [$ok, $body] = AccountController::readPost($server, $rawBody, $this->session, $this->config);
        if (!$ok) {
            return $body;
        }
        if ($wait = $this->limiter->hitVisitor("admin:user:$adminId", 120, 600)) {
            return AccountController::rateLimited($wait);
        }

        return match ($action) {
            'settings' => $this->saveSettings($adminId, $body),
            'user' => $this->updateUser($adminId, $body),
            'test-email' => $this->testEmail($adminId),
            default => AccountController::error(404, 'unknown_action', 'Unknown action.'),
        };
    }

    /* ---------------- Setup ---------------- */

    private function status(): array
    {
        $pending = $this->migrator->pending();

        return [200, [
            'needsSetup' => $pending !== [],
            'pending' => $pending,
            'setupTokenConfigured' => strlen($this->fileConfig->string('setup_token')) >= 24,
            'adminEmailConfigured' => AccountController::email($this->fileConfig->string('admin_email')) !== null,
            'csrfToken' => $this->session->csrfToken(),
        ], self::noStore()];
    }

    private function setup(array $body, string $ip): array
    {
        if ($wait = $this->limiter->hitVisitor("admin-setup:ip:$ip", 5, 3600)) {
            return AccountController::rateLimited($wait);
        }
        if ($this->migrator->pending() === []) {
            return [200, ['ok' => true, 'applied' => [], 'message' => 'The database is already up to date.'], self::noStore()];
        }
        $expected = $this->fileConfig->string('setup_token');
        $given = is_string($body['setupToken'] ?? null) ? trim($body['setupToken']) : '';
        $allowed = (strlen($expected) >= 24 && hash_equals($expected, $given)) || $this->adminIdQuietly() !== null;
        if (!$allowed) {
            return AccountController::error(403, 'bad_setup_token', strlen($expected) >= 24
                ? 'That setup token is not right. It is the ADMIN_SETUP_TOKEN secret in GitHub.'
                : 'Add an ADMIN_SETUP_TOKEN secret (at least 24 characters) in GitHub and deploy again first.', [], 'setupToken');
        }
        $applied = $this->migrator->migrate();
        Audit::log($this->pdo, $this->adminIdQuietly(), 'database.setup', implode(',', $applied));

        return [200, ['ok' => true, 'applied' => $applied, 'message' => 'The database is set up. Now log in with the admin email address to open the admin panel.'], self::noStore()];
    }

    /* ---------------- Overview ---------------- */

    private function overview(): array
    {
        $one = fn (string $sql): int => (int) $this->pdo->query($sql)->fetchColumn();

        return [200, [
            'users' => [
                'total' => $one('SELECT COUNT(*) FROM users'),
                'admins' => $one("SELECT COUNT(*) FROM users WHERE role = 'admin'"),
                'disabled' => $one('SELECT COUNT(*) FROM users WHERE disabled_at IS NOT NULL'),
                'withPassword' => $one('SELECT COUNT(*) FROM users WHERE password_hash IS NOT NULL'),
                'new7Days' => $one('SELECT COUNT(*) FROM users WHERE created_at > UTC_TIMESTAMP() - INTERVAL 7 DAY'),
                'active30Days' => $one('SELECT COUNT(*) FROM users WHERE last_login_at > UTC_TIMESTAMP() - INTERVAL 30 DAY'),
            ],
            'records' => $one('SELECT COUNT(*) FROM records WHERE deleted = 0'),
            'features' => [
                'signupsOpen' => $this->config->bool('signups_open'),
                'foodSearch' => $this->config->usingDemoKey() ? 'demo-key' : 'configured',
                'aiScan' => trim($this->config->string('openai_api_key')) === '' ? 'no-key' : ($this->config->bool('scan_enabled') ? 'enabled' : 'paused'),
                'mail' => $this->config->string('mail_transport') === 'smtp' ? 'smtp' : 'outbox (test mode: emails are not sent)',
                'secretsStorable' => $this->settings->canStoreSecrets(),
            ],
            'database' => ['applied' => $this->migrator->applied()],
        ], self::noStore()];
    }

    /* ---------------- Settings ---------------- */

    private function settingsView(): array
    {
        $stored = $this->settings->masked();
        $fields = [];
        foreach (SettingsStore::FIELDS as $name => [$type, $secret]) {
            $fromFile = $this->fileConfig->string($name);
            $fields[$name] = [
                'type' => explode(':', $type)[0],
                'secret' => $secret,
                'stored' => $stored[$name] ?? null,
                // Where the value in use comes from: this page, the GitHub secret, or nowhere.
                'source' => array_key_exists($name, $stored) ? 'admin' : ($secret ? ($fromFile !== '' ? 'github' : 'none') : 'default'),
                'value' => $secret ? null : $this->current($name, $type),
            ];
            if (str_starts_with($type, 'int:')) {
                [, $min, $max] = explode(':', $type);
                $fields[$name]['min'] = (int) $min;
                $fields[$name]['max'] = (int) $max;
            }
        }

        return [200, ['fields' => $fields, 'secretsStorable' => $this->settings->canStoreSecrets()], self::noStore()];
    }

    private function current(string $name, string $type): mixed
    {
        if ($type === 'bool') {
            return $this->config->bool($name);
        }
        if (str_starts_with($type, 'int:')) {
            return $this->config->int($name);
        }

        return $this->config->string($name);
    }

    private function saveSettings(string $adminId, array $body): array
    {
        $values = $body['values'] ?? null;
        if (!is_array($values) || $values === [] || array_is_list($values)) {
            return AccountController::error(400, 'bad_settings', 'Send the settings to change.');
        }
        $errors = [];
        foreach ($values as $name => $value) {
            if (!is_string($name) || !isset(SettingsStore::FIELDS[$name])) {
                $errors[(string) $name] = 'Unknown setting.';
                continue;
            }
            $error = $this->settings->set($name, $value, $adminId);
            if ($error !== null) {
                $errors[$name] = $error;
            } else {
                // Never the value: just which setting changed.
                Audit::log($this->pdo, $adminId, 'settings.changed', $name);
            }
        }
        if ($errors !== []) {
            return [422, ['error' => 'invalid_settings', 'message' => 'Some settings were not saved.', 'fields' => $errors], self::noStore()];
        }

        return [200, ['ok' => true, 'message' => 'Settings saved. They apply straight away.'], self::noStore()];
    }

    /* ---------------- Users ---------------- */

    private function users(array $query): array
    {
        $q = is_string($query['q'] ?? null) ? mb_strtolower(trim($query['q'])) : '';
        $sql = 'SELECT u.id, u.email, u.role, u.created_at, u.last_login_at, u.disabled_at, (u.password_hash IS NOT NULL) AS has_password,
                (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id AND r.deleted = 0) AS record_count
                FROM users u';
        $params = [];
        if ($q !== '') {
            $sql .= ' WHERE u.email LIKE ?';
            $params[] = '%' . addcslashes(mb_substr($q, 0, 100), '%_\\') . '%';
        }
        $sql .= ' ORDER BY u.created_at DESC LIMIT 100';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $users = array_map(static fn (array $r): array => [
            'id' => $r['id'],
            'email' => $r['email'],
            'role' => $r['role'] === 'admin' ? 'admin' : 'user',
            'createdAt' => $r['created_at'],
            'lastLoginAt' => $r['last_login_at'],
            'disabled' => $r['disabled_at'] !== null,
            'hasPassword' => (bool) $r['has_password'],
            'recordCount' => (int) $r['record_count'],
        ], $stmt->fetchAll());

        return [200, ['users' => $users], self::noStore()];
    }

    private function updateUser(string $adminId, array $body): array
    {
        $id = is_string($body['id'] ?? null) ? $body['id'] : '';
        $op = is_string($body['op'] ?? null) ? $body['op'] : '';
        if (!in_array($op, ['disable', 'enable', 'make-admin', 'remove-admin', 'logout', 'delete'], true)) {
            return AccountController::error(400, 'bad_op', 'Unknown change.');
        }
        $stmt = $this->pdo->prepare('SELECT id, email FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $target = $stmt->fetch();
        if (!$target) {
            return AccountController::error(404, 'no_user', 'That account no longer exists.');
        }
        if ($id === $adminId && in_array($op, ['disable', 'remove-admin', 'delete'], true)) {
            return AccountController::error(409, 'self', 'You cannot do that to your own account here. Another admin can, or use your own account page.');
        }
        if ($op === 'delete' && ($body['confirm'] ?? null) !== $target['email']) {
            return AccountController::error(422, 'confirm_required', 'Type the account\'s email address to confirm.', [], 'confirm');
        }
        $sql = match ($op) {
            'disable' => 'UPDATE users SET disabled_at = UTC_TIMESTAMP(), session_version = session_version + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            'enable' => 'UPDATE users SET disabled_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            'make-admin' => "UPDATE users SET role = 'admin', updated_at = UTC_TIMESTAMP() WHERE id = ?",
            'remove-admin' => "UPDATE users SET role = 'user', updated_at = UTC_TIMESTAMP() WHERE id = ?",
            'logout' => 'UPDATE users SET session_version = session_version + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            'delete' => 'DELETE FROM users WHERE id = ?',
        };
        $this->pdo->prepare($sql)->execute([$id]);
        Audit::log($this->pdo, $adminId, 'user.' . $op, $op === 'delete' ? null : $id);

        $messages = [
            'disable' => 'The account is disabled and logged out everywhere. Its data is kept.',
            'enable' => 'The account is enabled again.',
            'make-admin' => 'The account is now an admin.',
            'remove-admin' => 'The account is no longer an admin.',
            'logout' => 'The account has been logged out on every device.',
            'delete' => 'The account and all its data have been deleted.',
        ];

        return [200, ['ok' => true, 'message' => $messages[$op]], self::noStore()];
    }

    private function testEmail(string $adminId): array
    {
        $stmt = $this->pdo->prepare('SELECT email FROM users WHERE id = ?');
        $stmt->execute([$adminId]);
        $email = (string) $stmt->fetchColumn();
        try {
            $this->mailer->send($email, 'LetsGetFit test email', "This is a test email from the LetsGetFit admin panel. If you can read it, sending email works.");
        } catch (\Throwable $e) {
            error_log('LetsGetFit mail error: ' . $e::class);

            return AccountController::error(502, 'mail_failed', 'The email could not be sent. Check the SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD secrets, and that MAIL_FROM is a mailbox on that server.');
        }
        Audit::log($this->pdo, $adminId, 'mail.test');

        return [200, ['ok' => true, 'message' => $this->config->string('mail_transport') === 'smtp'
            ? 'A test email has been sent to your address. Check your inbox and spam folder.'
            : 'Email is in test mode (outbox): the message was saved on the server, not sent.'], self::noStore()];
    }

    /* ---------------- Helpers ---------------- */

    private function adminId(): ?string
    {
        $uid = $this->session->userId($this->pdo);
        if ($uid === null) {
            return null;
        }
        $stmt = $this->pdo->prepare('SELECT role FROM users WHERE id = ?');
        $stmt->execute([$uid]);

        return $stmt->fetchColumn() === 'admin' ? $uid : null;
    }

    /** Admin check that tolerates a database without tables yet. */
    private function adminIdQuietly(): ?string
    {
        try {
            return $this->adminId();
        } catch (\PDOException) {
            return null;
        }
    }

    /** @return array<string, string> */
    private static function noStore(): array
    {
        return ['Cache-Control' => 'no-store'];
    }
}
