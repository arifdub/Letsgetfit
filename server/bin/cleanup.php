<?php

declare(strict_types=1);

// Scheduled maintenance (optional cron job, for example daily at 03:17):
//   php /home/USER/domains/letsgetfit.site/letsgetfit-private/app/bin/cleanup.php
// Removes expired login codes, audit entries older than a year, and old cache, outbox and
// rate-limit files. Safe to run at any time; prints counts only (no personal data).

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../bootstrap.php';

use LetsGetFit\Accounts\Audit;
use LetsGetFit\Api;
use LetsGetFit\Auth\LoginCodes;
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
    $codes = (new LoginCodes($pdo, Api::secret($config)))->prune();
    $audit = Audit::prune($pdo, 365);
    echo "Removed {$codes} expired login codes and {$audit} old audit entries.\n";
}
