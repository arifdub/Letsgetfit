<?php

declare(strict_types=1);

// Optional accounts and sync: /api/account.php?action=me|pull|export (GET), register|verify|
// resend|login|logout|request-reset|reset|push|delete (POST, JSON, X-CSRF-Token).
// Disabled unless accounts_enabled is true in the private settings.
require __DIR__ . '/bootstrap.inc.php';
\LetsGetFit\Api::run('account', $letsgetfitPrivate);
