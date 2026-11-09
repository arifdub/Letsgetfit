<?php

declare(strict_types=1);

namespace LetsGetFit;

use LetsGetFit\Http\CurlHttpClient;

/** Wires the endpoints together and writes JSON responses. Called from public/api/*.php. */
final class Api
{
    public static function run(string $endpoint, string $privateDir): void
    {
        try {
            $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
            if ($method !== 'GET' && $method !== 'HEAD') {
                self::send(405, ['error' => 'method_not_allowed', 'message' => 'Use GET.'], ['Allow' => 'GET, HEAD']);

                return;
            }
            $config = Config::load($privateDir);
            [$status, $body, $headers] = match ($endpoint) {
                'foods' => self::foodSearch($config)->handle($_GET, (string) ($_SERVER['REMOTE_ADDR'] ?? '')),
                'health' => self::health($config),
                default => [404, ['error' => 'not_found'], []],
            };
            self::send($status, $body, $headers);
        } catch (\Throwable $e) {
            // Log the error type only: never request data, search text or secrets.
            error_log('LetsGetFit API error: ' . $e::class . ' in ' . basename($e->getFile()) . ':' . $e->getLine());
            self::send(500, ['error' => 'server_error', 'message' => 'Something went wrong. Add the food manually.']);
        }
    }

    public static function foodSearch(Config $config): FoodSearchController
    {
        $storage = $config->string('storage_dir');
        $secret = $config->string('hash_secret') !== '' ? $config->string('hash_secret') : hash('sha256', $config->fdcApiKey() . __DIR__);

        return new FoodSearchController(
            new FoodDataCentral(new CurlHttpClient(), $config),
            new FileCache($storage . '/cache', $config->int('cache_ttl_seconds')),
            new RateLimiter($storage . '/ratelimit', $secret),
            $config,
        );
    }

    /** @return array{0: int, 1: array<string, mixed>, 2: array<string, string>} */
    public static function health(Config $config): array
    {
        $curl = function_exists('curl_init');
        $storageOk = (new FileCache($config->string('storage_dir') . '/cache', 60))->writable();
        $foodSearch = !$curl ? 'unavailable' : ($config->usingDemoKey() ? 'demo-key' : 'configured');

        return [200, [
            'ok' => true,
            'php' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
            'extensions' => [
                'curl' => $curl,
                'json' => function_exists('json_encode'),
                'mbstring' => function_exists('mb_strlen'),
            ],
            'storageWritable' => $storageOk,
            'foodSearch' => $foodSearch,
        ], ['Cache-Control' => 'no-store']];
    }

    /**
     * @param array<string, mixed> $body
     * @param array<string, string> $headers
     */
    public static function send(int $status, array $body, array $headers = []): void
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('X-Content-Type-Options: nosniff');
            header('Referrer-Policy: no-referrer');
            foreach ($headers as $name => $value) {
                header($name . ': ' . $value);
            }
        }
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
            echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
        }
    }
}
