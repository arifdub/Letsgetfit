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

// Composer packages (PHPMailer, the Anthropic SDK and what it needs), built in CI and uploaded
// with the deploy. Loaded only when one of their classes is first used, so food search and the
// health check never depend on them: a problem in a package can only affect email or Claude.
spl_autoload_register(static function (string $class): void {
    static $loaded = false;
    if ($loaded || str_starts_with($class, 'LetsGetFit\\') || !is_file(__DIR__ . '/vendor/autoload.php')) {
        return;
    }
    $loaded = true;
    // Composer's loader is registered for later classes; it loads this one directly (PHP does not
    // autoload the same class again while it is already being autoloaded).
    $composer = require __DIR__ . '/vendor/autoload.php';
    if (is_object($composer) && method_exists($composer, 'loadClass')) {
        $composer->loadClass($class);
    }
});

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
