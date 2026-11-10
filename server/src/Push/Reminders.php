<?php

declare(strict_types=1);

namespace LetsGetFit\Push;

/**
 * Reminder settings and the "is it due?" rule. Pure logic, no database or network.
 *
 * A reminder is {type, time "HH:MM", days [1-7, Monday = 1]} in the person's own time zone. It is
 * due once a day, at or after its time, and only within two hours of it, so a late run of the
 * scheduler never sends yesterday's reminder in the middle of the night.
 */
final class Reminders
{
    public const TYPES = [
        'meals' => ['title' => 'Food diary', 'body' => 'A reminder to add what you have eaten today, if you want to.', 'url' => './#food'],
        'weight' => ['title' => 'Weigh-in', 'body' => 'A reminder to log today\'s weight, if you weigh yourself today.', 'url' => './#progress'],
        'workout' => ['title' => 'Workouts', 'body' => 'A reminder to log any activity today, or start a routine.', 'url' => './#workouts'],
    ];
    public const MAX = 6;
    private const WINDOW_SECONDS = 7200;

    /**
     * @return array{0: list<array{type: string, time: string, days: list<int>}>, 1: ?string} [clean list, error]
     */
    public static function validate(mixed $raw): array
    {
        if ($raw === null) {
            return [[], null];
        }
        if (!is_array($raw) || !array_is_list($raw) || count($raw) > self::MAX) {
            return [[], 'Choose up to ' . self::MAX . ' reminders.'];
        }
        $out = [];
        foreach ($raw as $r) {
            if (!is_array($r) || !isset(self::TYPES[$r['type'] ?? '']) || !is_string($r['time'] ?? null) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $r['time'])) {
                return [[], 'Each reminder needs a type and a time such as 08:30.'];
            }
            $days = $r['days'] ?? [1, 2, 3, 4, 5, 6, 7];
            if (!is_array($days) || $days === []) {
                return [[], 'Choose at least one day for each reminder.'];
            }
            $clean = [];
            foreach ($days as $d) {
                if (!is_int($d) || $d < 1 || $d > 7) {
                    return [[], 'Days are numbered 1 (Monday) to 7 (Sunday).'];
                }
                $clean[$d] = $d;
            }
            ksort($clean);
            $out[] = ['type' => $r['type'], 'time' => $r['time'], 'days' => array_values($clean)];
        }

        return [$out, null];
    }

    public static function validTimezone(mixed $tz): string
    {
        return is_string($tz) && in_array($tz, \DateTimeZone::listIdentifiers(), true) ? $tz : 'Europe/Dublin';
    }

    /** A stable key for one reminder, used to remember when it was last sent. */
    public static function key(array $r): string
    {
        return $r['type'] . '@' . $r['time'];
    }

    /**
     * @param list<array{type: string, time: string, days: list<int>}> $reminders
     * @param array<string, string> $lastSent key => local date (YYYY-MM-DD) it was last sent
     * @return list<array{type: string, time: string, days: list<int>}> reminders due now
     */
    public static function due(array $reminders, array $lastSent, string $timezone, int $now): array
    {
        $local = (new \DateTimeImmutable('@' . $now))->setTimezone(new \DateTimeZone(self::validTimezone($timezone)));
        $today = $local->format('Y-m-d');
        $due = [];
        foreach ($reminders as $r) {
            if (!in_array((int) $local->format('N'), $r['days'], true) || ($lastSent[self::key($r)] ?? '') === $today) {
                continue;
            }
            [$h, $m] = array_map('intval', explode(':', $r['time']));
            $at = $local->setTime($h, $m);
            $late = $local->getTimestamp() - $at->getTimestamp();
            if ($late >= 0 && $late < self::WINDOW_SECONDS) {
                $due[] = $r;
            }
        }

        return $due;
    }

    /** @return array{title: string, body: string, url: string, tag: string} */
    public static function message(string $type): array
    {
        $t = self::TYPES[$type] ?? self::TYPES['meals'];

        return $t + ['tag' => 'reminder-' . $type];
    }

    /** Local date in the person's time zone, for remembering what was sent today. */
    public static function localDate(string $timezone, int $now): string
    {
        return (new \DateTimeImmutable('@' . $now))->setTimezone(new \DateTimeZone(self::validTimezone($timezone)))->format('Y-m-d');
    }
}
