<?php

declare(strict_types=1);

namespace LetsGetFit\Auth;

use PDO;

/**
 * 6-digit email login codes. Stored only as keyed hashes (HMAC with the app secret), valid for
 * 10 minutes, at most 5 wrong guesses per code, and one live code per email address.
 */
final class LoginCodes
{
    public const TTL_SECONDS = 600;
    public const MAX_ATTEMPTS = 5;

    public function __construct(private PDO $pdo, private string $secret)
    {
    }

    public function emailHash(string $email): string
    {
        return hash_hmac('sha256', 'email|' . $email, $this->secret);
    }

    public function issue(string $email): string
    {
        $emailHash = $this->emailHash($email);
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $this->pdo->prepare('DELETE FROM login_codes WHERE email_hash = ?')->execute([$emailHash]);
        $this->pdo->prepare('INSERT INTO login_codes (email_hash, code_hash, expires_at, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())')
            ->execute([$emailHash, $this->codeHash($emailHash, $code), gmdate('Y-m-d H:i:s', time() + self::TTL_SECONDS)]);

        return $code;
    }

    /** True if the code is right. Wrong guesses count towards the limit; nothing is consumed. */
    public function check(string $email, string $code): bool
    {
        if (!preg_match('/^\d{6}$/', $code)) {
            return false;
        }
        $emailHash = $this->emailHash($email);
        $stmt = $this->pdo->prepare('SELECT id, code_hash FROM login_codes WHERE email_hash = ? AND expires_at > UTC_TIMESTAMP() AND attempts < ? ORDER BY id DESC LIMIT 1');
        $stmt->execute([$emailHash, self::MAX_ATTEMPTS]);
        $row = $stmt->fetch();
        if (!$row) {
            return false;
        }
        if (hash_equals((string) $row['code_hash'], $this->codeHash($emailHash, $code))) {
            return true;
        }
        $this->pdo->prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?')->execute([$row['id']]);

        return false;
    }

    public function consume(string $email): void
    {
        $this->pdo->prepare('DELETE FROM login_codes WHERE email_hash = ?')->execute([$this->emailHash($email)]);
    }

    public function prune(): int
    {
        return (int) $this->pdo->exec('DELETE FROM login_codes WHERE expires_at < UTC_TIMESTAMP()');
    }

    private function codeHash(string $emailHash, string $code): string
    {
        return hash_hmac('sha256', $emailHash . '|' . $code, $this->secret);
    }
}
