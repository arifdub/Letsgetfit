<?php

declare(strict_types=1);

namespace LetsGetFit\Auth;

/**
 * Password policy and hashing with PHP's maintained password API (Argon2id when available,
 * otherwise bcrypt). Policy follows NIST SP 800-63B: length over complexity rules, no forced
 * rotation, and a check against very common passwords.
 */
final class Passwords
{
    public const MIN_LENGTH = 12;
    public const MAX_LENGTH = 128;

    private const COMMON = [
        'password1234', 'password12345', 'passwordpassword', '123456789012', '1234567890123',
        'qwertyuiop12', 'iloveyou1234', 'letsgetfit123', 'letsgetfit2026', 'welcome12345',
        'administrator', 'aaaaaaaaaaaa', 'abcdefghijkl', 'changeme1234', 'football1234',
    ];

    /** @return string|null error message, or null if acceptable */
    public static function problem(string $password, string $email = ''): ?string
    {
        $length = mb_strlen($password);
        if ($length < self::MIN_LENGTH) {
            return 'Use at least ' . self::MIN_LENGTH . ' characters. A few unrelated words make a strong password.';
        }
        if ($length > self::MAX_LENGTH) {
            return 'Use ' . self::MAX_LENGTH . ' characters or fewer.';
        }
        if (self::algorithm() === PASSWORD_BCRYPT && strlen($password) > 72) {
            return 'Use 72 bytes or fewer.';
        }
        $lower = mb_strtolower($password);
        if (in_array($lower, self::COMMON, true) || preg_match('/^(.)\1+$/u', $password)) {
            return 'That password is too common. Choose something less predictable.';
        }
        $local = mb_strtolower(strstr($email, '@', true) ?: '');
        if ($local !== '' && mb_strlen($local) >= 4 && str_contains($lower, $local)) {
            return 'Do not include your email address in your password.';
        }

        return null;
    }

    public static function hash(string $password): string
    {
        return password_hash($password, self::algorithm());
    }

    public static function verify(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    public static function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, self::algorithm());
    }

    /** A real hash to verify against when the account does not exist, so timing is similar. */
    public static function dummyHash(): string
    {
        static $hash = null;

        return $hash ??= password_hash('not-a-real-password-' . bin2hex(random_bytes(8)), self::algorithm());
    }

    private static function algorithm(): string|int|null
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    }
}
