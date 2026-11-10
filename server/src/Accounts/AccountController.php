<?php

declare(strict_types=1);

namespace LetsGetFit\Accounts;

use LetsGetFit\Auth\Passwords;
use LetsGetFit\Auth\SessionManager;
use LetsGetFit\Auth\LoginCodes;
use LetsGetFit\Config;
use LetsGetFit\Mail\Mailer;
use LetsGetFit\RateLimiter;
use PDO;

/**
 * /api/account.php?action=...
 *
 * GET  me | pull[&since=] | export
 * POST request-code | verify-code | login | set-password | logout | logout-everywhere | push | delete
 *
 * Sign-in is by a 6-digit code sent by email; a password can be added later to skip the code.
 * Every POST needs JSON, the session's CSRF token in X-CSRF-Token, and (if sent) a same-origin
 * Origin header. Responses never reveal whether an email address has an account. No personal
 * data, codes or passwords are logged.
 */
final class AccountController
{
    public function __construct(
        private PDO $pdo,
        private SessionManager $session,
        private Mailer $mailer,
        private RateLimiter $limiter,
        private Config $config,
        private LoginCodes $codes,
    ) {
    }

    /**
     * @param array<string, mixed> $server $_SERVER
     * @param array<string, mixed> $query  $_GET
     * @return array{0: int, 1: array<string, mixed>, 2: array<string, string>}
     */
    public function handle(array $server, array $query, string $rawBody): array
    {
        $this->session->start();
        $method = (string) ($server['REQUEST_METHOD'] ?? 'GET');
        $action = is_string($query['action'] ?? null) ? $query['action'] : '';
        $ip = (string) ($server['REMOTE_ADDR'] ?? '');

        if ($method === 'GET') {
            return match ($action) {
                'me' => $this->me(),
                'pull' => $this->withUser(fn (string $uid) => $this->pull($uid, $query)),
                'export' => $this->withUser(fn (string $uid) => $this->export($uid)),
                default => self::error(404, 'unknown_action', 'Unknown action.'),
            };
        }
        if ($method !== 'POST') {
            return self::error(405, 'method_not_allowed', 'Use GET or POST.');
        }
        [$ok, $body] = self::readPost($server, $rawBody, $this->session, $this->config);
        if (!$ok) {
            return $body;
        }

        return match ($action) {
            'request-code' => $this->requestCode($body, $ip),
            'verify-code' => $this->verifyCode($body, $ip),
            'login' => $this->login($body, $ip),
            'set-password' => $this->withUser(fn (string $uid) => $this->setPassword($uid, $body)),
            'logout' => $this->logout(),
            'logout-everywhere' => $this->withUser(fn (string $uid) => $this->logoutEverywhere($uid)),
            'push' => $this->withUser(fn (string $uid) => $this->push($uid, $body, $ip)),
            'delete' => $this->withUser(fn (string $uid) => $this->delete($uid, $body)),
            default => self::error(404, 'unknown_action', 'Unknown action.'),
        };
    }

    /**
     * Shared checks for every POST: same origin, JSON, CSRF token, size, valid JSON object.
     *
     * @return array{0: bool, 1: array<mixed>} [true, body] or [false, error response]
     */
    public static function readPost(array $server, string $rawBody, SessionManager $session, Config $config): array
    {
        if (!self::sameOrigin($server, $config)) {
            return [false, self::error(403, 'bad_origin', 'This request did not come from LetsGetFit.')];
        }
        if (!str_starts_with(strtolower((string) ($server['CONTENT_TYPE'] ?? '')), 'application/json')) {
            return [false, self::error(415, 'json_required', 'Send JSON.')];
        }
        if (!$session->checkCsrf(isset($server['HTTP_X_CSRF_TOKEN']) ? (string) $server['HTTP_X_CSRF_TOKEN'] : null)) {
            return [false, self::error(403, 'csrf', 'Your session has expired. Reload the page and try again.')];
        }
        if (strlen($rawBody) > 2_000_000) {
            return [false, self::error(413, 'too_large', 'That request is too large.')];
        }
        $body = $rawBody === '' ? [] : json_decode($rawBody, true, 32);
        if (!is_array($body)) {
            return [false, self::error(400, 'bad_json', 'The request could not be read.')];
        }

        return [true, $body];
    }

    /* ---------------- Session state ---------------- */

    private function me(): array
    {
        $uid = $this->session->userId($this->pdo);
        $user = null;
        if ($uid !== null) {
            $stmt = $this->pdo->prepare('SELECT email, role, password_hash, created_at, last_login_at FROM users WHERE id = ?');
            $stmt->execute([$uid]);
            $row = $stmt->fetch();
            $user = $row ? [
                'email' => $row['email'],
                'role' => $row['role'] === 'admin' ? 'admin' : 'user',
                'hasPassword' => $row['password_hash'] !== null && $row['password_hash'] !== '',
                'createdAt' => $row['created_at'],
                'lastLoginAt' => $row['last_login_at'],
                'canSetPasswordWithoutCurrent' => $this->session->recentCodeLogin(),
            ] : null;
        }

        return [200, [
            'enabled' => true,
            'user' => $user,
            'csrfToken' => $this->session->csrfToken(),
            'signupsOpen' => $this->config->bool('signups_open'),
            'privacyContact' => $this->config->string('privacy_contact_email') ?: null,
        ], ['Cache-Control' => 'no-store']];
    }

    /* ---------------- Email codes ---------------- */

    private function requestCode(array $body, string $ip): array
    {
        $email = self::email($body['email'] ?? null);
        if ($email === null) {
            return self::error(422, 'invalid_email', 'Enter a valid email address.', [], 'email');
        }
        if ($wait = $this->limit("code:ip:$ip", 20, 3600)) {
            return self::rateLimited($wait);
        }
        $generic = [200, ['ok' => true, 'message' => 'We have emailed a 6-digit code to ' . $email . '. It expires in 10 minutes. Check your spam folder if it does not arrive.'], []];
        // Per address, so nobody can flood someone else's inbox. Same answer either way.
        if ($this->limit('code:email:' . $email, 5, 3600)) {
            return $generic;
        }
        $user = $this->findUser($email);
        if ($user !== null && $user['disabled_at'] !== null) {
            return $generic;
        }
        if ($user === null && !$this->config->bool('signups_open') && !$this->isAdminEmail($email)) {
            $this->trySend($email, 'LetsGetFit sign-ups are paused', "Someone (hopefully you) asked to join LetsGetFit with this email address. New accounts are paused at the moment, so no account was created.\n\nThe app still works fully without an account at {$this->url('')}.\n\nIf this was not you, you can ignore this email.");

            return $generic;
        }
        $code = $this->codes->issue($email);
        $intro = $user === null
            ? 'Use this code to create your LetsGetFit account:'
            : 'Use this code to log in to LetsGetFit:';
        $this->trySend($email, "Your LetsGetFit code: $code", "$intro\n\n    $code\n\nIt expires in 10 minutes and works once. Never share it: LetsGetFit will never ask you for it.\n\nIf you did not ask for this, ignore this email and nothing will happen.");

        return $generic;
    }

    private function verifyCode(array $body, string $ip): array
    {
        $email = self::email($body['email'] ?? null);
        $code = is_string($body['code'] ?? null) ? preg_replace('/\s+/', '', $body['code']) : '';
        if ($email === null) {
            return self::error(422, 'invalid_email', 'Enter a valid email address.', [], 'email');
        }
        if ($wait = $this->limit("verify:ip:$ip", 30, 900)) {
            return self::rateLimited($wait);
        }
        if (!$this->codes->check($email, (string) $code)) {
            return self::error(401, 'invalid_code', 'That code is not right, or it has expired. Check the latest email, or ask for a new code.', [], 'code');
        }
        $user = $this->findUser($email);
        if ($user !== null && $user['disabled_at'] !== null) {
            $this->codes->consume($email);

            return self::error(401, 'invalid_code', 'That code is not right, or it has expired. Check the latest email, or ask for a new code.', [], 'code');
        }
        $role = $this->isAdminEmail($email) ? 'admin' : null;
        if ($user === null) {
            // The code proves the address. Consent is asked for before anything is stored.
            if (($body['healthConsent'] ?? false) !== true) {
                return self::error(409, 'consent_required', 'To create an account that stores your health and fitness data, tick the consent box.', [], 'healthConsent');
            }
            if (!$this->config->bool('signups_open') && $role === null) {
                $this->codes->consume($email);

                return self::error(403, 'signups_closed', 'New accounts are paused at the moment. The app still works fully on this device.');
            }
            $id = self::uuid();
            $this->pdo->prepare('INSERT INTO users (id, email, password_hash, role, email_verified_at, health_consent_at, created_at, updated_at) VALUES (?, ?, NULL, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())')
                ->execute([$id, $email, $role ?? 'user']);
            $user = $this->findUser($email);
            $created = true;
        } else {
            $created = false;
            if ($role === 'admin' && $user['role'] !== 'admin') {
                $this->pdo->prepare("UPDATE users SET role = 'admin', updated_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$user['id']]);
            }
        }
        $this->codes->consume($email);
        $this->pdo->prepare('UPDATE users SET last_login_at = UTC_TIMESTAMP(), email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ?')->execute([$user['id']]);
        $this->session->login((string) $user['id'], (int) $user['session_version'], 'code');
        if ($created) {
            Audit::log($this->pdo, (string) $user['id'], 'account.created');
        }

        return [200, ['ok' => true, 'created' => $created, 'csrfToken' => $this->session->csrfToken()], []];
    }

    /* ---------------- Passwords ---------------- */

    private function login(array $body, string $ip): array
    {
        $email = self::email($body['email'] ?? null) ?? '';
        if ($wait = $this->limit("login:ip:$ip", 20, 900)) {
            return self::rateLimited($wait);
        }
        if ($wait = $this->limit('login:email:' . $email, 8, 900)) {
            return self::rateLimited($wait);
        }
        // Daily cap per address: with short passwords and PINs allowed, this bounds guessing.
        if ($wait = $this->limit('login:email-day:' . $email, 30, 86400)) {
            return self::error(429, 'rate_limited', 'Too many password attempts today. Log in with an email code instead.', ['Retry-After' => (string) $wait]);
        }
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        $user = $email === '' ? null : $this->findUser($email);
        $hash = $user !== null && is_string($user['password_hash']) && $user['password_hash'] !== '' ? $user['password_hash'] : null;
        $ok = Passwords::verify($password, $hash ?? Passwords::dummyHash());
        if ($user === null || $hash === null || !$ok || $user['disabled_at'] !== null) {
            return self::error(401, 'invalid_credentials', 'That email and password do not match. Check them, or log in with an email code instead.');
        }
        if (Passwords::needsRehash($hash)) {
            $this->pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([Passwords::hash($password), $user['id']]);
        }
        $this->pdo->prepare('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$user['id']]);
        $this->session->login((string) $user['id'], (int) $user['session_version'], 'password');

        return [200, ['ok' => true, 'csrfToken' => $this->session->csrfToken()], []];
    }

    private function setPassword(string $uid, array $body): array
    {
        if ($wait = $this->limit("set-password:user:$uid", 10, 3600)) {
            return self::rateLimited($wait);
        }
        $stmt = $this->pdo->prepare('SELECT email, password_hash, session_version FROM users WHERE id = ?');
        $stmt->execute([$uid]);
        $user = $stmt->fetch();
        if (!$user) {
            return self::error(401, 'not_logged_in', 'Log in to continue.');
        }
        $remove = ($body['remove'] ?? false) === true;
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        $current = is_string($body['currentPassword'] ?? null) ? $body['currentPassword'] : '';
        $hasPassword = is_string($user['password_hash']) && $user['password_hash'] !== '';
        // Changing an existing password needs the old one, unless the user has just proved their
        // email address with a code (that is how a forgotten password is replaced).
        if ($hasPassword && !$this->session->recentCodeLogin() && !Passwords::verify($current, (string) $user['password_hash'])) {
            return self::error(401, 'invalid_credentials', 'Your current password is not correct. If you have forgotten it, log out and log in with an email code, then set a new one.', [], 'currentPassword');
        }
        if (!$hasPassword && !$remove && !$this->session->recentCodeLogin()) {
            return self::error(403, 'reauth_required', 'For your security, log in again with an email code, then add a password within 15 minutes.');
        }
        if ($remove) {
            $this->pdo->prepare('UPDATE users SET password_hash = NULL, session_version = session_version + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$uid]);
            $message = 'Your password has been removed. You will log in with an email code. Other devices have been logged out.';
        } else {
            if ($problem = Passwords::problem($password, (string) $user['email'])) {
                return self::error(422, 'weak_password', $problem, [], 'password');
            }
            $this->pdo->prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?')->execute([Passwords::hash($password), $uid]);
            $message = $hasPassword
                ? 'Your password has been changed. Other devices have been logged out.'
                : 'Your password is saved. Next time you can log in with it instead of a code. Other devices have been logged out.';
        }
        // Every other device logs out; this one stays logged in.
        $this->session->refreshVersion((int) $user['session_version'] + 1);
        Audit::log($this->pdo, $uid, $remove ? 'password.removed' : 'password.set');
        $this->trySend((string) $user['email'], 'Your LetsGetFit password was changed', "The password for your LetsGetFit account was just " . ($remove ? 'removed' : 'set or changed') . ".\n\nIf this was you, you do not need to do anything. If it was not, log in with an email code at {$this->url('#account')} and use \"Log out everywhere\".");

        return [200, ['ok' => true, 'message' => $message], []];
    }

    private function logout(): array
    {
        $this->session->logout();

        return [200, ['ok' => true, 'csrfToken' => $this->session->csrfToken()], []];
    }

    private function logoutEverywhere(string $uid): array
    {
        $this->pdo->prepare('UPDATE users SET session_version = session_version + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$uid]);
        $this->session->logout();

        return [200, ['ok' => true, 'message' => 'You have been logged out on every device.', 'csrfToken' => $this->session->csrfToken()], []];
    }

    /* ---------------- Sync, export and deletion ---------------- */

    private function pull(string $uid, array $query): array
    {
        $since = null;
        if (isset($query['since']) && is_string($query['since']) && $query['since'] !== '') {
            if (!RecordStore::validCursor($query['since'])) {
                return self::error(400, 'bad_cursor', 'Invalid sync position.');
            }
            $since = $query['since'];
        }

        return [200, (new RecordStore($this->pdo))->pull($uid, $since), ['Cache-Control' => 'no-store']];
    }

    private function push(string $uid, array $body, string $ip): array
    {
        if ($wait = $this->limit("push:user:$uid", 240, 3600)) {
            return self::rateLimited($wait);
        }
        $records = $body['records'] ?? null;
        if (!is_array($records) || !array_is_list($records)) {
            return self::error(400, 'bad_records', 'Send a list of records.');
        }
        if (count($records) > RecordStore::MAX_PUSH) {
            return self::error(413, 'too_many_records', 'Send at most ' . RecordStore::MAX_PUSH . ' records at a time.');
        }

        return [200, (new RecordStore($this->pdo))->push($uid, $records), []];
    }

    private function export(string $uid): array
    {
        $stmt = $this->pdo->prepare('SELECT email, role, email_verified_at, health_consent_at, created_at, last_login_at FROM users WHERE id = ?');
        $stmt->execute([$uid]);
        $account = $stmt->fetch() ?: [];

        return [200, [
            'app' => 'LetsGetFit',
            'exportedAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'account' => [
                'email' => $account['email'] ?? null,
                'emailVerifiedAt' => $account['email_verified_at'] ?? null,
                'healthConsentAt' => $account['health_consent_at'] ?? null,
                'createdAt' => $account['created_at'] ?? null,
                'lastLoginAt' => $account['last_login_at'] ?? null,
                'role' => $account['role'] ?? null,
            ],
            'data' => (new RecordStore($this->pdo))->export($uid),
        ], ['Cache-Control' => 'no-store', 'Content-Disposition' => 'attachment; filename="letsgetfit-account.json"']];
    }

    private function delete(string $uid, array $body): array
    {
        if ($wait = $this->limit("delete:user:$uid", 5, 3600)) {
            return self::rateLimited($wait);
        }
        $stmt = $this->pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
        $stmt->execute([$uid]);
        $hash = $stmt->fetchColumn();
        if ($hash === false) {
            return self::error(401, 'not_logged_in', 'Log in to continue.');
        }
        if (($body['confirm'] ?? null) !== 'DELETE') {
            return self::error(422, 'confirm_required', 'Type DELETE to confirm.', [], 'confirm');
        }
        // A password if there is one; otherwise a code login in the last 15 minutes.
        if (is_string($hash) && $hash !== '') {
            $password = is_string($body['password'] ?? null) ? $body['password'] : '';
            if (!Passwords::verify($password, $hash)) {
                return self::error(401, 'invalid_credentials', 'That password is not correct.', [], 'password');
            }
        } elseif (!$this->session->recentCodeLogin()) {
            return self::error(403, 'reauth_required', 'For your security, log in again with an email code, then delete the account within 15 minutes.');
        }
        // Foreign keys remove the user's records with the account.
        $this->pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
        Audit::log($this->pdo, null, 'account.deleted');
        $this->session->logout();

        return [200, ['ok' => true, 'message' => 'Your account and all data stored in it have been deleted. Data on this device has not been changed.', 'csrfToken' => $this->session->csrfToken()], []];
    }

    /* ---------------- Helpers ---------------- */

    private function withUser(callable $fn): array
    {
        $uid = $this->session->userId($this->pdo);
        if ($uid === null) {
            return self::error(401, 'not_logged_in', 'Log in to continue.');
        }

        return $fn($uid);
    }

    /** @return array<string, mixed>|null */
    private function findUser(string $email): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, email, password_hash, role, disabled_at, session_version FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $row = $stmt->fetch();

        return $row ?: null;
    }

    private function isAdminEmail(string $email): bool
    {
        $admin = self::email($this->config->string('admin_email'));

        return $admin !== null && hash_equals($admin, $email);
    }

    public static function sameOrigin(array $server, Config $config): bool
    {
        $origin = $server['HTTP_ORIGIN'] ?? null;
        if (!is_string($origin) || $origin === '') {
            return true; // not sent: CSRF token + JSON content type still apply
        }
        $allowed = [rtrim($config->string('app_url'), '/')];
        $host = (string) ($server['HTTP_HOST'] ?? '');
        if ($host !== '') {
            $scheme = (($server['HTTPS'] ?? '') !== '' && ($server['HTTPS'] ?? '') !== 'off') ? 'https' : 'http';
            $allowed[] = $scheme . '://' . $host;
        }

        return in_array(rtrim($origin, '/'), $allowed, true);
    }

    private function limit(string $key, int $limit, int $window): int
    {
        return $this->limiter->hitVisitor($key, $limit, $window);
    }

    private function trySend(string $to, string $subject, string $text): void
    {
        try {
            $this->mailer->send($to, $subject, $text);
        } catch (\Throwable $e) {
            error_log('LetsGetFit mail error: ' . $e::class);
        }
    }

    private function url(string $fragment): string
    {
        return rtrim($this->config->string('app_url'), '/') . '/' . $fragment;
    }

    public static function email(mixed $raw): ?string
    {
        if (!is_string($raw)) {
            return null;
        }
        $email = mb_strtolower(trim($raw));
        if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return null;
        }

        return $email;
    }

    public static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        $h = bin2hex($b);

        return sprintf('%s-%s-%s-%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 12, 4), substr($h, 16, 4), substr($h, 20));
    }

    public static function rateLimited(int $wait): array
    {
        return self::error(429, 'rate_limited', 'Too many attempts. Wait a little and try again.', ['Retry-After' => (string) $wait]);
    }

    /**
     * @param array<string, string> $headers
     * @return array{0: int, 1: array<string, mixed>, 2: array<string, string>}
     */
    public static function error(int $status, string $code, string $message, array $headers = [], ?string $field = null): array
    {
        $body = ['error' => $code, 'message' => $message];
        if ($field !== null) {
            $body['field'] = $field;
        }

        return [$status, $body, $headers + ['Cache-Control' => 'no-store']];
    }
}
