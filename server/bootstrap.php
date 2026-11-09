<?php

declare(strict_types=1);

/*
 * LetsGetFit server bootstrap.
 *
 * This folder (server/) is deployed OUTSIDE the web root, as <private>/app/.
 * Layout of the private folder on the server:
 *   <private>/app/       this code
 *   <private>/config/    app.php with real settings (never committed)
 *   <private>/storage/   cache and rate-limit files (created at runtime)
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'LetsGetFit\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    if (!preg_match('/^[A-Za-z0-9_\\\\]+$/', $relative)) {
        return;
    }
    $file = __DIR__ . '/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
