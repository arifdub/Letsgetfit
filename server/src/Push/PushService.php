<?php

declare(strict_types=1);

namespace LetsGetFit\Push;

use LetsGetFit\Config;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\VAPID;
use Minishlink\WebPush\WebPush;
use PDO;

/**
 * Stores push subscriptions and sends Web Push messages (encrypted, signed with VAPID keys)
 * through the minishlink/web-push library. The VAPID key pair is created on first use and kept in
 * private storage, so nothing needs configuring. Subscriptions the push service reports as gone
 * (404/410) are deleted; others are deleted after repeated failures.
 */
final class PushService
{
    private ?array $keys = null;

    public function __construct(private PDO $pdo, private Config $config, private string $storageDir)
    {
    }

    public static function available(): bool
    {
        return extension_loaded('openssl') && class_exists(WebPush::class);
    }

    /** @return array{publicKey: string, privateKey: string} */
    public function keys(): array
    {
        if ($this->keys !== null) {
            return $this->keys;
        }
        $file = $this->storageDir . '/vapid.json';
        $data = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (!is_array($data) || !is_string($data['publicKey'] ?? null) || !is_string($data['privateKey'] ?? null)) {
            if (!is_dir($this->storageDir)) {
                @mkdir($this->storageDir, 0700, true);
            }
            $data = VAPID::createVapidKeys();
            // Created once; another request racing here keeps whichever file was written first.
            $fh = @fopen($file, 'x');
            if ($fh !== false) {
                fwrite($fh, (string) json_encode($data));
                fclose($fh);
                @chmod($file, 0600);
            } else {
                $existing = json_decode((string) @file_get_contents($file), true);
                $data = is_array($existing) && isset($existing['publicKey'], $existing['privateKey']) ? $existing : $data;
            }
        }

        return $this->keys = ['publicKey' => $data['publicKey'], 'privateKey' => $data['privateKey']];
    }

    /**
     * Add or update this browser's subscription. Returns an error message or null.
     * @param array<string, mixed> $sub {endpoint, keys: {p256dh, auth}}
     * @param list<array<string, mixed>> $reminders already validated
     */
    public function save(array $sub, string $timezone, array $reminders, ?string $userId): ?string
    {
        $endpoint = is_string($sub['endpoint'] ?? null) ? $sub['endpoint'] : '';
        $p256dh = is_string($sub['keys']['p256dh'] ?? null) ? $sub['keys']['p256dh'] : '';
        $auth = is_string($sub['keys']['auth'] ?? null) ? $sub['keys']['auth'] : '';
        if (!self::validEndpoint($endpoint, $this->config) || !preg_match('/^[A-Za-z0-9_-]{80,100}={0,2}$/', $p256dh) || !preg_match('/^[A-Za-z0-9_-]{16,32}={0,2}$/', $auth)) {
            return 'This browser gave an unexpected notification address. Try again, or use another browser.';
        }
        $this->pdo->prepare('INSERT INTO push_subscriptions (endpoint_hash, endpoint, p256dh, auth, user_id, timezone, reminders, failures, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth), user_id = COALESCE(VALUES(user_id), user_id),
              timezone = VALUES(timezone), reminders = VALUES(reminders), failures = 0, updated_at = VALUES(updated_at)')
            ->execute([hash('sha256', $endpoint), $endpoint, $p256dh, $auth, $userId, $timezone, json_encode($reminders)]);

        return null;
    }

    public function delete(string $endpoint): void
    {
        $this->pdo->prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ?')->execute([hash('sha256', $endpoint)]);
    }

    /** @return array<string, mixed>|null */
    public function find(string $endpoint): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM push_subscriptions WHERE endpoint_hash = ?');
        $stmt->execute([hash('sha256', $endpoint)]);
        $row = $stmt->fetch();

        return $row ?: null;
    }

    public function count(): int
    {
        return (int) $this->pdo->query('SELECT COUNT(*) FROM push_subscriptions')->fetchColumn();
    }

    /**
     * Send one message to many subscriptions. Removes subscriptions that no longer exist.
     * @param list<array<string, mixed>> $rows subscription rows
     * @param array{title: string, body: string, url?: string, tag?: string} $message
     * @return array{sent: int, failed: int, removed: int}
     */
    public function send(array $rows, array $message): array
    {
        $totals = ['sent' => 0, 'failed' => 0, 'removed' => 0];
        if ($rows === []) {
            return $totals;
        }
        $keys = $this->keys();
        $webPush = new WebPush(['VAPID' => [
            'subject' => rtrim($this->config->string('app_url'), '/') ?: 'https://letsgetfit.site',
            'publicKey' => $keys['publicKey'],
            'privateKey' => $keys['privateKey'],
        ]], ['TTL' => 6 * 3600, 'urgency' => 'normal', 'batchSize' => 100], 10);
        $webPush->setReuseVAPIDHeaders(true);
        $payload = (string) json_encode([
            'title' => mb_substr($message['title'], 0, 60),
            'body' => mb_substr($message['body'], 0, 200),
            'url' => $message['url'] ?? './',
            'tag' => $message['tag'] ?? 'letsgetfit',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $byEndpoint = [];
        foreach ($rows as $row) {
            $byEndpoint[(string) $row['endpoint']] = $row;
            $webPush->queueNotification(Subscription::create([
                'endpoint' => (string) $row['endpoint'],
                'publicKey' => (string) $row['p256dh'],
                'authToken' => (string) $row['auth'],
                'contentEncoding' => 'aes128gcm',
            ]), $payload);
        }
        // The library notes that GMP/BCMath would be faster; that is fine at this scale.
        set_error_handler(static fn (int $no): bool => $no === E_USER_NOTICE, E_USER_NOTICE);
        try {
            foreach ($webPush->flush() as $report) {
                $endpoint = $report->getEndpoint();
                if ($report->isSuccess()) {
                    $totals['sent']++;
                    $this->pdo->prepare('UPDATE push_subscriptions SET failures = 0 WHERE endpoint_hash = ?')->execute([hash('sha256', $endpoint)]);
                    continue;
                }
                $totals['failed']++;
                $row = $byEndpoint[$endpoint] ?? null;
                if ($report->isSubscriptionExpired() || ($row !== null && (int) $row['failures'] >= 4)) {
                    $this->delete($endpoint);
                    $totals['removed']++;
                } else {
                    $this->pdo->prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint_hash = ?')->execute([hash('sha256', $endpoint)]);
                }
            }
        } finally {
            restore_error_handler();
        }

        return $totals;
    }

    /**
     * Send every reminder that is due now. Run every 15 minutes or so.
     * @return array{checked: int, sent: int, failed: int, removed: int}
     */
    public function sendDueReminders(int $now): array
    {
        $totals = ['checked' => 0, 'sent' => 0, 'failed' => 0, 'removed' => 0];
        $rows = $this->pdo->query("SELECT * FROM push_subscriptions WHERE reminders IS NOT NULL AND reminders <> '[]'")->fetchAll();
        $batches = [];
        foreach ($rows as $row) {
            $totals['checked']++;
            [$reminders] = Reminders::validate(json_decode((string) $row['reminders'], true));
            $last = json_decode((string) ($row['last_sent'] ?? ''), true);
            $last = is_array($last) ? $last : [];
            $due = Reminders::due($reminders, $last, (string) $row['timezone'], $now);
            if ($due === []) {
                continue;
            }
            // One message per type at most, even if two reminders of a type are due together.
            foreach ($due as $r) {
                $last[Reminders::key($r)] = Reminders::localDate((string) $row['timezone'], $now);
                $batches[$r['type']][(string) $row['endpoint']] = $row;
            }
            $this->pdo->prepare('UPDATE push_subscriptions SET last_sent = ? WHERE id = ?')->execute([json_encode($last), $row['id']]);
        }
        foreach ($batches as $type => $subs) {
            $result = $this->send(array_values($subs), Reminders::message($type));
            foreach (['sent', 'failed', 'removed'] as $k) {
                $totals[$k] += $result[$k];
            }
        }

        return $totals;
    }

    /** Push services use HTTPS on well-known hosts; tests may allow a local mock. */
    public static function validEndpoint(string $endpoint, Config $config): bool
    {
        if (strlen($endpoint) > 1000 || !preg_match('#^https://[A-Za-z0-9.-]+(:\d+)?/\S+$#', $endpoint)) {
            return $config->bool('push_allow_local_endpoints') && (bool) preg_match('#^http://127\.0\.0\.1:\d+/\S+$#', $endpoint);
        }

        return true;
    }
}
