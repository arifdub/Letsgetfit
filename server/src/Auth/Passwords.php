<?php

declare(strict_types=1);

namespace LetsGetFit\Auth;

/**
 * Password policy and hashing with PHP's maintained password API (Argon2id when available,
 * otherwise bcrypt). At least 6 characters, so a 6-digit PIN is allowed; no complexity rules or
 * forced rotation, but very common passwords and obvious PINs (repeats, runs, 123123) are
 * refused. Short passwords rely on the login rate limits (per address, per 15 minutes and per
 * day) and on email-code login as the way back in.
 */
final class Passwords
{
    public const MIN_LENGTH = 6;
    public const MAX_LENGTH = 128;

    private const COMMON = [
        'password', 'passwort', 'qwerty', 'qwertz', 'azerty', 'abc123', 'abcdef', 'abcabc', 'letmein', 'iloveyou',
        'monkey', 'dragon', 'football', 'baseball', 'welcome', 'sunshine', 'princess', 'secret', 'admin', 'login',
        'master', 'shadow', 'trustno1', 'qwerty123', 'password1', 'password123', 'letsgetfit', '1q2w3e', '1q2w3e4r',
        '123qwe', 'qazwsx', 'zxcvbn', 'asdfgh', '696969', '112233', '102030', '159753', '147258', '121212',
        '123123', '131313', '232323', '199999', '200000', '000000', '111111', '123321', '654321', '123654',
        'password1234', 'password12345', 'passwordpassword', '123456789012', '1234567890123',
        'qwertyuiop12', 'iloveyou1234', 'letsgetfit123', 'letsgetfit2026', 'welcome12345',
        'administrator', 'aaaaaaaaaaaa', 'abcdefghijkl', 'changeme1234', 'football1234',
    ];

    /** @return string|null error message, or null if acceptable */
    public static function problem(string $password, string $email = ''): ?string
    {
        $length = mb_strlen($password);
        if ($length < self::MIN_LENGTH) {
            return 'Use at least ' . self::MIN_LENGTH . ' characters, or a 6-digit PIN. Longer is safer: a few unrelated words make a strong password.';
        }
        if ($length > self::MAX_LENGTH) {
            return 'Use ' . self::MAX_LENGTH . ' characters or fewer.';
        }
        if (self::algorithm() === PASSWORD_BCRYPT && strlen($password) > 72) {
            return 'Use 72 bytes or fewer.';
        }
        $lower = mb_strtolower($password);
        if (in_array($lower, self::COMMON, true) || preg_match('/^(.)\1+$/u', $password) || self::obviousPattern($lower)) {
            return ctype_digit($password)
                ? 'That PIN is too easy to guess. Avoid repeats, runs like 123456, and repeated pairs.'
                : 'That password is too common. Choose something less predictable.';
        }
        $local = mb_strtolower(strstr($email, '@', true) ?: '');
        if ($local !== '' && mb_strlen($local) >= 4 && str_contains($lower, $local)) {
            return 'Do not include your email address in your password.';
        }

        return null;
    }

    /** Runs (123456, 987654, abcdef) and short blocks repeated (121212, 123123, abcabc). */
    private static function obviousPattern(string $p): bool
    {
        $n = strlen($p);
        if ($n < 3 || $n > 12) {
            return false;
        }
        $up = $down = true;
        for ($i = 1; $i < $n; $i++) {
            $d = ord($p[$i]) - ord($p[$i - 1]);
            $up = $up && $d === 1;
            $down = $down && $d === -1;
        }
        if ($up || $down) {
            return true;
        }
        foreach ([2, 3, 4] as $block) {
            if ($n % $block === 0 && $n > $block && str_repeat(substr($p, 0, $block), intdiv($n, $block)) === $p) {
                return true;
            }
        }

        return false;
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
