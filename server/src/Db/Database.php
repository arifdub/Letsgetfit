<?php

declare(strict_types=1);

namespace LetsGetFit\Db;

use LetsGetFit\Config;
use PDO;

/** PDO connection to MySQL / MariaDB with safe defaults. Every query uses prepared statements. */
final class Database
{
    public static function connect(Config $config): PDO
    {
        $dsn = $config->string('db_dsn');
        if ($dsn === '' || !str_starts_with($dsn, 'mysql:')) {
            throw new \RuntimeException('Database is not configured.');
        }
        $pdo = new PDO($dsn, $config->string('db_user'), $config->string('db_password'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'");

        return $pdo;
    }

    /** Current UTC time as a DATETIME(3) string. */
    public static function now(): string
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.v');
    }
}
