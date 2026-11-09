<?php

declare(strict_types=1);

namespace LetsGetFit;

/**
 * File-based rate limits that work on shared hosting (no Redis or APCu needed).
 *  - Per visitor: a sliding window keyed by an HMAC of the IP address (the IP itself is never stored).
 *  - Whole site: a counter per clock hour, to stay under the upstream API key limit.
 */
final class RateLimiter
{
    /** @var callable(): int */
    private $clock;

    public function __construct(private string $dir, private string $secret, ?callable $clock = null)
    {
        $this->clock = $clock ?? static fn (): int => time();
    }

    /** @return int seconds to wait, or 0 if the request is allowed (and is recorded) */
    public function hitVisitor(string $ip, int $limit, int $windowSeconds): int
    {
        $now = ($this->clock)();
        $file = $this->dir . '/v-' . hash_hmac('sha256', $ip, $this->secret) . '.json';

        return $this->withLock($file, function (array $hits) use ($now, $limit, $windowSeconds): array {
            $hits = array_values(array_filter($hits, static fn ($t) => is_int($t) && $t > $now - $windowSeconds));
            if (count($hits) >= $limit) {
                return [$hits, max(1, $hits[0] + $windowSeconds - $now)];
            }
            $hits[] = $now;

            return [$hits, 0];
        });
    }

    /** @return int seconds to wait, or 0 if allowed (and counted) */
    public function hitGlobal(int $perHour): int
    {
        $now = ($this->clock)();
        $file = $this->dir . '/global-' . gmdate('YmdH', $now) . '.json';

        return $this->withLock($file, function (array $data) use ($now, $perHour): array {
            $count = (int) ($data[0] ?? 0);
            if ($count >= $perHour) {
                return [[$count], 3600 - ($now % 3600)];
            }

            return [[$count + 1], 0];
        });
    }

    /**
     * @param callable(array<mixed>): array{0: array<mixed>, 1: int} $update
     */
    private function withLock(string $file, callable $update): int
    {
        if (!is_dir($this->dir) && !@mkdir($this->dir, 0700, true)) {
            return 0; // fail open: rate limiting must not take the feature down
        }
        $fh = @fopen($file, 'c+');
        if ($fh === false) {
            return 0;
        }
        try {
            flock($fh, LOCK_EX);
            $raw = stream_get_contents($fh);
            $data = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
            [$next, $wait] = $update(is_array($data) ? $data : []);
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, (string) json_encode($next));
            fflush($fh);

            return $wait;
        } finally {
            flock($fh, LOCK_UN);
            fclose($fh);
        }
    }

    /** Remove stale files (called occasionally). */
    public function prune(int $olderThanSeconds = 86400): void
    {
        $cutoff = ($this->clock)() - $olderThanSeconds;
        foreach (glob($this->dir . '/*.json') ?: [] as $file) {
            if (@filemtime($file) < $cutoff) {
                @unlink($file);
            }
        }
    }
}
