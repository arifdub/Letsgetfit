<?php

// LetsGetFit server settings — EXAMPLE ONLY, never put real values in the repository.
//
// On the server this file lives OUTSIDE the web root at:
//   <private folder>/config/app.php     (default private folder: letsgetfit-private/ next to public_html)
// The GitHub deploy workflow writes it automatically from the FDC_API_KEY and
// APP_HASH_SECRET repository secrets. Without a key, the public DEMO_KEY is used, which
// allows only a few searches per hour.

return [
    // Free key from https://fdc.nal.usda.gov/api-key-signup
    'fdc_api_key' => 'REPLACE_WITH_YOUR_FDC_API_KEY',

    // Long random string used to hash visitor IP addresses for rate limiting.
    'hash_secret' => 'REPLACE_WITH_A_LONG_RANDOM_STRING',

    // Optional accounts (written by the deploy from the DB_*, SMTP_*, ADMIN_* secrets; see docs/DATABASE.md):
    // 'accounts_enabled' => true,
    // 'db_dsn' => 'mysql:host=localhost;port=3306;dbname=REPLACE_DB_NAME;charset=utf8mb4',
    // 'db_user' => 'REPLACE_DB_USER',
    // 'db_password' => 'REPLACE_DB_PASSWORD',
    // 'mail_transport' => 'smtp',
    // 'smtp_host' => 'mail.example.com', 'smtp_port' => 465, 'smtp_secure' => 'ssl',
    // 'smtp_user' => 'no-reply@example.com', 'smtp_password' => 'REPLACE', 'mail_from' => 'no-reply@example.com',
    // 'admin_email' => 'you@example.com',
    // 'setup_token' => 'REPLACE_WITH_24_PLUS_RANDOM_CHARACTERS',

    // Optional overrides (defaults shown):
    // 'cache_ttl_seconds' => 604800,
    // 'rate_limit_requests' => 30,
    // 'rate_limit_window_seconds' => 300,
    // 'global_requests_per_hour' => 900,
    // 'connect_timeout_seconds' => 4,
    // 'timeout_seconds' => 8,
];
