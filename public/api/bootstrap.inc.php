<?php

declare(strict_types=1);

// Shared start-up for the thin API entry points. All application code and settings live in a
// private folder named "letsgetfit-private" OUTSIDE the web root (see docs/DEPLOY-CPANEL.md).
// Where it is found, in order:
//   1. the LETSGETFIT_PRIVATE_DIR environment variable, if set;
//   2. a "letsgetfit-private" folder in any parent of this file's folder (up to 6 levels), so it
//      works whether FTP placed it next to public_html or in the account's home folder;
//   3. the same next to DOCUMENT_ROOT as the web server sees it (it may be a symlink);
//   4. the account's home folder.

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
    $dir = __DIR__;
    for ($i = 0; $i < 6; $i++) {
        $parent = dirname($dir);
        if ($parent === $dir) {
            break;
        }
        $dir = $parent;
        $candidates[] = $dir . '/letsgetfit-private';
    }
    $docRoot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
    if ($docRoot !== '') {
        $candidates[] = dirname(rtrim($docRoot, '/')) . '/letsgetfit-private';
    }
    $home = getenv('HOME');
    if ((!is_string($home) || $home === '') && function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
        $home = (string) (posix_getpwuid(posix_geteuid())['dir'] ?? '');
    }
    if (is_string($home) && $home !== '') {
        $candidates[] = rtrim($home, '/') . '/letsgetfit-private';
    }
    foreach ($candidates as $candidate) {
        // The private folder must never be inside the web root.
        if (str_starts_with($candidate . '/', dirname(__DIR__) . '/')) {
            continue;
        }
        if (@is_file($candidate . '/app/bootstrap.php')) {
            return $candidate;
        }
    }

    return null;
}

$letsgetfitPrivate = letsgetfit_private_dir();
if ($letsgetfitPrivate === null) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    // Diagnostics without paths: whether PHP is restricted to certain folders (open_basedir).
    echo json_encode([
        'error' => 'not_configured',
        'message' => 'Food search is not set up on this server yet. Add the food manually.',
        'privateFolderFound' => false,
        'openBasedirRestricted' => (string) ini_get('open_basedir') !== '',
    ]);
    exit;
}
require $letsgetfitPrivate . '/app/bootstrap.php';
