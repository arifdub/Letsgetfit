<?php

declare(strict_types=1);

namespace LetsGetFit;

/** Small JSON file cache in the private storage folder (outside the web root). */
final class FileCache
{
    public function __construct(private string $dir, private int $ttlSeconds)
    {
    }

    /** @return array<mixed>|null */
    public function get(string $key): ?array
    {
        $file = $this->path($key);
        if (!is_file($file) || filemtime($file) < time() - $this->ttlSeconds) {
            return null;
        }
        $raw = @file_get_contents($file);
        $data = is_string($raw) ? json_decode($raw, true) : null;

        return is_array($data) ? $data : null;
    }

    /** @param array<mixed> $value */
    public function set(string $key, array $value): void
    {
        if (!$this->ensureDir()) {
            return; // caching is best-effort
        }
        $file = $this->path($key);
        $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($tmp, json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION)) !== false) {
            @rename($tmp, $file);
        }
        @unlink($tmp);
    }

    public function writable(): bool
    {
        return $this->ensureDir() && is_writable($this->dir);
    }

    private function ensureDir(): bool
    {
        return is_dir($this->dir) || @mkdir($this->dir, 0700, true);
    }

    private function path(string $key): string
    {
        return $this->dir . '/' . hash('sha256', $key) . '.json';
    }
}
