<?php

declare(strict_types=1);

// Sends push reminders that are due. Run every 15 minutes, for example as a cPanel cron job:
//   */15 * * * * php /home/USER/domains/letsgetfit.site/letsgetfit-private/app/bin/send-reminders.php
// (The GitHub workflow .github/workflows/reminders.yml does the same over HTTPS.) Prints counts only.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../bootstrap.php';

use LetsGetFit\Api;
use LetsGetFit\Config;
use LetsGetFit\Db\Database;

$privateDir = getenv('LETSGETFIT_PRIVATE_DIR') ?: dirname(__DIR__, 2);
$config = Config::load($privateDir);
if (!$config->bool('accounts_enabled')) {
    echo "Accounts (and so notifications) are switched off.\n";
    exit(0);
}
$pdo = Database::connect($config);
$result = Api::pushService($pdo, Api::effective($config, $pdo))->sendDueReminders(time());
echo "Checked {$result['checked']} devices: {$result['sent']} reminders sent, {$result['failed']} failed, {$result['removed']} removed.\n";
