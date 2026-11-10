<?php

declare(strict_types=1);

namespace LetsGetFit;

/** Settings from <private>/config/app.php merged over safe defaults. */
final class Config
{
    public const DEMO_KEY = 'DEMO_KEY';

    /** @param array<string, mixed> $values */
    private function __construct(private array $values)
    {
    }

    public static function load(string $privateDir): self
    {
        $defaults = [
            // USDA FoodData Central. Without a key, the public DEMO_KEY is used (very low limits).
            'fdc_api_key' => '',
            'fdc_base_url' => 'https://api.nal.usda.gov/fdc/v1',
            'storage_dir' => $privateDir . '/storage',
            'cache_ttl_seconds' => 7 * 24 * 3600,
            'connect_timeout_seconds' => 4,
            'timeout_seconds' => 8,
            // Per visitor (hashed IP address): requests per window.
            'rate_limit_requests' => 30,
            'rate_limit_window_seconds' => 300,
            // Whole site, per clock hour, to stay under the FoodData Central key limit (1,000/hour).
            'global_requests_per_hour' => 900,
            // Random secret used to hash IP addresses for rate limiting. Set one in production.
            'hash_secret' => '',

            // ---- Phase 4: optional accounts (off until the privacy review is done) ----
            'accounts_enabled' => false,
            'app_url' => 'https://letsgetfit.site',
            'db_dsn' => '',            // e.g. mysql:host=localhost;dbname=cpuser_letsgetfit;charset=utf8mb4
            'db_user' => '',
            'db_password' => '',
            'mail_transport' => 'outbox', // 'smtp' in production; 'outbox' writes emails to private storage
            'mail_from' => 'no-reply@letsgetfit.site',
            'mail_from_name' => 'LetsGetFit',
            'smtp_host' => '',
            'smtp_port' => 587,
            'smtp_user' => '',
            'smtp_password' => '',
            'smtp_secure' => 'tls',       // 'tls' (STARTTLS, port 587) or 'ssl' (port 465)
            'cookie_name' => '__Host-lgf_session',
            'cookie_secure' => true,
            'session_days' => 30,
            'admin_email' => '',          // whoever logs in with a code sent here becomes an admin
            'setup_token' => '',          // one-time database setup from the admin page
            'signups_open' => true,
            'privacy_contact_email' => '',

            // ---- Phase 5: AI meal scan (off unless an OpenAI API key is set) ----
            'openai_api_key' => '',
            'openai_base_url' => 'https://api.openai.com/v1',
            'openai_model' => 'gpt-4o-mini',     // any vision-capable chat model with structured outputs
            'openai_image_detail' => 'low',       // 'low' keeps cost per photo small and predictable
            'openai_max_output_tokens' => 900,
            'scan_timeout_seconds' => 30,
            'scan_max_upload_bytes' => 8000000,
            'scan_per_visitor_per_10min' => 5,
            'scan_per_visitor_per_day' => 20,
            'scan_daily_limit' => 100,             // whole site, rolling 24 hours: caps spending
            'scan_enabled' => true,                // admins can pause scanning without removing the key
        ];
        $file = $privateDir . '/config/app.php';
        $loaded = [];
        if (is_file($file)) {
            $loaded = require $file;
            if (!is_array($loaded)) {
                $loaded = [];
            }
        }

        return new self(array_merge($defaults, array_intersect_key($loaded, $defaults)));
    }

    /** @param array<string, mixed> $values */
    public static function fromArray(array $values): self
    {
        return new self($values);
    }

    /** A copy with admin-managed settings applied on top (only known keys). */
    public function withOverrides(array $overrides): self
    {
        return new self(array_merge($this->values, array_intersect_key($overrides, $this->values)));
    }

    public function string(string $key): string
    {
        $v = $this->values[$key] ?? '';

        return is_string($v) ? $v : '';
    }

    public function bool(string $key): bool
    {
        return ($this->values[$key] ?? false) === true;
    }

    public function int(string $key): int
    {
        $v = $this->values[$key] ?? 0;

        return is_numeric($v) ? (int) $v : 0;
    }

    public function fdcApiKey(): string
    {
        $key = trim($this->string('fdc_api_key'));

        return $key !== '' ? $key : self::DEMO_KEY;
    }

    public function usingDemoKey(): bool
    {
        return $this->fdcApiKey() === self::DEMO_KEY;
    }
}
