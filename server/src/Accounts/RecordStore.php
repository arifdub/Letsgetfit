<?php

declare(strict_types=1);

namespace LetsGetFit\Accounts;

use LetsGetFit\Db\Database;
use PDO;

/**
 * Per-user record storage for sync. Every query is scoped by the user ID taken from the session,
 * so one user can never read or overwrite another user's records, even with the same record ID.
 * Conflicts resolve last-write-wins on the client's updatedAt (UTC); deletions are tombstones.
 */
final class RecordStore
{
    public const COLLECTIONS = ['profile', 'preferences', 'workouts', 'weights', 'foods', 'diary'];
    public const SINGLETONS = ['profile', 'preferences'];
    public const MAX_PUSH = 500;
    public const MAX_RECORD_BYTES = 65536;
    public const MAX_RECORDS_PER_USER = 20000;
    public const PULL_PAGE = 1000;

    public function __construct(private PDO $pdo)
    {
    }

    /**
     * @param array<mixed> $raw
     * @return array{0: ?array{collection: string, id: string, updatedAt: string, deleted: bool, data: ?string}, 1: ?string}
     */
    public static function validate(mixed $raw): array
    {
        if (!is_array($raw)) {
            return [null, 'not_an_object'];
        }
        $collection = $raw['collection'] ?? null;
        if (!is_string($collection) || !in_array($collection, self::COLLECTIONS, true)) {
            return [null, 'unknown_collection'];
        }
        $id = $raw['id'] ?? null;
        if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id)) {
            return [null, 'invalid_id'];
        }
        if (in_array($collection, self::SINGLETONS, true) && $id !== $collection) {
            return [null, 'invalid_id'];
        }
        $updated = self::parseTime($raw['updatedAt'] ?? null);
        if ($updated === null) {
            return [null, 'invalid_updated_at'];
        }
        $deleted = ($raw['deleted'] ?? false) === true;
        $data = null;
        if (!$deleted) {
            if (!is_array($raw['data'] ?? null)) {
                return [null, 'missing_data'];
            }
            $data = json_encode($raw['data'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
            if ($data === false || strlen($data) > self::MAX_RECORD_BYTES) {
                return [null, 'too_large'];
            }
        }

        return [['collection' => $collection, 'id' => $id, 'updatedAt' => $updated, 'deleted' => $deleted, 'data' => $data], null];
    }

    /** ISO 8601 → 'Y-m-d H:i:s.v' UTC, rejecting dates far in the future. */
    public static function parseTime(mixed $value): ?string
    {
        if (!is_string($value) || strlen($value) > 40) {
            return null;
        }
        try {
            $dt = new \DateTimeImmutable($value);
        } catch (\Exception) {
            return null;
        }
        $utc = $dt->setTimezone(new \DateTimeZone('UTC'));
        if ($utc->getTimestamp() > time() + 86400 || $utc->getTimestamp() < 946684800) {
            return null;
        }

        return $utc->format('Y-m-d H:i:s.v');
    }

    /**
     * @param list<mixed> $records
     * @return array{accepted: int, unchanged: int, rejected: list<array{index: int, reason: string}>}
     */
    public function push(string $userId, array $records): array
    {
        $accepted = 0;
        $unchanged = 0;
        $rejected = [];
        $count = (int) $this->scalar('SELECT COUNT(*) FROM records WHERE user_id = ?', [$userId]);
        $this->pdo->beginTransaction();
        try {
            $select = $this->pdo->prepare('SELECT client_updated_at FROM records WHERE user_id = ? AND collection = ? AND record_id = ? FOR UPDATE');
            $insert = $this->pdo->prepare('INSERT INTO records (user_id, collection, record_id, data, deleted, client_updated_at, server_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $update = $this->pdo->prepare('UPDATE records SET data = ?, deleted = ?, client_updated_at = ?, server_updated_at = ? WHERE user_id = ? AND collection = ? AND record_id = ?');
            foreach ($records as $index => $raw) {
                [$r, $reason] = self::validate($raw);
                if ($r === null) {
                    $rejected[] = ['index' => (int) $index, 'reason' => (string) $reason];
                    continue;
                }
                $select->execute([$userId, $r['collection'], $r['id']]);
                $existing = $select->fetchColumn();
                $select->closeCursor();
                $now = Database::now();
                if ($existing === false) {
                    if ($count >= self::MAX_RECORDS_PER_USER) {
                        $rejected[] = ['index' => (int) $index, 'reason' => 'quota_exceeded'];
                        continue;
                    }
                    $insert->execute([$userId, $r['collection'], $r['id'], $r['data'], $r['deleted'] ? 1 : 0, $r['updatedAt'], $now]);
                    $count++;
                    $accepted++;
                } elseif (strcmp($r['updatedAt'], substr((string) $existing, 0, 23)) > 0) {
                    $update->execute([$r['data'], $r['deleted'] ? 1 : 0, $r['updatedAt'], $now, $userId, $r['collection'], $r['id']]);
                    $accepted++;
                } else {
                    $unchanged++; // the server already has this version or a newer one
                }
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return ['accepted' => $accepted, 'unchanged' => $unchanged, 'rejected' => $rejected];
    }

    /**
     * Records changed after the cursor, oldest first, in pages. The cursor is
     * "server time|collection|record id" of the last record returned, so records that share a
     * timestamp are never skipped at a page boundary.
     * @return array{records: list<array<string, mixed>>, cursor: ?string, more: bool}
     */
    public function pull(string $userId, ?string $cursor): array
    {
        $params = [$userId];
        $sql = 'SELECT collection, record_id, data, deleted, client_updated_at, server_updated_at FROM records WHERE user_id = ?';
        if ($cursor !== null) {
            [$time, $collection, $id] = explode('|', $cursor, 3);
            $sql .= ' AND (server_updated_at > ? OR (server_updated_at = ? AND (collection > ? OR (collection = ? AND record_id > ?))))';
            array_push($params, $time, $time, $collection, $collection, $id);
        }
        $sql .= ' ORDER BY server_updated_at, collection, record_id LIMIT ' . (self::PULL_PAGE + 1);
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $more = count($rows) > self::PULL_PAGE;
        $rows = array_slice($rows, 0, self::PULL_PAGE);
        if ($rows) {
            $last = end($rows);
            $cursor = substr((string) $last['server_updated_at'], 0, 23) . '|' . $last['collection'] . '|' . $last['record_id'];
        }

        return [
            'records' => array_map(static fn (array $row): array => [
                'collection' => $row['collection'],
                'id' => $row['record_id'],
                'updatedAt' => self::iso((string) $row['client_updated_at']),
                'deleted' => (bool) $row['deleted'],
                'data' => $row['deleted'] ? null : json_decode((string) $row['data'], true),
            ], $rows),
            'cursor' => $cursor,
            'more' => $more,
        ];
    }

    public static function validCursor(string $cursor): bool
    {
        return (bool) preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?\|(' . implode('|', self::COLLECTIONS) . ')\|[A-Za-z0-9_-]{1,64}$/', $cursor);
    }

    /** @return array<string, list<mixed>|mixed> all live records, grouped by collection */
    public function export(string $userId): array
    {
        $stmt = $this->pdo->prepare('SELECT collection, data FROM records WHERE user_id = ? AND deleted = 0 ORDER BY collection, record_id');
        $stmt->execute([$userId]);
        $out = array_fill_keys(self::COLLECTIONS, []);
        foreach ($stmt->fetchAll() as $row) {
            $out[$row['collection']][] = json_decode((string) $row['data'], true);
        }
        foreach (self::SINGLETONS as $single) {
            $out[$single] = $out[$single][0] ?? null;
        }

        return $out;
    }

    /** @return array<string, int> live record counts per collection */
    public function counts(string $userId): array
    {
        $stmt = $this->pdo->prepare('SELECT collection, COUNT(*) AS n FROM records WHERE user_id = ? AND deleted = 0 GROUP BY collection');
        $stmt->execute([$userId]);
        $out = array_fill_keys(self::COLLECTIONS, 0);
        foreach ($stmt->fetchAll() as $row) {
            $out[$row['collection']] = (int) $row['n'];
        }

        return $out;
    }

    private static function iso(string $mysql): string
    {
        return (new \DateTimeImmutable($mysql, new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    }

    /** @param list<mixed> $params */
    private function scalar(string $sql, array $params): mixed
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchColumn();
    }
}
