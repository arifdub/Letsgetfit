<?php

declare(strict_types=1);

// Mock of the FoodData Central search API for integration tests (router for `php -S`).
// Behaviour depends on the query: "slow" sleeps past the timeout, "error" returns 500,
// "busy" returns 429; anything else returns the apple fixture. Requires X-Api-Key: test-key.

$countFile = getenv('MOCK_FDC_COUNT_FILE') ?: sys_get_temp_dir() . '/mock-fdc-count';
file_put_contents($countFile, (string) ((int) @file_get_contents($countFile) + 1));

header('Content-Type: application/json');
if (($_SERVER['HTTP_X_API_KEY'] ?? '') !== 'test-key') {
    http_response_code(403);
    echo '{"error":{"code":"API_KEY_INVALID"}}';
    return;
}
if (!str_starts_with((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/v1/foods/search')) {
    http_response_code(404);
    echo '{}';
    return;
}
$q = (string) ($_GET['query'] ?? '');
if ($q === 'slow') {
    sleep(4);
}
if ($q === 'error') {
    http_response_code(500);
    echo 'Internal error';
    return;
}
if ($q === 'busy') {
    http_response_code(429);
    echo '{"error":"OVER_RATE_LIMIT"}';
    return;
}
echo file_get_contents(__DIR__ . '/fixtures/fdc-search-apple.json');
