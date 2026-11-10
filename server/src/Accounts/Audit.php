<?php

declare(strict_types=1);

namespace LetsGetFit\Accounts;

use PDO;

/**
 * A short audit trail of account and admin actions. Holds the acting user's ID, an action name
 * and a short detail (a setting name or a target user ID): never emails, health data or secrets.
 */
final class Audit
{
    public static function log(PDO $pdo, ?string $actorId, string $action, ?string $detail = null): void
    {
        try {
            $pdo->prepare('INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())')
                ->execute([$actorId, substr($action, 0, 48), $detail === null ? null : substr($detail, 0, 255)]);
        } catch (\PDOException $e) {
            error_log('LetsGetFit audit error: ' . $e::class);
        }
    }

    /** @return list<array<string, mixed>> */
    public static function recent(PDO $pdo, int $limit = 100): array
    {
        $stmt = $pdo->prepare('SELECT a.id, a.action, a.detail, a.created_at, a.actor_id, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ' . max(1, min(500, $limit)));
        $stmt->execute();

        return $stmt->fetchAll();
    }

    public static function prune(PDO $pdo, int $days = 365): int
    {
        return (int) $pdo->exec('DELETE FROM audit_log WHERE created_at < UTC_TIMESTAMP() - INTERVAL ' . max(30, $days) . ' DAY');
    }
}
