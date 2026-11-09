<?php

declare(strict_types=1);

namespace LetsGetFit\Auth;

use LetsGetFit\Db\Database;
use PDO;

/**
 * Single-use tokens for email verification and password reset. Only a SHA-256 hash of the token
 * is stored; the token itself exists only in the email link.
 */
final class Tokens
{
    public const VERIFY = 'verify';
    public const RESET = 'reset';
    public const TTL = [self::VERIFY => 48 * 3600, self::RESET => 3600];

    public function __construct(private PDO $pdo)
    {
    }

    public function issue(string $userId, string $purpose): string
    {
        // A new token replaces any earlier unused token for the same purpose.
        $this->pdo->prepare('DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL')->execute([$userId, $purpose]);
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $expires = gmdate('Y-m-d H:i:s', time() + self::TTL[$purpose]);
        $this->pdo->prepare('INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())')
            ->execute([$userId, $purpose, hash('sha256', $token), $expires]);

        return $token;
    }

    /** Marks the token used and returns its user ID, or null if invalid, expired or already used. */
    public function consume(string $token, string $purpose): ?string
    {
        if (!preg_match('/^[A-Za-z0-9_-]{30,64}$/', $token)) {
            return null;
        }
        $stmt = $this->pdo->prepare('SELECT id, user_id FROM auth_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()');
        $stmt->execute([hash('sha256', $token), $purpose]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        $update = $this->pdo->prepare('UPDATE auth_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ? AND used_at IS NULL');
        $update->execute([$row['id']]);
        if ($update->rowCount() !== 1) {
            return null; // used by a concurrent request
        }

        return (string) $row['user_id'];
    }

    public function prune(): void
    {
        $this->pdo->exec('DELETE FROM auth_tokens WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 7 DAY');
    }

    public static function now(): string
    {
        return Database::now();
    }
}
