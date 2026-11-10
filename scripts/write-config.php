<?php

declare(strict_types=1);

// Builds the private settings file (letsgetfit-private/config/app.php) from environment
// variables (GitHub secrets) and prints it. var_export() escapes every value, so passwords with
// quotes or backslashes are safe. Used by scripts/deploy-ftp.sh; never deployed itself.
//
// Food search:  FDC_API_KEY, APP_HASH_SECRET
// Accounts:     ACCOUNTS_ENABLED=true, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
//               SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, MAIL_FROM, MAIL_FROM_NAME
// Meal scan:    OPENAI_API_KEY, OPENAI_MODEL, SCAN_DAILY_LIMIT
// Site:         SITE_URL

function env(string $name, string $default = ''): string
{
    $v = getenv($name);

    return is_string($v) && $v !== '' ? $v : $default;
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

if (env('ACCOUNTS_ENABLED') === 'true') {
    $missing = array_values(array_filter(
        ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'],
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
    $mailFrom = env('MAIL_FROM');
    if (filter_var($mailFrom, FILTER_VALIDATE_EMAIL) === false) {
        fail('MAIL_FROM must be an email address.');
    }
    $secure = env('SMTP_SECURE', 'tls');
    if (!in_array($secure, ['tls', 'ssl'], true)) {
        fail('SMTP_SECURE must be tls or ssl.');
    }
    $config += [
        'db_dsn' => "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4",
        'db_user' => env('DB_USER'),
        'db_password' => env('DB_PASSWORD'),
        'mail_transport' => 'smtp',
        'mail_from' => $mailFrom,
        'mail_from_name' => env('MAIL_FROM_NAME', 'LetsGetFit'),
        'smtp_host' => env('SMTP_HOST'),
        'smtp_port' => (int) env('SMTP_PORT', $secure === 'ssl' ? '465' : '587'),
        'smtp_secure' => $secure,
        'smtp_user' => env('SMTP_USER'),
        'smtp_password' => env('SMTP_PASSWORD'),
        'cookie_secure' => str_starts_with($siteUrl, 'https://'),
    ];
    $config['accounts_enabled'] = true;
}

echo "<?php\n// Written by the deploy workflow on " . gmdate('Y-m-d\TH:i:s\Z') . ". Do not commit. Permissions: 600.\nreturn " . var_export($config, true) . ";\n";
