<?php

declare(strict_types=1);

// Admin panel API: /api/admin.php?action=status|overview|settings|users|audit (GET),
// setup|settings|user|test-email (POST, JSON, X-CSRF-Token). Admins only, except status and setup.
// Disabled unless accounts_enabled is true in the private settings.
require __DIR__ . '/bootstrap.inc.php';
\LetsGetFit\Api::run('admin', $letsgetfitPrivate);
