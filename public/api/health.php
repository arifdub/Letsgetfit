<?php

declare(strict_types=1);

// Server check used by the app and the deploy workflow. Reports no secrets.
require __DIR__ . '/bootstrap.inc.php';
\LetsGetFit\Api::run('health', $letsgetfitPrivate);
