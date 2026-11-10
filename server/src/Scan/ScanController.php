<?php

declare(strict_types=1);

namespace LetsGetFit\Scan;

use LetsGetFit\Config;
use LetsGetFit\FileCache;
use LetsGetFit\FoodDataCentral;
use LetsGetFit\RateLimiter;
use LetsGetFit\UpstreamException;

/**
 * POST /api/scan.php  (multipart: photo)
 * Headers: X-Scan-Consent: yes   (the user confirmed sending the photo)
 *          X-Request-Id: <uuid>   (a repeated submission returns the first result, not a new charge)
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
    public const DISCLAIMER = 'Foods and amounts are suggestions from a photo and may be wrong. Check every item and amount. Nutrients come from the food database for what you confirm. A photo cannot show allergens, exact amounts or hidden ingredients.';

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
                foreach ([
                    ["scan:ip:$ip", $this->config->int('scan_per_visitor_per_10min'), 600],
                    ["scan:ip-day:$ip", $this->config->int('scan_per_visitor_per_day'), 86400],
                ] as [$key, $limit, $window]) {
                    if ($wait = $this->limiter->hitVisitor($key, max(1, $limit), $window)) {
                        return self::error(429, 'rate_limited', 'You have reached the photo scan limit for now. Add the food manually, or try again later.', ['Retry-After' => (string) $wait]);
                    }
                }
                if ($wait = $this->limiter->hitVisitor('scan:site', max(1, $this->config->int('scan_daily_limit')), 86400)) {
                    return self::error(503, 'daily_limit', 'Photo scanning has reached its daily limit. Add the food manually, or try again tomorrow.', ['Retry-After' => (string) $wait]);
                }

                $bytes = (string) file_get_contents($tmp);
                @unlink($tmp);
                $image = $this->images->process($bytes);
                unset($bytes);
                @set_time_limit(max(30, $this->config->int('scan_timeout_seconds'), $this->config->int('anthropic_timeout_seconds')) + 30);
                $started = microtime(true);
                try {
                    $result = $this->vision->analyse($image['jpeg']);
                } catch (ScanException $e) {
                    $this->stats?->scan($this->vision->key(), $this->vision->model(), (int) ((microtime(true) - $started) * 1000), $e->reason);
                    throw $e;
                }
                unset($image);
                $this->stats?->scan(
                    $this->vision->key(), $this->vision->model(), (int) ((microtime(true) - $started) * 1000), null,
                    $result['usage']['input'] ?? 0, $result['usage']['output'] ?? 0, count($result['items']), !$result['isFood'],
                );
                $this->tickets?->set('fb|' . hash('sha256', $ip . '|' . $requestId), ['provider' => $this->vision->key(), 'model' => $this->vision->model()]);

                $items = [];
                foreach ($result['items'] as $item) {
                    $item['candidates'] = $this->candidates($item['searchTerm']);
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

    /** Up to 3 food database matches; an empty list if the database is unavailable. */
    private function candidates(string $term): array
    {
        try {
            return array_slice($this->fdc->search($term, 'generic', 8), 0, 3);
        } catch (UpstreamException) {
            return [];
        }
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
