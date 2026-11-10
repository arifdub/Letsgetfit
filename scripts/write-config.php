<?php

declare(strict_types=1);

// Builds the private settings file (letsgetfit-private/config/app.php) from environment
// variables (GitHub secrets) and prints it. var_export() escapes every value, so passwords with
// quotes or backslashes are safe. Used by scripts/deploy-ftp.sh; never deployed itself.
//
// Food search:  FDC_API_KEY, APP_HASH_SECRET
// Accounts:     ACCOUNTS_ENABLED=true, APP_HASH_SECRET, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
//               SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER (defaults to MAIL_FROM), SMTP_PASSWORD,
//               MAIL_FROM, MAIL_FROM_NAME, ADMIN_EMAIL, ADMIN_SETUP_TOKEN
// Meal scan:    OPENAI_API_KEY, OPENAI_MODEL, SCAN_DAILY_LIMIT
// Site:         SITE_URL

function env(string $name, string $default = ''): string
{
    $v = getenv($name);

    return is_string($v) && $v !== '' ? $v : $default;
}
/**
 * Clean up a mail server name typed with extras: "https://mail.example.com:465/ " becomes
 * ["mail.example.com", 465]. Returns [host, port or null], or null if it is still not a host name.
 */
function smtp_host(string $raw): ?array
{
    $h = strtolower(trim($raw));
    $h = (string) preg_replace('#^[a-z]+://#', '', $h);
    $h = rtrim((string) preg_replace('#/.*$#', '', $h), '.');
    $port = null;
    if (preg_match('/^(.+):(\d{2,5})$/', $h, $m)) {
        [$h, $port] = [$m[1], (int) $m[2]];
    }

    return preg_match('/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $h) || filter_var($h, FILTER_VALIDATE_IP) ? [$h, $port] : null;
}

function fail(string $message): never
{
    fwrite(STDERR, $message . PHP_EOL);
    exit(1);
}

$key = env('FDC_API_KEY');
if ($key !== '' && !preg_match('/^[A-Za-z0-9]{8,128}$/', $key)) {
    fail('FDC_API_KEY must be letters and numbers only.');
}
$secret = env('APP_HASH_SECRET', bin2hex(random_bytes(32)));
if (!preg_match('/^[A-Za-z0-9_-]{16,256}$/', $secret)) {
    fail('APP_HASH_SECRET must be 16+ letters, numbers, - or _.');
}
$siteUrl = rtrim(env('SITE_URL', 'https://letsgetfit.site/'), '/');
// HTTPS only, except a local test server.
if (!preg_match('#^https://[A-Za-z0-9.-]+$#', $siteUrl) && !preg_match('#^http://(127\.0\.0\.1|localhost)(:\d+)?$#', $siteUrl)) {
    fail('SITE_URL must look like https://letsgetfit.site');
}

$config = [
    'fdc_api_key' => $key,
    'hash_secret' => $secret,
    'app_url' => $siteUrl,
    'accounts_enabled' => false,
];

$openAiKey = env('OPENAI_API_KEY');
if ($openAiKey !== '') {
    if (!preg_match('/^sk-[A-Za-z0-9_-]{20,300}$/', $openAiKey)) {
        fail('OPENAI_API_KEY does not look like an OpenAI API key (sk-...).');
    }
    $model = env('OPENAI_MODEL', 'gpt-4o-mini');
    if (!preg_match('/^[A-Za-z0-9._:-]{1,64}$/', $model)) {
        fail('OPENAI_MODEL has an unexpected format.');
    }
    $daily = env('SCAN_DAILY_LIMIT', '100');
    if (!ctype_digit($daily) || (int) $daily < 1 || (int) $daily > 10000) {
        fail('SCAN_DAILY_LIMIT must be a whole number from 1 to 10000.');
    }
    $config += ['openai_api_key' => $openAiKey, 'openai_model' => $model, 'scan_daily_limit' => (int) $daily];
}

if (in_array(strtolower(trim(env('ACCOUNTS_ENABLED'))), ['true', 'yes', 'on', '1'], true)) {
    $missing = array_values(array_filter(
        // A fixed APP_HASH_SECRET keeps login codes and API keys saved in the admin panel readable
        // after each deploy (otherwise a random one is made every time).
        ['APP_HASH_SECRET', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'SMTP_HOST', 'SMTP_PASSWORD', 'MAIL_FROM'],
        static fn (string $n): bool => env($n) === '',
    ));
    if ($missing) {
        fail('ACCOUNTS_ENABLED is true but these secrets are missing: ' . implode(' ', $missing) . '. Accounts stay off until all are set.');
    }
    $dbHost = env('DB_HOST', 'localhost');
    $dbPort = env('DB_PORT', '3306');
    $dbName = env('DB_NAME');
    if (!preg_match('/^[A-Za-z0-9.-]{1,253}$/', $dbHost) || !ctype_digit($dbPort) || !preg_match('/^[A-Za-z0-9_]{1,64}$/', $dbName)) {
        fail('DB_HOST, DB_PORT or DB_NAME has an unexpected format.');
    }
    $mailFrom = trim(env('MAIL_FROM'));
    if (filter_var($mailFrom, FILTER_VALIDATE_EMAIL) === false) {
        fail('MAIL_FROM must be an email address.');
    }
    $secure = strtolower(trim(env('SMTP_SECURE', 'tls')));
    if (!in_array($secure, ['tls', 'ssl'], true)) {
        fail('SMTP_SECURE must be tls or ssl.');
    }
    $smtp = smtp_host(env('SMTP_HOST'));
    if ($smtp === null) {
        fail('SMTP_HOST must be just the mail server name, for example mail.letsgetfit.site (no https://, spaces or port).');
    }
    $adminEmail = strtolower(trim(env('ADMIN_EMAIL')));
    if ($adminEmail !== '' && filter_var($adminEmail, FILTER_VALIDATE_EMAIL) === false) {
        fail('ADMIN_EMAIL must be an email address.');
    }
    $setupToken = env('ADMIN_SETUP_TOKEN');
    if ($setupToken !== '' && !preg_match('/^[A-Za-z0-9_-]{24,256}$/', $setupToken)) {
        fail('ADMIN_SETUP_TOKEN must be 24+ letters, numbers, - or _.');
    }
    $config += [
        'admin_email' => $adminEmail,
        'setup_token' => $setupToken,
        'db_dsn' => "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4",
        'db_user' => env('DB_USER'),
        'db_password' => env('DB_PASSWORD'),
        'mail_transport' => 'smtp',
        'mail_from' => $mailFrom,
        'mail_from_name' => env('MAIL_FROM_NAME', 'LetsGetFit'),
        'smtp_host' => $smtp[0],
        'smtp_port' => (int) env('SMTP_PORT', (string) ($smtp[1] ?? ($secure === 'ssl' ? 465 : 587))),
        'smtp_secure' => $secure,
        'smtp_user' => trim(env('SMTP_USER', $mailFrom)),
        'smtp_password' => env('SMTP_PASSWORD'),
        'cookie_secure' => str_starts_with($siteUrl, 'https://'),
    ];
    $config['accounts_enabled'] = true;
}

echo "<?php\n// Written by the deploy workflow on " . gmdate('Y-m-d\TH:i:s\Z') . ". Do not commit. Permissions: 600.\nreturn " . var_export($config, true) . ";\n";
