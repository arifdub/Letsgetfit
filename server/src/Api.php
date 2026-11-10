<?php

declare(strict_types=1);

namespace LetsGetFit;

use LetsGetFit\Accounts\AccountController;
use LetsGetFit\Admin\AdminController;
use LetsGetFit\Auth\LoginCodes;
use LetsGetFit\Auth\SessionManager;
use LetsGetFit\Db\Database;
use LetsGetFit\Db\Migrator;
use LetsGetFit\Http\CurlHttpClient;
use LetsGetFit\Mail\Mailer;
use LetsGetFit\Mail\OutboxMailer;
use LetsGetFit\Mail\SmtpMailer;
use LetsGetFit\Push\PushController;
use LetsGetFit\Push\PushService;
use LetsGetFit\Scan\ImageProcessor;
use LetsGetFit\Scan\ClaudeVision;
use LetsGetFit\Scan\OpenAiVision;
use LetsGetFit\Scan\ScanStats;
use LetsGetFit\Scan\VisionProvider;
use LetsGetFit\Scan\ScanController;
use LetsGetFit\Settings\SettingsStore;
use PDO;

/** Wires the endpoints together and writes JSON responses. Called from public/api/*.php. */
final class Api
{
    public static function run(string $endpoint, string $privateDir): void
    {
        // A fatal error (for example in a package on a newer PHP version) still answers with JSON
        // naming the file and line, so the deploy check shows what failed. No message text,
        // request data or full paths.
        register_shutdown_function(static function (): void {
            $e = error_get_last();
            if ($e === null || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
                return;
            }
            $file = str_replace('\\', '/', (string) $e['file']);
            $short = preg_match('#/(vendor/.+|src/.+|bootstrap\.php)$#', $file, $m) ? $m[1] : basename($file);
            error_log('LetsGetFit fatal error in ' . $short . ':' . $e['line']);
            if (!headers_sent()) {
                http_response_code(500);
                header('Content-Type: application/json; charset=utf-8');
            }
            echo json_encode(['error' => 'server_error', 'message' => 'Something went wrong. Add the food manually.', 'fatal' => $short . ':' . $e['line'], 'php' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION]);
        });
        try {
            $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
            if ($endpoint === 'account' || $endpoint === 'admin' || $endpoint === 'push') {
                [$status, $body, $headers] = match ($endpoint) {
                    'account' => self::account(Config::load($privateDir)),
                    'admin' => self::admin(Config::load($privateDir)),
                    'push' => self::push(Config::load($privateDir)),
                };
                self::send($status, $body, $headers);

                return;
            }
            if ($endpoint === 'scan') {
                $config = self::effective(Config::load($privateDir));
                if (!$config->bool('scan_enabled')) {
                    $config = $config->withOverrides(['openai_api_key' => '', 'anthropic_api_key' => '']);
                }
                $controller = self::scan($config);
                [$status, $body, $headers] = ($_GET['action'] ?? '') === 'feedback'
                    ? $controller->feedback($_SERVER, (string) file_get_contents('php://input'))
                    : $controller->handle($_SERVER, $_FILES);
                self::send($status, $body, $headers);

                return;
            }
            if ($method !== 'GET' && $method !== 'HEAD') {
                self::send(405, ['error' => 'method_not_allowed', 'message' => 'Use GET.'], ['Allow' => 'GET, HEAD']);

                return;
            }
            $config = self::effective(Config::load($privateDir));
            [$status, $body, $headers] = match ($endpoint) {
                'foods' => self::foodSearch($config)->handle($_GET, (string) ($_SERVER['REMOTE_ADDR'] ?? '')),
                'health' => self::health($config),
                default => [404, ['error' => 'not_found'], []],
            };
            self::send($status, $body, $headers);
        } catch (\Throwable $e) {
            // Log the error type only: never request data, search text or secrets.
            error_log('LetsGetFit API error: ' . $e::class . ' in ' . basename($e->getFile()) . ':' . $e->getLine());
            self::send(500, ['error' => 'server_error', 'message' => 'Something went wrong. Add the food manually.']);
        }
    }

    public static function foodSearch(Config $config): FoodSearchController
    {
        $storage = $config->string('storage_dir');
        $secret = $config->string('hash_secret') !== '' ? $config->string('hash_secret') : hash('sha256', $config->fdcApiKey() . __DIR__);

        return new FoodSearchController(
            new FoodDataCentral(new CurlHttpClient(), $config),
            new FileCache($storage . '/cache', $config->int('cache_ttl_seconds')),
            new RateLimiter($storage . '/ratelimit', $secret),
            $config,
        );
    }

    /**
     * Settings saved in the admin panel, applied over the private settings file. Only when accounts
     * (and so the database) are switched on; any database problem falls back to the file settings.
     */
    public static function effective(Config $config, ?PDO $pdo = null): Config
    {
        if (!$config->bool('accounts_enabled')) {
            return $config;
        }
        try {
            $pdo ??= Database::connect($config);

            return $config->withOverrides(self::settingsStore($pdo, $config)->all());
        } catch (\Throwable $e) {
            // Tables not created yet, or the database is down: carry on with the file settings.
            return $config;
        }
    }

    public static function settingsStore(PDO $pdo, Config $config): SettingsStore
    {
        // Only the real app secret can encrypt stored keys, so they stay readable after redeploys.
        return new SettingsStore($pdo, $config->string('hash_secret'));
    }

    /** Secret for hashing IP addresses and login codes. */
    public static function secret(Config $config): string
    {
        return $config->string('hash_secret') !== '' ? $config->string('hash_secret') : hash('sha256', $config->string('db_password') . __DIR__);
    }

    /** @return array{0: int, 1: array<string, mixed>, 2: array<string, string>} */
    public static function account(Config $fileConfig): array
    {
        if (!$fileConfig->bool('accounts_enabled')) {
            // A normal answer, not an error: the app simply does not show account features.
            return [200, ['enabled' => false, 'message' => 'Accounts are not available yet. Everything still works on this device.'], ['Cache-Control' => 'no-store']];
        }
        $pdo = self::connect($fileConfig);
        if ($pdo === null) {
            return [503, ['enabled' => false, 'error' => 'database_unavailable', 'message' => 'Accounts are not available right now. Everything still works on this device.'], ['Cache-Control' => 'no-store']];
        }
        if (array_intersect(self::migrator($pdo)->pending(), self::ACCOUNT_MIGRATIONS) !== []) {
            return [200, ['enabled' => false, 'setupRequired' => true, 'message' => 'Accounts are being set up. Everything still works on this device.'], ['Cache-Control' => 'no-store']];
        }
        $config = self::effective($fileConfig, $pdo);
        $storage = $config->string('storage_dir');
        $secret = self::secret($config);
        $controller = new AccountController(
            $pdo,
            new SessionManager($config, $storage),
            self::mailer($config),
            new RateLimiter($storage . '/ratelimit', $secret),
            $config,
            new LoginCodes($pdo, $secret),
        );

        return $controller->handle($_SERVER, $_GET, (string) file_get_contents('php://input'));
    }

    /** Migrations accounts need; later ones (like push) only switch their own feature off until applied. */
    public const ACCOUNT_MIGRATIONS = ['001_accounts', '002_passwordless_admin'];

    /** @return array{0: int, 1: array<string, mixed>, 2: array<string, string>} */
    public static function push(Config $fileConfig): array
    {
        $off = [200, ['enabled' => false, 'message' => 'Notifications are not available yet.'], ['Cache-Control' => 'no-store']];
        if (!$fileConfig->bool('accounts_enabled') || !PushService::available()) {
            return $off;
        }
        $pdo = self::connect($fileConfig);
        if ($pdo === null || in_array('003_push_notifications', self::migrator($pdo)->pending(), true)) {
            return $off;
        }
        $config = self::effective($fileConfig, $pdo);
        if (!$config->bool('push_enabled')) {
            return $off;
        }
        $storage = $config->string('storage_dir');
        $controller = new PushController(
            $pdo,
            self::pushService($pdo, $config),
            new SessionManager($config, $storage),
            new RateLimiter($storage . '/ratelimit', self::secret($config)),
            $config,
        );

        return $controller->handle($_SERVER, $_GET, (string) file_get_contents('php://input'));
    }

    public static function pushService(PDO $pdo, Config $config): PushService
    {
        return new PushService($pdo, $config, $config->string('storage_dir') . '/push');
    }

    /** "enabled", "off" or "setup" (the database table is not created yet), without loading packages. */
    private static function pushStatus(Config $config): string
    {
        if (!$config->bool('accounts_enabled') || !$config->bool('push_enabled') || !extension_loaded('openssl')) {
            return 'off';
        }
        $pdo = self::connect($config);
        if ($pdo === null) {
            return 'off';
        }

        return in_array('003_push_notifications', self::migrator($pdo)->pending(), true) ? 'setup' : 'enabled';
    }

    /** @return array{0: int, 1: array<string, mixed>, 2: array<string, string>} */
    public static function admin(Config $fileConfig): array
    {
        if (!$fileConfig->bool('accounts_enabled')) {
            return [200, ['enabled' => false, 'message' => 'Accounts are switched off, so there is no admin panel yet. See docs/DATABASE.md.'], ['Cache-Control' => 'no-store']];
        }
        $pdo = self::connect($fileConfig);
        if ($pdo === null) {
            return [503, ['enabled' => false, 'error' => 'database_unavailable', 'message' => 'Could not connect to the database. Check the DB_NAME, DB_USER, DB_PASSWORD and DB_HOST secrets.'], ['Cache-Control' => 'no-store']];
        }
        $config = self::effective($fileConfig, $pdo);
        $storage = $config->string('storage_dir');
        $secret = self::secret($config);
        $controller = new AdminController(
            $pdo,
            new SessionManager($config, $storage),
            self::mailer($config),
            new RateLimiter($storage . '/ratelimit', $secret),
            $fileConfig,
            $config,
            self::settingsStore($pdo, $config),
            self::migrator($pdo),
            self::scanStats($config),
            PushService::available() ? self::pushService($pdo, $config) : null,
        );
        [$status, $body, $headers] = $controller->handle($_SERVER, $_GET, (string) file_get_contents('php://input'));

        return [$status, ['enabled' => true] + $body, $headers];
    }

    private static function connect(Config $config): ?PDO
    {
        try {
            return Database::connect($config);
        } catch (\Throwable $e) {
            error_log('LetsGetFit database error: ' . $e::class);

            return null;
        }
    }

    private static function migrator(PDO $pdo): Migrator
    {
        return new Migrator($pdo, dirname(__DIR__) . '/migrations');
    }

    public static function scan(Config $config, ?VisionProvider $vision = null): ScanController
    {
        $storage = $config->string('storage_dir');
        $secret = $config->string('hash_secret') !== '' ? $config->string('hash_secret') : hash('sha256', $config->string('openai_api_key') . $config->string('anthropic_api_key') . __DIR__);
        $http = new CurlHttpClient();

        return new ScanController(
            $vision ?? self::visionProvider($config),
            new FoodDataCentral($http, $config),
            new ImageProcessor(max(100_000, $config->int('scan_max_upload_bytes'))),
            new RateLimiter($storage . '/ratelimit', $secret),
            new FileCache($storage . '/scan-results', 600),
            $config,
            $storage . '/locks',
            self::scanStats($config),
            new FileCache($storage . '/scan-feedback', 86400),
        );
    }

    /** @return list<string> */
    public static function scanProviderLabels(Config $config): array
    {
        if (!$config->bool('scan_enabled')) {
            return [];
        }
        $openai = new OpenAiVision(new CurlHttpClient(), $config);
        $claude = new ClaudeVision($config);
        if ($config->string('scan_provider') === 'alternate' && $openai->configured() && $claude->configured()) {
            return [$openai->label(), $claude->label()];
        }
        $chosen = self::visionProvider($config);

        return $chosen->configured() ? [$chosen->label()] : [];
    }

    public static function scanStats(Config $config): ScanStats
    {
        return new ScanStats($config->string('storage_dir') . '/scan-stats');
    }

    /**
     * The provider for this scan: the one chosen in the settings, or for "alternate" either
     * configured one at random, so both are tried on the same kind of real photos.
     */
    public static function visionProvider(Config $config): VisionProvider
    {
        $openai = new OpenAiVision(new CurlHttpClient(), $config);
        $claude = new ClaudeVision($config);
        $choice = $config->string('scan_provider');
        if ($choice === 'alternate' && $openai->configured() && $claude->configured()) {
            return random_int(0, 1) === 0 ? $openai : $claude;
        }
        if ($choice === 'claude' || ($choice === 'alternate' && $claude->configured())) {
            return $claude->configured() || !$openai->configured() ? $claude : $openai;
        }

        return $openai->configured() || !$claude->configured() ? $openai : $claude;
    }

    public static function mailer(Config $config): Mailer
    {
        return $config->string('mail_transport') === 'smtp'
            ? new SmtpMailer($config)
            : new OutboxMailer($config->string('storage_dir') . '/outbox');
    }

    /** @return array{0: int, 1: array<string, mixed>, 2: array<string, string>} */
    public static function health(Config $config): array
    {
        $curl = function_exists('curl_init');
        $storageOk = (new FileCache($config->string('storage_dir') . '/cache', 60))->writable();
        $foodSearch = !$curl ? 'unavailable' : ($config->usingDemoKey() ? 'demo-key' : 'configured');

        return [200, [
            'ok' => true,
            'php' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
            'extensions' => [
                'curl' => $curl,
                'json' => function_exists('json_encode'),
                'mbstring' => function_exists('mb_strlen'),
            ],
            'storageWritable' => $storageOk,
            'foodSearch' => $foodSearch,
            'accounts' => $config->bool('accounts_enabled') ? 'enabled' : 'disabled',
            // How email is sent, and whether the last attempt worked (a reason code only).
            'mail' => $config->bool('accounts_enabled') ? [
                'transport' => $config->string('mail_transport') === 'smtp' ? 'smtp' : 'outbox',
                'last' => SmtpMailer::lastStatus($config->string('storage_dir')),
            ] : null,
            'aiScan' => !self::visionProvider($config)->configured() || !$config->bool('scan_enabled') ? 'disabled' : (ImageProcessor::available() && $curl ? 'enabled' : 'unavailable'),
            // Which AI services a photo may go to, so the app can say so before the user agrees.
            'scanProviders' => self::scanProviderLabels($config),
            'push' => self::pushStatus($config),
            'gd' => ImageProcessor::available(),
            'pdoMysql' => extension_loaded('pdo_mysql'),
            // ?packages=1 loads the Composer packages, to prove they work on this PHP version.
            'packages' => ($_GET['packages'] ?? '') === '1' ? self::packageCheck() : null,
        ], ['Cache-Control' => 'no-store']];
    }

    /** Loads the Composer packages and reports what failed: exception type and file:line only. */
    private static function packageCheck(): array
    {
        $out = [];
        foreach (['mailer' => [\PHPMailer\PHPMailer\PHPMailer::class], 'claude' => [\GuzzleHttp\Client::class, \Anthropic\Client::class]] as $name => $classes) {
            try {
                $ok = true;
                foreach ($classes as $class) {
                    $ok = $ok && class_exists($class);
                }
                $out[$name] = $ok;
            } catch (\Throwable $e) {
                $file = str_replace('\\', '/', $e->getFile());
                $out[$name] = false;
                $out[$name . 'Error'] = $e::class . ' at ' . (preg_match('#/(vendor/.+|src/.+)$#', $file, $m) ? $m[1] : basename($file)) . ':' . $e->getLine();
            }
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $body
     * @param array<string, string> $headers
     */
    public static function send(int $status, array $body, array $headers = []): void
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('X-Content-Type-Options: nosniff');
            header('Referrer-Policy: no-referrer');
            foreach ($headers as $name => $value) {
                header($name . ': ' . $value);
            }
        }
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
            echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
        }
    }
}
