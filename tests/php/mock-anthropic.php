<?php

declare(strict_types=1);

// Mock of the Anthropic Messages API for integration tests (router for `php -S`).
// The behaviour is chosen by the "model" field: mock-ok, mock-slow, mock-refuse, mock-notfood,
// mock-maxtokens, mock-500. Requires the API key "sk-ant-test-key-0123456789abcdef". Checks that
// the request has the image, structured output schema, adaptive thinking and default fallbacks.
// Counts calls in MOCK_ANTHROPIC_COUNT_FILE.

$countFile = getenv('MOCK_ANTHROPIC_COUNT_FILE') ?: sys_get_temp_dir() . '/mock-anthropic-count';
header('Content-Type: application/json');
if (!str_starts_with((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/v1/messages')) {
    http_response_code(404);
    echo '{"type":"error","error":{"type":"not_found_error","message":"not found"}}';
    return;
}
file_put_contents($countFile, (string) ((int) @file_get_contents($countFile) + 1));
$key = 'sk-ant-test-key-0123456789abcdef';
$given = $_SERVER['HTTP_X_API_KEY'] ?? preg_replace('/^Bearer\s+/', '', (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
if ($given !== $key) {
    http_response_code(401);
    echo '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    return;
}
$req = json_decode((string) file_get_contents('php://input'), true);
$image = $req['messages'][0]['content'][0] ?? [];
$isText = ($image['type'] ?? '') === 'text' && str_starts_with((string) ($image['text'] ?? ''), 'What I ate:');
$ok = ($isText || (($image['type'] ?? '') === 'image'
    && ($image['source']['type'] ?? '') === 'base64'
    && ($image['source']['media_type'] ?? '') === 'image/jpeg'
    && base64_decode((string) ($image['source']['data'] ?? ''), true) !== false))
    && ($req['output_config']['format']['type'] ?? '') === 'json_schema'
    && ($req['output_config']['format']['schema']['additionalProperties'] ?? null) === false
    && ($req['thinking']['type'] ?? '') === 'adaptive'
    && ($req['fallbacks'] ?? null) === 'default'
    && str_contains((string) ($_SERVER['HTTP_ANTHROPIC_BETA'] ?? ''), 'server-side-fallback-2026-07-01');
if (!$ok) {
    http_response_code(400);
    echo '{"type":"error","error":{"type":"invalid_request_error","message":"unexpected request shape"}}';
    return;
}
$reply = static function (array|string $content, string $stop = 'end_turn'): void {
    echo json_encode([
        'id' => 'msg_mock', 'type' => 'message', 'role' => 'assistant', 'model' => 'mock',
        'content' => [['type' => 'thinking', 'thinking' => '', 'signature' => 'sig'], ['type' => 'text', 'text' => is_string($content) ? $content : json_encode($content)]],
        'stop_reason' => $stop, 'stop_sequence' => null,
        'usage' => ['input_tokens' => 1650, 'output_tokens' => 420],
    ]);
};
switch ($req['model'] ?? '') {
    case 'mock-slow':
        sleep(13); // longer than the 10-second minimum timeout
        $reply(['is_food' => true, 'image_quality' => 'good', 'items' => [], 'questions' => []]);
        break;
    case 'mock-refuse':
        $reply('', 'refusal');
        break;
    case 'mock-maxtokens':
        $reply('{"is_food": tr', 'max_tokens');
        break;
    case 'mock-notfood':
        $reply(['is_food' => false, 'image_quality' => 'good', 'items' => [], 'questions' => []]);
        break;
    case 'mock-500':
        http_response_code(500);
        echo '{"type":"error","error":{"type":"api_error","message":"server error"}}';
        break;
    default:
        $reply([
            'is_food' => true,
            'image_quality' => 'good',
            'items' => [
                ['name' => 'Porridge', 'search_term' => 'oats, cooked', 'preparation' => 'cooked', 'grams_estimate' => 250, 'grams_low' => 200, 'grams_high' => 300, 'confidence' => 'high'],
                ['name' => 'Blueberries', 'search_term' => 'blueberries, raw', 'preparation' => 'raw', 'grams_estimate' => 50, 'grams_low' => 30, 'grams_high' => 70, 'confidence' => 'medium'],
                ['name' => 'Honey', 'search_term' => 'honey', 'preparation' => 'unspecified', 'grams_estimate' => 10, 'grams_low' => 5, 'grams_high' => 20, 'confidence' => 'low'],
            ],
            'questions' => ['Was the porridge made with milk or water?'],
        ]);
}
