<?php

declare(strict_types=1);

// Mock Web Push service for integration tests (router for `php -S`). Records each delivery as a
// JSON line in MOCK_PUSH_LOG: path, encoding, TTL, whether a VAPID signature was present, and the
// size of the encrypted body. Paths containing "gone" answer 410 (subscription expired).

$log = getenv('MOCK_PUSH_LOG') ?: sys_get_temp_dir() . '/mock-push.log';
$path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(200);
    return;
}
$body = (string) file_get_contents('php://input');
file_put_contents($log, json_encode([
    'path' => $path,
    'encoding' => $_SERVER['HTTP_CONTENT_ENCODING'] ?? '',
    'ttl' => $_SERVER['HTTP_TTL'] ?? '',
    'vapid' => (bool) preg_match('/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/', $_SERVER['HTTP_AUTHORIZATION'] ?? ''),
    'bytes' => strlen($body),
]) . "\n", FILE_APPEND | LOCK_EX);
http_response_code(str_contains($path, 'gone') ? 410 : 201);
