<?php

declare(strict_types=1);

// Push notifications: /api/push.php?action=key (GET), subscribe|unsubscribe|status|test|cron
// (POST, JSON). Needs accounts switched on (for the database). No account needed to use it.
require __DIR__ . '/bootstrap.inc.php';
\LetsGetFit\Api::run('push', $letsgetfitPrivate);
