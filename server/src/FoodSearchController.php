<?php

declare(strict_types=1);

namespace LetsGetFit;

/**
 * GET /api/foods.php?q=<text>&type=all|generic|branded
 * Returns { results: [...], source, attribution, cached } or { error, message }.
 * Search text is not logged.
 */
final class FoodSearchController
{
    public const MIN_QUERY = 2;
    public const MAX_QUERY = 100;
    private const CACHE_VERSION = 'v1';

    public function __construct(
        private FoodDataCentral $fdc,
        private FileCache $cache,
        private RateLimiter $limiter,
        private Config $config,
    ) {
    }

    /**
     * @param array<string, mixed> $query
     * @return array{0: int, 1: array<string, mixed>, 2: array<string, string>}  status, body, extra headers
     */
    public function handle(array $query, string $clientIp): array
    {
        $q = is_string($query['q'] ?? null) ? trim(preg_replace('/\s+/u', ' ', $query['q']) ?? '') : '';
        $type = is_string($query['type'] ?? null) && in_array($query['type'], ['all', 'generic', 'branded'], true) ? $query['type'] : 'all';
        $length = mb_strlen($q);
        if ($length < self::MIN_QUERY || $length > self::MAX_QUERY) {
            return self::error(400, 'invalid_query', 'Enter between 2 and 100 characters to search.');
        }
        if (preg_match('/[\x00-\x1F\x7F]/u', $q) || !mb_check_encoding($q, 'UTF-8')) {
            return self::error(400, 'invalid_query', 'The search contains characters that are not allowed.');
        }

        $cacheKey = implode('|', ['fdc-search', self::CACHE_VERSION, mb_strtolower($q), $type]);
        $cached = $this->cache->get($cacheKey);
        if ($cached !== null) {
            return [200, self::body($cached, true), ['Cache-Control' => 'private, max-age=300']];
        }

        $wait = $this->limiter->hitVisitor($clientIp, $this->config->int('rate_limit_requests'), $this->config->int('rate_limit_window_seconds'));
        if ($wait > 0) {
            return self::error(429, 'rate_limited', 'Too many searches in a short time. Wait a few minutes, or add the food manually.', ['Retry-After' => (string) $wait]);
        }
        $wait = $this->limiter->hitGlobal($this->config->int('global_requests_per_hour'));
        if ($wait > 0) {
            return self::error(503, 'upstream_busy', 'Food search is busy right now. Try again later, or add the food manually.', ['Retry-After' => (string) $wait]);
        }

        try {
            $results = $this->fdc->search($q, $type);
        } catch (UpstreamException $e) {
            return match ($e->reason) {
                UpstreamException::TIMEOUT => self::error(504, 'timeout', 'The food database took too long to answer. Try again, or add the food manually.'),
                UpstreamException::BUSY => self::error(503, 'upstream_busy', 'The food database is busy. Try again later, or add the food manually.'),
                UpstreamException::NOT_CONFIGURED => self::error(503, 'not_configured', 'Food search is not set up on this server yet. Add the food manually.'),
                default => self::error(502, 'upstream_unavailable', 'The food database is not available right now. Add the food manually.'),
            };
        }

        $this->cache->set($cacheKey, $results);
        if (random_int(1, 50) === 1) {
            $this->limiter->prune();
        }

        return [200, self::body($results, false), ['Cache-Control' => 'private, max-age=300']];
    }

    /** @param list<array<string, mixed>> $results @return array<string, mixed> */
    private static function body(array $results, bool $cached): array
    {
        return [
            'results' => $results,
            'source' => FoodDataCentral::SOURCE,
            'attribution' => 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov',
            'cached' => $cached,
        ];
    }

    /**
     * @param array<string, string> $headers
     * @return array{0: int, 1: array<string, mixed>, 2: array<string, string>}
     */
    private static function error(int $status, string $code, string $message, array $headers = []): array
    {
        return [$status, ['error' => $code, 'message' => $message], $headers + ['Cache-Control' => 'no-store']];
    }
}
