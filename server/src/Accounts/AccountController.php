<?php

declare(strict_types=1);

namespace LetsGetFit\Accounts;

use LetsGetFit\Auth\Passwords;
use LetsGetFit\Auth\SessionManager;
use LetsGetFit\Auth\Tokens;
use LetsGetFit\Config;
use LetsGetFit\Mail\Mailer;
use LetsGetFit\RateLimiter;
use PDO;

/**
 * /api/account.php?action=...
 *
 * GET  me | pull[&since=] | export
 * POST register | verify | resend | login | logout | request-reset | reset | push | delete
 *
 * Every POST needs JSON, the session's CSRF token in X-CSRF-Token, and (if sent) a same-origin
 * Origin header. Responses never reveal whether an email address has an account. No personal
 * data, tokens or passwords are logged.
 */
final class AccountController
{
    public function __construct(
        private PDO $pdo,
        private SessionManager $session,
        private Mailer $mailer,
        private RateLimiter $limiter,
        private Config $config,
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
        if (!$this->sameOrigin($server)) {
            return self::error(403, 'bad_origin', 'This request did not come from LetsGetFit.');
        }
        if (!str_starts_with(strtolower((string) ($server['CONTENT_TYPE'] ?? '')), 'application/json')) {
            return self::error(415, 'json_required', 'Send JSON.');
        }
        if (!$this->session->checkCsrf(isset($server['HTTP_X_CSRF_TOKEN']) ? (string) $server['HTTP_X_CSRF_TOKEN'] : null)) {
            return self::error(403, 'csrf', 'Your session has expired. Reload the page and try again.');
        }
        if (strlen($rawBody) > 2_000_000) {
            return self::error(413, 'too_large', 'That request is too large.');
        }
        $body = $rawBody === '' ? [] : json_decode($rawBody, true, 32);
        if (!is_array($body)) {
            return self::error(400, 'bad_json', 'The request could not be read.');
        }

        return match ($action) {
            'register' => $this->register($body, $ip),
            'verify' => $this->verify($body),
            'resend' => $this->resend($body, $ip),
            'login' => $this->login($body, $ip),
            'logout' => $this->logout(),
            'request-reset' => $this->requestReset($body, $ip),
            'reset' => $this->reset($body, $ip),
            'push' => $this->withUser(fn (string $uid) => $this->push($uid, $body, $ip)),
            'delete' => $this->withUser(fn (string $uid) => $this->delete($uid, $body, $ip)),
            default => self::error(404, 'unknown_action', 'Unknown action.'),
        };
    }

    /* ---------------- Session state ---------------- */

    private function me(): array
    {
        $uid = $this->session->userId($this->pdo);
        $user = null;
        if ($uid !== null) {
            $stmt = $this->pdo->prepare('SELECT email, email_verified_at, created_at FROM users WHERE id = ?');
            $stmt->execute([$uid]);
            $row = $stmt->fetch();
            $user = $row ? ['email' => $row['email'], 'verified' => $row['email_verified_at'] !== null, 'createdAt' => $row['created_at']] : null;
        }

        return [200, ['enabled' => true, 'user' => $user, 'csrfToken' => $this->session->csrfToken()], ['Cache-Control' => 'no-store']];
    }

    /* ---------------- Registration and verification ---------------- */

    private function register(array $body, string $ip): array
    {
        $email = self::email($body['email'] ?? null);
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        if ($email === null) {
            return self::error(422, 'invalid_email', 'Enter a valid email address.', [], 'email');
        }
        if ($problem = Passwords::problem($password, $email)) {
            return self::error(422, 'weak_password', $problem, [], 'password');
        }
        if (($body['healthConsent'] ?? false) !== true) {
            return self::error(422, 'consent_required', 'To store your health and fitness data in an account, tick the consent box.', [], 'healthConsent');
        }
        $generic = [200, ['ok' => true, 'message' => 'Check your email for a link to confirm your address. It can take a few minutes.'], []];
        // Counted only once the form is valid, so typing mistakes do not use up the allowance.
        if ($wait = $this->limit("register:ip:$ip", 10, 3600)) {
            return self::rateLimited($wait);
        }

        $stmt = $this->pdo->prepare('SELECT id, email_verified_at FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $existing = $stmt->fetch();
        if ($existing) {
            // Same response either way, so this form cannot be used to find out who has an account.
            $this->trySend($email, 'Someone tried to create a LetsGetFit account', "Someone (hopefully you) tried to create a LetsGetFit account with this email address, but you already have one.\n\nTo log in, go to {$this->url('#settings')}. If you have forgotten your password, use \"Forgot password\" there.\n\nIf this was not you, you can ignore this email.");

            return $generic;
        }
        $id = self::uuid();
        $this->pdo->prepare('INSERT INTO users (id, email, password_hash, health_consent_at, created_at, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())')
            ->execute([$id, $email, Passwords::hash($password)]);
        $this->sendVerification($id, $email);

        return $generic;
    }

    private function sendVerification(string $userId, string $email): void
    {
        $token = (new Tokens($this->pdo))->issue($userId, Tokens::VERIFY);
        $this->trySend($email, 'Confirm your LetsGetFit email address', "Confirm your email address to finish setting up your LetsGetFit account:\n\n{$this->url('#account/verify?token=' . $token)}\n\nThe link works once and expires in 48 hours. If you did not create an account, ignore this email and nothing will happen.");
    }

    private function verify(array $body): array
    {
        $token = is_string($body['token'] ?? null) ? $body['token'] : '';
        $uid = (new Tokens($this->pdo))->consume($token, Tokens::VERIFY);
        if ($uid === null) {
            return self::error(400, 'invalid_token', 'This link is invalid, has expired or has already been used. Log in to get a new one.');
        }
        $this->pdo->prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()), updated_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$uid]);

        return [200, ['ok' => true, 'message' => 'Your email address is confirmed. You can now log in.'], []];
    }

    private function resend(array $body, string $ip): array
    {
        if ($wait = $this->limit("resend:ip:$ip", 5, 3600)) {
            return self::rateLimited($wait);
        }
        $email = self::email($body['email'] ?? null);
        if ($email !== null && !$this->limit('resend:email:' . $email, 3, 3600)) {
            $stmt = $this->pdo->prepare('SELECT id FROM users WHERE email = ? AND email_verified_at IS NULL');
            $stmt->execute([$email]);
            $id = $stmt->fetchColumn();
            if ($id !== false) {
                $this->sendVerification((string) $id, $email);
            }
        }

        return [200, ['ok' => true, 'message' => 'If that address has an unconfirmed account, we have sent a new link.'], []];
    }

    /* ---------------- Login and logout ---------------- */

    private function login(array $body, string $ip): array
    {
        $email = self::email($body['email'] ?? null) ?? '';
        if ($wait = $this->limit("login:ip:$ip", 20, 900)) {
            return self::rateLimited($wait);
        }
        if ($wait = $this->limit('login:email:' . $email, 8, 900)) {
            return self::rateLimited($wait);
        }
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        $stmt = $this->pdo->prepare('SELECT id, password_hash, email_verified_at, session_version FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        $ok = Passwords::verify($password, $user ? (string) $user['password_hash'] : Passwords::dummyHash());
        if (!$user || !$ok) {
            return self::error(401, 'invalid_credentials', 'That email and password do not match. Check them, or reset your password.');
        }
        if ($user['email_verified_at'] === null) {
            return self::error(403, 'email_not_verified', 'Confirm your email address first. Use the link we emailed you, or ask for a new one.');
        }
        if (Passwords::needsRehash((string) $user['password_hash'])) {
            $this->pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([Passwords::hash($password), $user['id']]);
        }
        $this->session->login((string) $user['id'], (int) $user['session_version']);

        return [200, ['ok' => true, 'csrfToken' => $this->session->csrfToken()], []];
    }

    private function logout(): array
    {
        $this->session->logout();

        return [200, ['ok' => true, 'csrfToken' => $this->session->csrfToken()], []];
    }

    /* ---------------- Password reset ---------------- */

    private function requestReset(array $body, string $ip): array
    {
        if ($wait = $this->limit("reset:ip:$ip", 10, 3600)) {
            return self::rateLimited($wait);
        }
        $email = self::email($body['email'] ?? null);
        if ($email !== null && !$this->limit('reset:email:' . $email, 3, 3600)) {
            $stmt = $this->pdo->prepare('SELECT id FROM users WHERE email = ?');
            $stmt->execute([$email]);
            $id = $stmt->fetchColumn();
            if ($id !== false) {
                $token = (new Tokens($this->pdo))->issue((string) $id, Tokens::RESET);
                $this->trySend($email, 'Reset your LetsGetFit password', "Use this link to choose a new password:\n\n{$this->url('#account/reset?token=' . $token)}\n\nThe link works once and expires in 1 hour. If you did not ask for this, ignore this email: your password will not change.");
            }
        }

        return [200, ['ok' => true, 'message' => 'If that address has an account, we have emailed a link to reset the password. It expires in 1 hour.'], []];
    }

    private function reset(array $body, string $ip): array
    {
        if ($wait = $this->limit("reset-confirm:ip:$ip", 10, 3600)) {
            return self::rateLimited($wait);
        }
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        $token = is_string($body['token'] ?? null) ? $body['token'] : '';
        $tokens = new Tokens($this->pdo);
        // Check the password before using up the token.
        if ($problem = Passwords::problem($password)) {
            return self::error(422, 'weak_password', $problem, [], 'password');
        }
        $uid = $tokens->consume($token, Tokens::RESET);
        if ($uid === null) {
            return self::error(400, 'invalid_token', 'This link is invalid, has expired or has already been used. Ask for a new one.');
        }
        // A reset also confirms the email address (the link was delivered to it) and logs out every device.
        $this->pdo->prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()), updated_at = UTC_TIMESTAMP() WHERE id = ?')
            ->execute([Passwords::hash($password), $uid]);
        $this->pdo->prepare("DELETE FROM auth_tokens WHERE user_id = ? AND purpose = 'reset'")->execute([$uid]);
        $this->session->logout();

        return [200, ['ok' => true, 'message' => 'Your password has been changed and you have been logged out everywhere. Log in with your new password.', 'csrfToken' => $this->session->csrfToken()], []];
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
        $stmt = $this->pdo->prepare('SELECT email, email_verified_at, health_consent_at, created_at FROM users WHERE id = ?');
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
            ],
            'data' => (new RecordStore($this->pdo))->export($uid),
        ], ['Cache-Control' => 'no-store', 'Content-Disposition' => 'attachment; filename="letsgetfit-account.json"']];
    }

    private function delete(string $uid, array $body, string $ip): array
    {
        if ($wait = $this->limit("delete:user:$uid", 5, 3600)) {
            return self::rateLimited($wait);
        }
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        $stmt = $this->pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
        $stmt->execute([$uid]);
        $hash = $stmt->fetchColumn();
        if ($hash === false || !Passwords::verify($password, (string) $hash)) {
            return self::error(401, 'invalid_credentials', 'That password is not correct.', [], 'password');
        }
        // Foreign keys remove the user's records and tokens with the account.
        $this->pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
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

    private function sameOrigin(array $server): bool
    {
        $origin = $server['HTTP_ORIGIN'] ?? null;
        if (!is_string($origin) || $origin === '') {
            return true; // not sent: CSRF token + JSON content type still apply
        }
        $allowed = [rtrim($this->config->string('app_url'), '/')];
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

    private static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        $h = bin2hex($b);

        return sprintf('%s-%s-%s-%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 12, 4), substr($h, 16, 4), substr($h, 20));
    }

    private static function rateLimited(int $wait): array
    {
        return self::error(429, 'rate_limited', 'Too many attempts. Wait a little and try again.', ['Retry-After' => (string) $wait]);
    }

    /**
     * @param array<string, string> $headers
     * @return array{0: int, 1: array<string, mixed>, 2: array<string, string>}
     */
    private static function error(int $status, string $code, string $message, array $headers = [], ?string $field = null): array
    {
        $body = ['error' => $code, 'message' => $message];
        if ($field !== null) {
            $body['field'] = $field;
        }

        return [$status, $body, $headers + ['Cache-Control' => 'no-store']];
    }
}
