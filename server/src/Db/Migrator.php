<?php

declare(strict_types=1);

namespace LetsGetFit\Db;

use PDO;

/**
 * Applies server/migrations/NNN_name.sql files in order, once each. Never run automatically on
 * deploy: run by hand (bin/migrate.php) after taking a backup. See docs/DATABASE.md.
 */
final class Migrator
{
    public function __construct(private PDO $pdo, private string $dir)
    {
    }

    /** @return list<string> migration versions found on disk, in order */
    public function available(): array
    {
        $files = glob($this->dir . '/*.sql') ?: [];
        sort($files, SORT_STRING);

        return array_map(static fn (string $f): string => basename($f, '.sql'), $files);
    }

    /** @return list<string> */
    public function applied(): array
    {
        try {
            return $this->pdo->query('SELECT version FROM schema_migrations ORDER BY version')->fetchAll(PDO::FETCH_COLUMN);
        } catch (\PDOException) {
            return [];
        }
    }

    /** @return list<string> */
    public function pending(): array
    {
        return array_values(array_diff($this->available(), $this->applied()));
    }

    /** @return list<string> versions applied now */
    public function migrate(): array
    {
        $done = [];
        foreach ($this->pending() as $version) {
            $sql = (string) file_get_contents($this->dir . '/' . $version . '.sql');
            foreach (self::statements($sql) as $statement) {
                $this->pdo->exec($statement);
            }
            $stmt = $this->pdo->prepare('INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES (?, UTC_TIMESTAMP())');
            $stmt->execute([$version]);
            $done[] = $version;
        }

        return $done;
    }

    /** Split a migration file into statements (one per ';' at the end of a line; no procedures). */
    public static function statements(string $sql): array
    {
        $lines = array_filter(explode("\n", $sql), static fn (string $l): bool => !str_starts_with(ltrim($l), '--'));
        $parts = preg_split('/;\s*$/m', implode("\n", $lines)) ?: [];

        return array_values(array_filter(array_map('trim', $parts), static fn (string $s): bool => $s !== ''));
    }
}
