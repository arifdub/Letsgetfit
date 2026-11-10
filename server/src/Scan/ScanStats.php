<?php

declare(strict_types=1);

namespace LetsGetFit\Scan;

use LetsGetFit\Config;

/**
 * Monthly totals per provider and model, to compare cost and usefulness in the admin panel.
 * Stored as small JSON files in private storage. Only counts and token totals: no photos, food
 * names, IP addresses or anything about a person.
 *
 * Usefulness comes from the user's own edits: when they save a scan, the app reports how many
 * suggestions they kept as they were, changed, or removed, and how many foods they had to add.
 */
final class ScanStats
{
    private const FIELDS = ['scans', 'ok', 'errors', 'notFood', 'ms', 'inputTokens', 'outputTokens', 'items',
        'feedback', 'kept', 'changed', 'removed', 'added'];

    public function __construct(private string $dir, private ?\Closure $clock = null)
    {
    }

    /** One scan attempt. $error is a reason code such as "timeout", or null when it worked. */
    public function scan(string $provider, string $model, int $ms, ?string $error, int $inputTokens = 0, int $outputTokens = 0, int $items = 0, bool $notFood = false): void
    {
        $this->add($provider, $model, [
            'scans' => 1,
            'ok' => $error === null ? 1 : 0,
            'errors' => $error === null ? 0 : 1,
            'notFood' => $notFood ? 1 : 0,
            'ms' => $error === null ? max(0, $ms) : 0, // average time to a result
            'inputTokens' => max(0, $inputTokens),
            'outputTokens' => max(0, $outputTokens),
            'items' => max(0, $items),
        ]);
    }

    /** What the user did with the suggestions when they saved. */
    public function feedback(string $provider, string $model, int $kept, int $changed, int $removed, int $added): void
    {
        $clamp = static fn (int $n): int => max(0, min(50, $n));
        $this->add($provider, $model, [
            'feedback' => 1, 'kept' => $clamp($kept), 'changed' => $clamp($changed), 'removed' => $clamp($removed), 'added' => $clamp($added),
        ]);
    }

    /**
     * Totals for a month (YYYY-MM), with averages and an estimated cost from the configured prices.
     * @return list<array<string, mixed>>
     */
    public function report(string $month, Config $config): array
    {
        $raw = @file_get_contents($this->file($month));
        $data = is_string($raw) ? json_decode($raw, true) : null;
        $out = [];
        foreach (is_array($data) ? $data : [] as $key => $row) {
            if (!is_array($row) || !str_contains((string) $key, '|')) {
                continue;
            }
            [$provider, $model] = explode('|', (string) $key, 2);
            $t = array_map('intval', array_intersect_key($row, array_flip(self::FIELDS))) + array_fill_keys(self::FIELDS, 0);
            [$pin, $pout] = $provider === 'claude'
                ? ClaudeVision::prices($config, $model)
                : [$config->float('openai_price_input'), $config->float('openai_price_output')];
            $cost = ($t['inputTokens'] * $pin + $t['outputTokens'] * $pout) / 1_000_000;
            $suggested = $t['kept'] + $t['changed'] + $t['removed'];
            $out[] = [
                'provider' => $provider,
                'model' => $model,
                'scans' => $t['scans'],
                'successRate' => $t['scans'] ? round($t['ok'] / $t['scans'], 3) : null,
                'avgSeconds' => $t['ok'] ? round($t['ms'] / $t['ok'] / 1000, 1) : null,
                'avgInputTokens' => $t['ok'] ? (int) round($t['inputTokens'] / $t['ok']) : null,
                'avgOutputTokens' => $t['ok'] ? (int) round($t['outputTokens'] / $t['ok']) : null,
                'avgItems' => $t['ok'] ? round($t['items'] / $t['ok'], 1) : null,
                'notFood' => $t['notFood'],
                'pricePerMillion' => ['input' => $pin, 'output' => $pout],
                'costTotal' => round($cost, 4),
                'costPerScan' => $t['ok'] ? round($cost / $t['ok'], 5) : null,
                'saved' => $t['feedback'],
                'keptRate' => $suggested ? round($t['kept'] / $suggested, 3) : null,
                'changedRate' => $suggested ? round($t['changed'] / $suggested, 3) : null,
                'removedRate' => $suggested ? round($t['removed'] / $suggested, 3) : null,
                'addedPerSave' => $t['feedback'] ? round($t['added'] / $t['feedback'], 1) : null,
            ];
        }
        usort($out, static fn (array $a, array $b): int => $b['scans'] <=> $a['scans']);

        return $out;
    }

    public function month(int $offset = 0): string
    {
        $now = $this->clock !== null ? ($this->clock)() : time();

        return gmdate('Y-m', strtotime(gmdate('Y-m-01', $now) . ($offset ? " $offset month" : '')) ?: $now);
    }

    /** @param array<string, int> $delta */
    private function add(string $provider, string $model, array $delta): void
    {
        if (!preg_match('/^[a-z]{2,16}$/', $provider) || !preg_match('/^[A-Za-z0-9._:-]{1,64}$/', $model)) {
            return;
        }
        if (!is_dir($this->dir) && !@mkdir($this->dir, 0700, true)) {
            return;
        }
        $fh = @fopen($this->file($this->month()), 'c+');
        if ($fh === false) {
            return;
        }
        try {
            flock($fh, LOCK_EX);
            $data = json_decode((string) stream_get_contents($fh), true);
            $data = is_array($data) ? $data : [];
            $key = $provider . '|' . $model;
            foreach ($delta as $field => $n) {
                $data[$key][$field] = (int) ($data[$key][$field] ?? 0) + $n;
            }
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, (string) json_encode($data));
            fflush($fh);
        } finally {
            flock($fh, LOCK_UN);
            fclose($fh);
        }
    }

    private function file(string $month): string
    {
        return $this->dir . '/' . (preg_match('/^\d{4}-\d{2}$/', $month) ? $month : 'invalid') . '.json';
    }
}
