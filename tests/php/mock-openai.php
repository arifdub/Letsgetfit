<?php

declare(strict_types=1);

// Mock of the OpenAI Chat Completions endpoint for integration tests (router for `php -S`).
// The behaviour is chosen by the "model" field: mock-ok, mock-slow, mock-refuse, mock-notfood,
// mock-500. Requires "Authorization: Bearer sk-test". Counts calls in MOCK_OPENAI_COUNT_FILE.

$countFile = getenv('MOCK_OPENAI_COUNT_FILE') ?: sys_get_temp_dir() . '/mock-openai-count';
header('Content-Type: application/json');
if (!str_starts_with((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/v1/chat/completions')) {
    http_response_code(404);
    echo '{}';
    return;
}
file_put_contents($countFile, (string) ((int) @file_get_contents($countFile) + 1));
if (($_SERVER['HTTP_AUTHORIZATION'] ?? '') !== 'Bearer sk-test') {
    http_response_code(401);
    echo '{"error":{"message":"Incorrect API key"}}';
    return;
}
$req = json_decode((string) file_get_contents('php://input'), true);
$url = $req['messages'][1]['content'][1]['image_url']['url'] ?? '';
if (!str_starts_with($url, 'data:image/jpeg;base64,') || ($req['response_format']['json_schema']['strict'] ?? false) !== true) {
    http_response_code(400);
    echo '{"error":{"message":"bad request"}}';
    return;
}
$reply = static function (array $content, ?string $refusal = null): void {
    echo json_encode(['choices' => [['finish_reason' => 'stop', 'message' => ['role' => 'assistant', 'content' => json_encode($content), 'refusal' => $refusal]]]]);
};
switch ($req['model'] ?? '') {
    case 'mock-slow':
        sleep(7); // longer than the 5-second minimum timeout
        $reply(['is_food' => true, 'image_quality' => 'good', 'items' => [], 'questions' => []]);
        break;
    case 'mock-refuse':
        $reply([], 'I can’t help with that.');
        break;
    case 'mock-notfood':
        $reply(['is_food' => false, 'image_quality' => 'good', 'items' => [], 'questions' => []]);
        break;
    case 'mock-500':
        http_response_code(500);
        echo '{"error":{"message":"server error"}}';
        break;
    default:
        $reply([
            'is_food' => true,
            'image_quality' => 'good',
            'items' => [
                ['name' => 'Apple slices', 'search_term' => 'apple', 'preparation' => 'raw', 'grams_estimate' => 120, 'grams_low' => 90, 'grams_high' => 150, 'confidence' => 'high'],
                ['name' => 'Peanut butter', 'search_term' => 'peanut butter', 'preparation' => 'unspecified', 'grams_estimate' => 30, 'grams_low' => 15, 'grams_high' => 45, 'confidence' => 'medium'],
            ],
            'questions' => ['Was there any honey or sugar added?'],
        ]);
}
