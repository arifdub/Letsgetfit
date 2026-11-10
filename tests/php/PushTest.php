<?php

declare(strict_types=1);

use LetsGetFit\Push\Reminders;

test('reminders: validation', function () {
    [$ok, $err] = Reminders::validate([['type' => 'meals', 'time' => '19:30'], ['type' => 'weight', 'time' => '07:00', 'days' => [7, 1, 1]]]);
    eq($err, null);
    eq($ok, [['type' => 'meals', 'time' => '19:30', 'days' => [1, 2, 3, 4, 5, 6, 7]], ['type' => 'weight', 'time' => '07:00', 'days' => [1, 7]]]);
    ok(Reminders::validate([['type' => 'spam', 'time' => '07:00']])[1] !== null, 'unknown type');
    ok(Reminders::validate([['type' => 'meals', 'time' => '7am']])[1] !== null, 'bad time');
    ok(Reminders::validate([['type' => 'meals', 'time' => '07:00', 'days' => [0]]])[1] !== null, 'bad day');
    ok(Reminders::validate(array_fill(0, 7, ['type' => 'meals', 'time' => '07:00']))[1] !== null, 'too many');
    eq(Reminders::validate(null), [[], null]);
    eq(Reminders::validTimezone('Europe/Dublin'), 'Europe/Dublin');
    eq(Reminders::validTimezone('Mars/Base'), 'Europe/Dublin');
});

test('reminders: due once a day, at the local time, within two hours, on chosen days', function () {
    $r = [['type' => 'meals', 'time' => '19:30', 'days' => [1, 2, 3, 4, 5, 6, 7]]];
    // Tuesday 10 November 2026, Dublin is UTC+0 in winter.
    $at = static fn (string $utc): int => strtotime($utc . ' UTC');
    eq(Reminders::due($r, [], 'Europe/Dublin', $at('2026-11-10 19:29')), [], 'not yet');
    eq(count(Reminders::due($r, [], 'Europe/Dublin', $at('2026-11-10 19:30'))), 1, 'on time');
    eq(count(Reminders::due($r, [], 'Europe/Dublin', $at('2026-11-10 21:20'))), 1, 'a late run still sends');
    eq(Reminders::due($r, [], 'Europe/Dublin', $at('2026-11-10 21:31')), [], 'too late: skipped');
    eq(Reminders::due($r, ['meals@19:30' => '2026-11-10'], 'Europe/Dublin', $at('2026-11-10 19:45')), [], 'already sent today');
    eq(count(Reminders::due($r, ['meals@19:30' => '2026-11-09'], 'Europe/Dublin', $at('2026-11-10 19:45'))), 1, 'sent yesterday');
    // Time zones: 19:30 in New York is 00:30 UTC the next day.
    eq(count(Reminders::due($r, [], 'America/New_York', $at('2026-11-11 00:35'))), 1, 'local time zone');
    eq(Reminders::localDate('America/New_York', $at('2026-11-11 00:35')), '2026-11-10');
    // Days: Tuesday is 2.
    eq(Reminders::due([['type' => 'weight', 'time' => '08:00', 'days' => [1, 3]]], [], 'Europe/Dublin', $at('2026-11-10 08:05')), [], 'not on Tuesdays');
    eq(Reminders::message('weight')['url'], './#progress');
    ok(!preg_match('/lose|burn|guarantee|must/i', implode(' ', array_column(Reminders::TYPES, 'body'))), 'neutral wording');
});
