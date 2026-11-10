<?php

declare(strict_types=1);

use LetsGetFit\Accounts\AccountController;
use LetsGetFit\Accounts\RecordStore;
use LetsGetFit\Auth\Passwords;
use LetsGetFit\Db\Migrator;

test('password policy: length, common, repeated, contains email', function () {
    eq(Passwords::problem('correct horse battery staple'), null);
    ok(Passwords::problem('short') !== null, 'too short');
    ok(Passwords::problem(str_repeat('a', 129)) !== null, 'too long');
    ok(Passwords::problem('password1234') !== null, 'common');
    ok(Passwords::problem('zzzzzzzzzzzzzzz') !== null, 'repeated');
    ok(Passwords::problem('siobhan-likes-running', 'siobhan@example.ie') !== null, 'contains email');
    $hash = Passwords::hash('correct horse battery staple');
    ok(Passwords::verify('correct horse battery staple', $hash), 'verifies');
    ok(!Passwords::verify('wrong', $hash), 'rejects');
    ok(!Passwords::verify('anything', Passwords::dummyHash()), 'dummy hash never matches');
});

test('email normalisation', function () {
    eq(AccountController::email('  Aoife@Example.IE '), 'aoife@example.ie');
    eq(AccountController::email('not an email'), null);
    eq(AccountController::email(['x']), null);
    eq(AccountController::email(str_repeat('a', 250) . '@x.ie'), null);
});

test('migration files split into statements and every file records itself', function () {
    foreach (glob(__DIR__ . '/../../server/migrations/*.sql') as $file) {
        $statements = Migrator::statements((string) file_get_contents($file));
        ok(count($statements) >= 2, basename($file));
        ok(str_contains(end($statements), 'schema_migrations') && str_contains(end($statements), basename($file, '.sql')), 'last statement records ' . basename($file));
    }
    eq(Migrator::statements("-- c\nCREATE TABLE a (x INT);\n\nINSERT INTO a VALUES (1);\n"), ['CREATE TABLE a (x INT)', 'INSERT INTO a VALUES (1)']);
});

test('record validation', function () {
    [$r] = RecordStore::validate(['collection' => 'weights', 'id' => 'abc-1', 'updatedAt' => '2026-11-01T08:00:00.123+01:00', 'data' => ['weightKg' => 70.0]]);
    eq($r['updatedAt'], '2026-11-01 07:00:00.123', 'converted to UTC');
    eq($r['data'], '{"weightKg":70.0}');
    eq(RecordStore::validate(['collection' => 'weights', 'id' => 'a', 'updatedAt' => '2026-11-01T08:00:00Z', 'deleted' => true])[0]['data'], null);
    eq(RecordStore::validate('x')[1], 'not_an_object');
    eq(RecordStore::validate(['collection' => 'profile', 'id' => 'other', 'updatedAt' => '2026-11-01T08:00:00Z', 'data' => []])[1], 'invalid_id');
    ok(RecordStore::validCursor('2026-11-01 08:00:00.123|weights|abc-1'), 'cursor ok');
    ok(!RecordStore::validCursor("2026-11-01 08:00:00|weights|x' OR 1=1"), 'cursor injection rejected');
});

test('admin setting validation and config overrides', function () {
    eq(\LetsGetFit\Settings\SettingsStore::validate('bool', true), null);
    ok(\LetsGetFit\Settings\SettingsStore::validate('bool', 'yes') !== null, 'bool must be a boolean');
    eq(\LetsGetFit\Settings\SettingsStore::validate('int:1:10000', 50), null);
    ok(\LetsGetFit\Settings\SettingsStore::validate('int:1:10000', 0) !== null, 'below the minimum');
    ok(\LetsGetFit\Settings\SettingsStore::validate('int:1:10000', '5; DROP') !== null, 'not a number');
    eq(\LetsGetFit\Settings\SettingsStore::validate('secret', 'sk-proj-abc_DEF-123456'), null);
    ok(\LetsGetFit\Settings\SettingsStore::validate('secret', "sk-abc'; --") !== null, 'odd characters rejected');
    ok(\LetsGetFit\Settings\SettingsStore::validate('model', 'gpt 4o') !== null, 'model names have no spaces');
    $config = \LetsGetFit\Config::fromArray(['openai_model' => 'gpt-4o-mini', 'scan_enabled' => true]);
    $over = $config->withOverrides(['openai_model' => 'gpt-4.1-mini', 'db_password' => 'injected']);
    eq($over->string('openai_model'), 'gpt-4.1-mini');
    eq($over->string('db_password'), '', 'unknown keys are ignored');
    eq($config->string('openai_model'), 'gpt-4o-mini', 'the original is unchanged');
});
