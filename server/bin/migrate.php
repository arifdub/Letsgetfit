<?php

declare(strict_types=1);

// Usage (on the server, from the private folder):
//   php app/bin/migrate.php            apply pending migrations
//   php app/bin/migrate.php --status   list applied and pending migrations
// Take a database backup first (docs/DATABASE.md). Never run from the web.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../bootstrap.php';

use LetsGetFit\Config;
use LetsGetFit\Db\Database;
use LetsGetFit\Db\Migrator;

$privateDir = getenv('LETSGETFIT_PRIVATE_DIR') ?: dirname(__DIR__, 2);
$config = Config::load($privateDir);
try {
    $migrator = new Migrator(Database::connect($config), dirname(__DIR__) . '/migrations');
} catch (Throwable $e) {
    fwrite(STDERR, 'Cannot connect to the database: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
if (in_array('--status', $argv, true)) {
    echo 'Applied: ' . (implode(', ', $migrator->applied()) ?: 'none') . PHP_EOL;
    echo 'Pending: ' . (implode(', ', $migrator->pending()) ?: 'none') . PHP_EOL;
    exit(0);
}
$done = $migrator->migrate();
echo $done ? 'Applied: ' . implode(', ', $done) . PHP_EOL : 'Nothing to do: the database is up to date.' . PHP_EOL;
