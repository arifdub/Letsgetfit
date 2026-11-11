<?php

declare(strict_types=1);

namespace LetsGetFit\Scan;

use LetsGetFit\Nutrients;
use LetsGetFit\Config;
use LetsGetFit\FileCache;
use LetsGetFit\FoodDataCentral;
use LetsGetFit\RateLimiter;
use LetsGetFit\UpstreamException;

/**
 * POST /api/scan.php  (multipart: photo)
 * Headers: X-Scan-Consent: yes   (the user confirmed sending the photo)
 *          X-Request-Id: <uuid>   (a repeated submission returns the first result, not a new charge)
 * POST /api/scan.php?action=describe  (JSON {text}; same headers) foods and amounts from a description
 * POST /api/scan.php?action=feedback  (JSON {requestId, kept, changed, removed, added})
 *          what the user did with the suggestions, counted per provider to compare them
 *
 * Flow: limits → consent → image check and re-encode (metadata removed) → AI suggestions (OpenAI
 * or Claude, as chosen in the settings) →
 * food database candidates for each suggestion → JSON. The photo is held in memory only and the
 * uploaded temporary file is deleted straight away. Nothing about the photo is logged.
 */
final class ScanController
{
    public const DISCLAIMER = 'Foods and amounts are suggestions and may be wrong. Check every item and amount. Nutrients come from the food database for what you confirm; a food with no database match uses a rough AI estimate, marked as such. A photo cannot show allergens, exact amounts or hidden ingredients.';

    public function __construct(
        private VisionProvider $vision,
        private FoodDataCentral $fdc,
        private ImageProcessor $images,
        private RateLimiter $limiter,
        private FileCache $results,
        private Config $config,
        private string $lockDir,
        private ?ScanStats $stats = null,
        private ?FileCache $tickets = null,
    ) {
    }

    /**
     * Foods and amounts from the person's own words. Same consent, limits, repeat protection and
     * database matching as a photo; the description is not stored or logged.
     * @param array<string, mixed> $server
     * @return array{0: int, 1: array<string, mixed>, 2: array<string, string>}
     */
    public function describe(array $server, string $rawBody): array
    {
        if (($server['REQUEST_METHOD'] ?? '') !== 'POST') {
            return self::error(405, 'method_not_allowed', 'Use POST.');
        }
        if (!$this->sameOrigin($server)) {
            return self::error(403, 'bad_origin', 'This request did not come from LetsGetFit.');
        }
        if (!$this->vision->configured()) {
            return self::error(503, 'not_configured', 'Describing food is not set up on this server yet. Add the food manually.');
        }
        if (($server['HTTP_X_SCAN_CONSENT'] ?? '') !== 'yes') {
            return self::error(400, 'consent_required', 'Confirm that you want to send this description for analysis first.');
        }
        $requestId = (string) ($server['HTTP_X_REQUEST_ID'] ?? '');
        if (!preg_match('/^[A-Za-z0-9-]{16,64}$/', $requestId)) {
            return self::error(400, 'bad_request', 'Missing request ID. Reload the page and try again.');
        }
        $body = strlen($rawBody) <= 8000 ? json_decode($rawBody, true) : null;
        $text = is_array($body) && is_string($body['text'] ?? null) ? $body['text'] : '';
        $text = trim((string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', ' ', $text));
        if (mb_strlen($text) < 3) {
            return self::error(422, 'too_short', 'Describe what you ate, for example “2 slices of toast with butter and a banana”.');
        }
        if (mb_strlen($text) > 1000) {
            return self::error(422, 'too_long', 'Keep the description under 1,000 characters, or split it into meals.');
        }
        $ip = (string) ($server['REMOTE_ADDR'] ?? '');
        $cacheKey = 'describe|' . hash('sha256', $ip . '|' . $requestId);
        if (($cached = $this->results->get($cacheKey)) !== null) {
            return [200, $cached + ['repeat' => true], ['Cache-Control' => 'no-store']];
        }
        $lock = $this->lock($cacheKey);
        if ($lock === null) {
            return self::error(409, 'in_progress', 'This description is already being analysed. Please wait.');
        }
        try {
            if (($cached = $this->results->get($cacheKey)) !== null) {
                return [200, $cached + ['repeat' => true], ['Cache-Control' => 'no-store']];
            }
            if ($limited = $this->checkLimits($ip)) {
                return $limited;
            }
            @set_time_limit(max(30, $this->config->int('scan_timeout_seconds'), $this->config->int('anthropic_timeout_seconds')) + 30);

            return $this->analyseAndMatch(fn (): array => $this->vision->analyseText($text), $cacheKey, $ip, $requestId);
        } catch (ScanException $e) {
            return self::error($e->status, $e->reason, $e->getMessage());
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** Per-visitor and site-wide limits, shared by photos and descriptions. */
    private function checkLimits(string $ip): ?array
    {
        foreach ([
            ["scan:ip:$ip", $this->config->int('scan_per_visitor_per_10min'), 600],
            ["scan:ip-day:$ip", $this->config->int('scan_per_visitor_per_day'), 86400],
        ] as [$key, $limit, $window]) {
            if ($wait = $this->limiter->hitVisitor($key, max(1, $limit), $window)) {
                return self::error(429, 'rate_limited', 'You have reached the limit for now. Add the food manually, or try again later.', ['Retry-After' => (string) $wait]);
            }
        }
        if ($wait = $this->limiter->hitVisitor('scan:site', max(1, $this->config->int('scan_daily_limit')), 86400)) {
            return self::error(503, 'daily_limit', 'The daily limit has been reached. Add the food manually, or try again tomorrow.', ['Retry-After' => (string) $wait]);
        }

        return null;
    }

    /**
     * Ask the AI, record statistics, match each food to the database, and cache the answer.
     * @param callable(): array $ask
     * @return array{0: int, 1: array<string, mixed>, 2: array<string, string>}
     */
    private function analyseAndMatch(callable $ask, string $cacheKey, string $ip, string $requestId): array
    {
        $started = microtime(true);
        try {
            $result = $ask();
        } catch (ScanException $e) {
            $this->stats?->scan($this->vision->key(), $this->vision->model(), (int) ((microtime(true) - $started) * 1000), $e->reason);
            throw $e;
        }
        $this->stats?->scan(
            $this->vision->key(), $this->vision->model(), (int) ((microtime(true) - $started) * 1000), null,
            $result['usage']['input'] ?? 0, $result['usage']['output'] ?? 0, count($result['items']), !$result['isFood'],
        );
        $this->tickets?->set('fb|' . hash('sha256', $ip . '|' . $requestId), ['provider' => $this->vision->key(), 'model' => $this->vision->model()]);
        $items = [];
        foreach ($result['items'] as $item) {
            $item['candidates'] = $this->candidates($item['searchTerm'], $item['name']);
            // No database match: offer the AI's own rough values, labelled as an estimate.
            if ($item['candidates'] === [] && is_array($item['estimate'] ?? null)) {
                $item['candidates'] = [self::estimateCandidate($item['name'], $item['preparation'], $item['estimate'])];
            }
            unset($item['estimate']);
            $items[] = $item;
        }
        $body = [
            'isFood' => $result['isFood'],
            'imageQuality' => $result['imageQuality'],
            'items' => $items,
            'questions' => $result['questions'],
            'disclaimer' => self::DISCLAIMER,
            'provider' => $this->vision->label(),
            'attribution' => 'Nutrient data: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.',
        ];
        $this->results->set($cacheKey, $body);

        return [200, $body, ['Cache-Control' => 'no-store']];
    }

    /**
     * Records what the user did with a scan's suggestions. Only counts, once per scan, for scans
     * this visitor made in the last day.
     * @param array<string, mixed> $server
     * @return array{0: int, 1: array<string, mixed>, 2: array<string, string>}
     */
    public function feedback(array $server, string $rawBody): array
    {
        if (($server['REQUEST_METHOD'] ?? '') !== 'POST') {
            return self::error(405, 'method_not_allowed', 'Use POST.');
        }
        if (!$this->sameOrigin($server)) {
            return self::error(403, 'bad_origin', 'This request did not come from LetsGetFit.');
        }
        $body = strlen($rawBody) <= 2000 ? json_decode($rawBody, true) : null;
        $requestId = is_array($body) && is_string($body['requestId'] ?? null) ? $body['requestId'] : '';
        if (!preg_match('/^[A-Za-z0-9-]{16,64}$/', $requestId) || $this->tickets === null || $this->stats === null) {
            return self::error(400, 'bad_request', 'Invalid request.');
        }
        $key = 'fb|' . hash('sha256', (string) ($server['REMOTE_ADDR'] ?? '') . '|' . $requestId);
        $ticket = $this->tickets->get($key);
        if (!is_array($ticket) || !is_string($ticket['provider'] ?? null)) {
            return [200, ['ok' => true, 'counted' => false], ['Cache-Control' => 'no-store']];
        }
        $this->tickets->set($key, []);
        $n = static fn (string $k): int => is_int($body[$k] ?? null) ? $body[$k] : 0;
        $this->stats->feedback($ticket['provider'], (string) $ticket['model'], $n('kept'), $n('changed'), $n('removed'), $n('added'));

        return [200, ['ok' => true, 'counted' => true], ['Cache-Control' => 'no-store']];
    }

    /**
     * @param array<string, mixed> $server
     * @param array<string, mixed> $files
     * @return array{0: int, 1: array<string, mixed>, 2: array<string, string>}
     */
    public function handle(array $server, array $files): array
    {
        if (($server['REQUEST_METHOD'] ?? '') !== 'POST') {
            return self::error(405, 'method_not_allowed', 'Use POST.');
        }
        $upload = $files['photo'] ?? null;
        $tmp = is_array($upload) && is_string($upload['tmp_name'] ?? null) ? $upload['tmp_name'] : '';
        try {
            if (!$this->sameOrigin($server)) {
                return self::error(403, 'bad_origin', 'This request did not come from LetsGetFit.');
            }
            if (!$this->vision->configured()) {
                return self::error(503, 'not_configured', 'Photo scanning is not set up on this server yet. Add the food manually.');
            }
            if (($server['HTTP_X_SCAN_CONSENT'] ?? '') !== 'yes') {
                return self::error(400, 'consent_required', 'Confirm that you want to send this photo for analysis first.');
            }
            $requestId = (string) ($server['HTTP_X_REQUEST_ID'] ?? '');
            if (!preg_match('/^[A-Za-z0-9-]{16,64}$/', $requestId)) {
                return self::error(400, 'bad_request', 'Missing request ID. Reload the page and try again.');
            }
            $ip = (string) ($server['REMOTE_ADDR'] ?? '');
            $cacheKey = 'scan|' . hash('sha256', $ip . '|' . $requestId);

            // A repeated submission (double tap, retry) gets the first result without a new charge.
            if (($cached = $this->results->get($cacheKey)) !== null) {
                return [200, $cached + ['repeat' => true], ['Cache-Control' => 'no-store']];
            }
            $lock = $this->lock($cacheKey);
            if ($lock === null) {
                return self::error(409, 'in_progress', 'This photo is already being analysed. Please wait.');
            }
            try {
                if (($cached = $this->results->get($cacheKey)) !== null) {
                    return [200, $cached + ['repeat' => true], ['Cache-Control' => 'no-store']];
                }
                if (!is_array($upload) || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || $tmp === '' || !is_file($tmp)) {
                    $code = is_array($upload) ? (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE) : UPLOAD_ERR_NO_FILE;

                    return in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
                        ? self::error(413, 'too_large', 'That photo is too large.')
                        : self::error(400, 'no_image', 'Choose a photo to scan.');
                }
                if ($limited = $this->checkLimits($ip)) {
                    return $limited;
                }

                $bytes = (string) file_get_contents($tmp);
                @unlink($tmp);
                $image = $this->images->process($bytes);
                unset($bytes);
                @set_time_limit(max(30, $this->config->int('scan_timeout_seconds'), $this->config->int('anthropic_timeout_seconds')) + 30);
                $jpeg = $image['jpeg'];
                unset($image);

                return $this->analyseAndMatch(fn (): array => $this->vision->analyse($jpeg), $cacheKey, $ip, $requestId);
            } finally {
                flock($lock, LOCK_UN);
                fclose($lock);
            }
        } catch (ScanException $e) {
            return self::error($e->status, $e->reason, $e->getMessage());
        } finally {
            if ($tmp !== '' && is_file($tmp)) {
                @unlink($tmp);
            }
        }
    }

    /**
     * Up to 3 food database matches. The AI's wording can be more specific than the database
     * ("cashews, whole and pieces" vs "Nuts, cashew nuts, raw"), so when a search finds nothing,
     * simpler wordings are tried: the food's name, then without preparation words, then singular.
     * At most 4 searches per item; an empty list if the database is unavailable.
     */
    private function candidates(string $term, string $name = ''): array
    {
        $tries = 0;
        foreach (self::searchVariants($term, $name) as $query) {
            if (++$tries > 4) {
                break;
            }
            try {
                $found = $this->fdc->search($query, $tries === 4 ? 'all' : 'generic', 8);
            } catch (UpstreamException) {
                return [];
            }
            if ($found !== []) {
                return array_slice($found, 0, 3);
            }
        }

        return [];
    }

    /**
     * A stand-in for a database food, built from the AI's rough per-100 g values. Other nutrients are unknown.
     * @param array<string, float> $estimate
     * @return array<string, mixed>
     */
    public static function estimateCandidate(string $name, string $preparation, array $estimate): array
    {
        $per100g = array_fill_keys(array_keys(Nutrients::UNITS), null);
        foreach ($estimate as $key => $value) {
            $per100g[$key] = $value;
        }

        return [
            'source' => 'ai-estimate',
            'sourceId' => 'ai-' . substr(hash('sha256', mb_strtolower($name)), 0, 16),
            'name' => mb_substr($name, 0, 80),
            'brand' => null,
            'kind' => 'generic',
            'dataType' => 'AI estimate',
            'preparation' => in_array($preparation, ['raw', 'cooked'], true) ? $preparation : 'unspecified',
            'basis' => '100g',
            'per100g' => $per100g,
            'nutrientUnits' => Nutrients::UNITS,
            'servingOptions' => [],
        ];
    }

    /** @return list<string> distinct search wordings, most specific first */
    public static function searchVariants(string $term, string $name = ''): array
    {
        $simplify = static function (string $s): string {
            $s = mb_strtolower($s);
            $s = (string) preg_replace('/\([^)]*\)/u', ' ', $s);
            $s = (string) preg_replace('/\b(raw|cooked|fresh|whole|pieces?|sliced|chopped|diced|boiled|fried|grilled|baked|roasted|steamed|plain|and|with|of|the|a|portion|serving|homemade|unsalted|salted)\b/u', ' ', $s);
            $s = (string) preg_replace('/[^\p{L}\p{N} ]+/u', ' ', $s);

            return trim((string) preg_replace('/\s+/u', ' ', $s));
        };
        $singular = static fn (string $s): string => implode(' ', array_map(
            static fn (string $w): string => mb_strlen($w) > 4 && str_ends_with($w, 'ies') ? mb_substr($w, 0, -3) . 'y'
                : (mb_strlen($w) > 3 && str_ends_with($w, 's') && !str_ends_with($w, 'ss') ? mb_substr($w, 0, -1) : $w),
            explode(' ', $s),
        ));
        $out = [];
        foreach ([$term, $name, $simplify($term), $simplify($name), $singular($simplify($term)), $singular($simplify($name))] as $q) {
            $q = trim($q);
            if (mb_strlen($q) >= 2 && !in_array(mb_strtolower($q), array_map('mb_strtolower', $out), true)) {
                $out[] = $q;
            }
        }

        return $out;
    }

    /** @return resource|null */
    private function lock(string $key)
    {
        if (!is_dir($this->lockDir) && !@mkdir($this->lockDir, 0700, true)) {
            return null;
        }
        $fh = @fopen($this->lockDir . '/' . hash('sha256', $key) . '.lock', 'c');
        if ($fh === false || !flock($fh, LOCK_EX | LOCK_NB)) {
            return null;
        }

        return $fh;
    }

    private function sameOrigin(array $server): bool
    {
        $origin = $server['HTTP_ORIGIN'] ?? null;
        if (!is_string($origin) || $origin === '') {
            return true;
        }
        $allowed = [rtrim($this->config->string('app_url'), '/')];
        $host = (string) ($server['HTTP_HOST'] ?? '');
        if ($host !== '') {
            $scheme = (($server['HTTPS'] ?? '') !== '' && ($server['HTTPS'] ?? '') !== 'off') ? 'https' : 'http';
            $allowed[] = $scheme . '://' . $host;
        }

        return in_array(rtrim($origin, '/'), $allowed, true);
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
