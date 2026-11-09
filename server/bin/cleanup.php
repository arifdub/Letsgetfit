<?php

declare(strict_types=1);

// Scheduled maintenance (optional cron job, for example daily at 03:17):
//   php /home/USER/domains/letsgetfit.site/letsgetfit-private/app/bin/cleanup.php
// Removes expired sign-in tokens, sign-ups never confirmed within 7 days, and old cache and
// rate-limit files. Safe to run at any time; prints counts only (no personal data).

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../bootstrap.php';

use LetsGetFit\Config;
use LetsGetFit\Db\Database;
use LetsGetFit\RateLimiter;

$privateDir = getenv('LETSGETFIT_PRIVATE_DIR') ?: dirname(__DIR__, 2);
$config = Config::load($privateDir);
$storage = $config->string('storage_dir');

$removedFiles = 0;
foreach ([[$storage . '/cache', $config->int('cache_ttl_seconds')], [$storage . '/outbox', 7 * 86400]] as [$dir, $ttl]) {
    foreach (glob($dir . '/*') ?: [] as $file) {
        if (is_file($file) && filemtime($file) < time() - max(3600, $ttl)) {
            $removedFiles += (int) @unlink($file);
        }
    }
}
(new RateLimiter($storage . '/ratelimit', 'unused'))->prune();
echo "Removed {$removedFiles} old cache/outbox files; pruned rate-limit files.\n";

if ($config->bool('accounts_enabled')) {
    $pdo = Database::connect($config);
    $tokens = $pdo->exec('DELETE FROM auth_tokens WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 1 DAY OR used_at < UTC_TIMESTAMP() - INTERVAL 1 DAY');
    $unverified = $pdo->exec('DELETE FROM users WHERE email_verified_at IS NULL AND created_at < UTC_TIMESTAMP() - INTERVAL 7 DAY');
    echo "Removed {$tokens} expired tokens and {$unverified} unconfirmed sign-ups.\n";
}
