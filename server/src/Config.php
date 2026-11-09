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

    public function string(string $key): string
    {
        $v = $this->values[$key] ?? '';

        return is_string($v) ? $v : '';
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
