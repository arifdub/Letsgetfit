<?php

declare(strict_types=1);

// Minimal PHP test runner (no Composer needed). Usage: php tests/php/run.php

require __DIR__ . '/../../server/bootstrap.php';

$tests = [];
$failures = 0;
function test(string $name, callable $fn): void
{
    $GLOBALS['tests'][$name] = $fn;
}
function eq(mixed $actual, mixed $expected, string $msg = ''): void
{
    if ($actual !== $expected) {
        throw new RuntimeException(($msg !== '' ? $msg . ': ' : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}
function near(?float $actual, float $expected, string $msg = '', float $tol = 1e-6): void
{
    if ($actual === null || abs($actual - $expected) > $tol) {
        throw new RuntimeException(($msg !== '' ? $msg . ': ' : '') . "expected $expected, got " . var_export($actual, true));
    }
}
function ok(bool $cond, string $msg): void
{
    if (!$cond) {
        throw new RuntimeException($msg);
    }
}
function tmpdir(): string
{
    $d = sys_get_temp_dir() . '/lgf-php-' . bin2hex(random_bytes(6));
    mkdir($d, 0700, true);

    return $d;
}

foreach (glob(__DIR__ . '/*Test.php') as $file) {
    require $file;
}

foreach ($tests as $name => $fn) {
    try {
        $fn();
        echo "  ok  $name\n";
    } catch (Throwable $e) {
        $failures++;
        echo "  FAIL $name\n       " . $e->getMessage() . "\n";
    }
}
$count = count($tests);
echo "\n" . ($count - $failures) . "/$count PHP tests passed\n";
exit($failures > 0 ? 1 : 0);
