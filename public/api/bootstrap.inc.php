<?php

declare(strict_types=1);

// Shared start-up for the thin API entry points. All application code and settings live in a
// private folder outside the web root (see docs/DEPLOY-CPANEL.md):
//   1. the LETSGETFIT_PRIVATE_DIR environment variable, if set; otherwise
//   2. a folder named "letsgetfit-private" next to the document root.

if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    http_response_code(404);
    exit;
}

function letsgetfit_private_dir(): ?string
{
    $candidates = [];
    $env = getenv('LETSGETFIT_PRIVATE_DIR');
    if (is_string($env) && $env !== '') {
        $candidates[] = $env;
    }
    $candidates[] = dirname(__DIR__, 2) . '/letsgetfit-private';
    foreach ($candidates as $dir) {
        if (is_file($dir . '/app/bootstrap.php')) {
            return $dir;
        }
    }

    return null;
}

$letsgetfitPrivate = letsgetfit_private_dir();
if ($letsgetfitPrivate === null) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"error":"not_configured","message":"Food search is not set up on this server yet. Add the food manually."}';
    exit;
}
require $letsgetfitPrivate . '/app/bootstrap.php';
