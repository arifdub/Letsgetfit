<?php

declare(strict_types=1);

namespace LetsGetFit\Auth;

use LetsGetFit\Config;
use PDO;

/**
 * PHP sessions stored as files in the private storage folder, with hardened cookie settings:
 * HttpOnly, Secure, SameSite=Lax and a __Host- prefix in production. The user's session_version
 * is stored in the session; bumping it in the database (password reset) logs out every device.
 */
final class SessionManager
{
    public function __construct(private Config $config, private string $storageDir)
    {
    }

    public function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $dir = $this->storageDir . '/sessions';
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        $lifetime = max(1, $this->config->int('session_days')) * 86400;
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        ini_set('session.sid_length', '48');
        ini_set('session.sid_bits_per_character', '6');
        ini_set('session.gc_maxlifetime', (string) $lifetime);
        session_save_path($dir);
        session_name($this->config->string('cookie_name') ?: '__Host-lgf_session');
        session_set_cookie_params([
            'lifetime' => $lifetime,
            'path' => '/',
            'secure' => $this->config->bool('cookie_secure'),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
        if (!isset($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
    }

    public function csrfToken(): string
    {
        return (string) ($_SESSION['csrf'] ?? '');
    }

    public function checkCsrf(?string $header): bool
    {
        $token = $this->csrfToken();

        return $token !== '' && is_string($header) && hash_equals($token, $header);
    }

    /** The logged-in user ID, or null. Checks the account still exists, is enabled and the session version matches. */
    public function userId(PDO $pdo): ?string
    {
        $id = $_SESSION['uid'] ?? null;
        $version = $_SESSION['sv'] ?? null;
        if (!is_string($id) || !is_int($version)) {
            return null;
        }
        $stmt = $pdo->prepare('SELECT session_version, disabled_at FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row || (int) $row['session_version'] !== $version || $row['disabled_at'] !== null) {
            $this->logout();

            return null;
        }

        return $id;
    }

    /** @param 'code'|'password' $method */
    public function login(string $userId, int $sessionVersion, string $method): void
    {
        session_regenerate_id(true);
        $_SESSION['uid'] = $userId;
        $_SESSION['sv'] = $sessionVersion;
        $_SESSION['method'] = $method;
        $_SESSION['auth_at'] = time();
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    /** Logged in with an email code in the last 15 minutes: allows setting a password without the old one. */
    public function recentCodeLogin(): bool
    {
        return ($_SESSION['method'] ?? '') === 'code' && is_int($_SESSION['auth_at'] ?? null) && time() - $_SESSION['auth_at'] < 900;
    }

    /** Keep this session valid after the user's session_version changes. */
    public function refreshVersion(int $sessionVersion): void
    {
        $_SESSION['sv'] = $sessionVersion;
    }

    public function logout(): void
    {
        unset($_SESSION['uid'], $_SESSION['sv'], $_SESSION['method'], $_SESSION['auth_at']);
        session_regenerate_id(true);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}
