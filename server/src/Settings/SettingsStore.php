<?php

declare(strict_types=1);

namespace LetsGetFit\Settings;

use PDO;

/**
 * Admin-managed settings in the database. API keys are encrypted with libsodium (XSalsa20-Poly1305)
 * using a key derived from the app secret, so a database dump alone does not reveal them.
 * Only the names in FIELDS can be stored.
 */
final class SettingsStore
{
    /** name => [type, secret] */
    public const FIELDS = [
        'scan_provider' => ['enum:openai:claude:alternate', false],
        'openai_api_key' => ['secret', true],
        'anthropic_api_key' => ['secret', true],
        'fdc_api_key' => ['secret', true],
        'openai_model' => ['model', false],
        'anthropic_model' => ['model', false],
        'anthropic_effort' => ['enum:low:medium:high', false],
        'openai_price_input' => ['price', false],
        'openai_price_output' => ['price', false],
        'claude_price_input' => ['price', false],
        'claude_price_output' => ['price', false],
        'scan_enabled' => ['bool', false],
        'scan_daily_limit' => ['int:1:10000', false],
        'scan_per_visitor_per_day' => ['int:1:500', false],
        'signups_open' => ['bool', false],
        'push_enabled' => ['bool', false],
        'privacy_contact_email' => ['email', false],
    ];

    public function __construct(private PDO $pdo, private string $secret)
    {
    }

    public function canStoreSecrets(): bool
    {
        return function_exists('sodium_crypto_secretbox') && strlen($this->secret) >= 16;
    }

    /** @return array<string, mixed> decrypted, typed values for every stored setting */
    public function all(): array
    {
        $out = [];
        foreach ($this->pdo->query('SELECT name, value, is_secret FROM settings')->fetchAll() as $row) {
            $name = (string) $row['name'];
            if (!isset(self::FIELDS[$name])) {
                continue;
            }
            $value = (bool) $row['is_secret'] ? $this->decrypt((string) $row['value']) : (string) $row['value'];
            if ($value === null) {
                continue;
            }
            $out[$name] = self::cast($name, $value);
        }

        return $out;
    }

    /** Settings for display: secrets are masked to their last 4 characters. */
    public function masked(): array
    {
        $out = [];
        foreach ($this->all() as $name => $value) {
            $out[$name] = self::FIELDS[$name][1] ? ['set' => true, 'hint' => '…' . substr((string) $value, -4)] : $value;
        }

        return $out;
    }

    /**
     * @return string|null an error message, or null when saved
     */
    public function set(string $name, mixed $value, ?string $actorId): ?string
    {
        if (!isset(self::FIELDS[$name])) {
            return 'Unknown setting.';
        }
        [$type, $secret] = self::FIELDS[$name];
        if ($value === null || $value === '') {
            $this->pdo->prepare('DELETE FROM settings WHERE name = ?')->execute([$name]);

            return null;
        }
        $error = self::validate($type, $value);
        if ($error !== null) {
            return $error;
        }
        $stored = is_bool($value) ? ($value ? '1' : '0') : trim((string) $value);
        if ($type === 'price') {
            $stored = (string) round((float) $value, 4);
        }
        if ($secret) {
            if (!$this->canStoreSecrets()) {
                return 'Set the APP_HASH_SECRET secret before storing API keys here.';
            }
            $stored = $this->encrypt($stored);
        }
        $this->pdo->prepare('INSERT INTO settings (name, value, is_secret, updated_at, updated_by) VALUES (?, ?, ?, UTC_TIMESTAMP(), ?) ON DUPLICATE KEY UPDATE value = VALUES(value), is_secret = VALUES(is_secret), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)')
            ->execute([$name, $stored, $secret ? 1 : 0, $actorId]);

        return null;
    }

    public static function validate(string $type, mixed $value): ?string
    {
        if ($type === 'bool') {
            return is_bool($value) ? null : 'Expected on or off.';
        }
        if (str_starts_with($type, 'int:')) {
            [, $min, $max] = explode(':', $type);

            return (is_int($value) || (is_string($value) && ctype_digit($value))) && (int) $value >= (int) $min && (int) $value <= (int) $max ? null : "Enter a whole number from $min to $max.";
        }
        if (str_starts_with($type, 'enum:')) {
            $allowed = array_slice(explode(':', $type), 1);

            return is_string($value) && in_array($value, $allowed, true) ? null : 'Choose one of: ' . implode(', ', $allowed) . '.';
        }
        if ($type === 'price') {
            return (is_int($value) || is_float($value) || (is_string($value) && is_numeric($value))) && (float) $value >= 0 && (float) $value <= 1000
                ? null : 'Enter a price in US$ per million tokens, from 0 to 1000.';
        }
        if (!is_string($value)) {
            return 'Expected text.';
        }
        $v = trim($value);

        return match ($type) {
            'secret' => preg_match('/^[A-Za-z0-9_-]{8,300}$/', $v) ? null : 'That key has unexpected characters.',
            'model' => preg_match('/^[A-Za-z0-9._:-]{1,64}$/', $v) ? null : 'Enter a model name such as gpt-4o-mini.',
            'email' => filter_var($v, FILTER_VALIDATE_EMAIL) !== false ? null : 'Enter a valid email address.',
            default => 'Unsupported setting.',
        };
    }

    private static function cast(string $name, string $value): mixed
    {
        $type = self::FIELDS[$name][0];
        if ($type === 'bool') {
            return $value === '1';
        }
        if (str_starts_with($type, 'int:')) {
            return (int) $value;
        }
        if ($type === 'price') {
            return (float) $value;
        }

        return $value;
    }

    private function key(): string
    {
        return sodium_crypto_generichash('letsgetfit-settings-v1|' . $this->secret, '', SODIUM_CRYPTO_SECRETBOX_KEYBYTES);
    }

    private function encrypt(string $plain): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);

        return 'v1:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $this->key()));
    }

    private function decrypt(string $stored): ?string
    {
        if (!$this->canStoreSecrets() || !str_starts_with($stored, 'v1:')) {
            return null;
        }
        $raw = base64_decode(substr($stored, 3), true);
        if ($raw === false || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
            return null;
        }
        $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $this->key());

        return $plain === false ? null : $plain;
    }
}
