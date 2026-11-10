<?php

declare(strict_types=1);

use LetsGetFit\Config;
use LetsGetFit\Http\HttpException;
use LetsGetFit\Http\HttpResponse;
use LetsGetFit\Scan\ImageProcessor;
use LetsGetFit\Scan\OpenAiVision;
use LetsGetFit\Scan\ScanException;

function scanConfig(array $over = []): Config
{
    return Config::fromArray($over + [
        'openai_api_key' => 'sk-test-key', 'openai_base_url' => 'https://ai.example/v1', 'openai_model' => 'vision-test',
        'openai_image_detail' => 'low', 'openai_max_output_tokens' => 900, 'scan_timeout_seconds' => 30,
    ]);
}

function openAiReply(array $content, string $finish = 'stop', ?string $refusal = null): HttpResponse
{
    return new HttpResponse(200, (string) json_encode(['choices' => [['finish_reason' => $finish, 'message' => ['content' => json_encode($content), 'refusal' => $refusal]]]]));
}

function testJpeg(int $w = 200, int $h = 150): string
{
    $img = imagecreatetruecolor($w, $h);
    imagefill($img, 0, 0, imagecolorallocate($img, 200, 120, 40));
    ob_start();
    imagejpeg($img, null, 90);

    return (string) ob_get_clean();
}

function expectScanError(callable $fn, string $reason): void
{
    try {
        $fn();
    } catch (ScanException $e) {
        eq($e->reason, $reason);

        return;
    }
    throw new RuntimeException("expected ScanException $reason");
}

const MEAL = [
    'is_food' => true, 'image_quality' => 'good',
    'items' => [
        ['name' => 'Boiled rice', 'search_term' => 'rice, white, cooked', 'preparation' => 'cooked', 'grams_estimate' => 180, 'grams_low' => 140, 'grams_high' => 220, 'confidence' => 'medium'],
        ['name' => 'Chicken curry', 'search_term' => 'chicken curry', 'preparation' => 'cooked', 'grams_estimate' => 250, 'grams_low' => 200, 'grams_high' => 320, 'confidence' => 'low'],
    ],
    'questions' => ['Was the curry made with cream or coconut milk?'],
];

test('OpenAI request: key in header only, strict schema, low-detail image, output cap', function () {
    $http = new FakeHttp(openAiReply(MEAL));
    $out = (new OpenAiVision($http, scanConfig()))->analyse(testJpeg());
    $call = $http->calls[0];
    eq($call['url'], 'https://ai.example/v1/chat/completions');
    eq($call['headers']['Authorization'], 'Bearer sk-test-key');
    $body = json_decode($call['body'], true);
    eq($body['model'], 'vision-test');
    eq($body['response_format']['type'], 'json_schema');
    eq($body['response_format']['json_schema']['strict'], true);
    eq($body['max_completion_tokens'], 900);
    $image = $body['messages'][1]['content'][1]['image_url'];
    ok(str_starts_with($image['url'], 'data:image/jpeg;base64,/9j/'), 'JPEG data URL');
    eq($image['detail'], 'low');
    ok(!str_contains($call['url'], 'sk-test'), 'no key in URL');
    ok(str_contains($body['messages'][0]['content'], 'Do not estimate calories'), 'model not asked for nutrients');
    eq($call['timeouts'], [5, 30]);
    eq(count($out['items']), 2);
    eq($out['items'][0]['searchTerm'], 'rice, white, cooked');
    eq([$out['items'][0]['gramsLow'], $out['items'][0]['gramsEstimate'], $out['items'][0]['gramsHigh']], [140.0, 180.0, 220.0]);
    eq($out['questions'], ['Was the curry made with cream or coconut milk?']);
});

test('model output is sanitised: bad grams dropped, ranges fixed, limits applied, not-food emptied', function () {
    $raw = MEAL;
    $raw['items'][] = ['name' => 'Huge thing', 'search_term' => 'x', 'preparation' => 'fried', 'grams_estimate' => 5000, 'grams_low' => 1, 'grams_high' => 9, 'confidence' => 'certain'];
    $raw['items'][] = ['name' => "  Peas\n\u{0007}  ", 'search_term' => '', 'preparation' => 'boiled', 'grams_estimate' => 80, 'grams_low' => 100, 'grams_high' => 50, 'confidence' => 'sure'];
    for ($i = 0; $i < 20; $i++) {
        $raw['items'][] = MEAL['items'][0];
    }
    $raw['questions'] = ['a?', 'b?', 'c?', 'd?'];
    $out = OpenAiVision::sanitise($raw);
    eq(count($out['items']), OpenAiVision::MAX_ITEMS);
    ok(!in_array('Huge thing', array_column($out['items'], 'name'), true), 'implausible grams dropped');
    $peas = $out['items'][2];
    eq($peas['name'], 'Peas');
    eq($peas['searchTerm'], 'Peas');
    eq($peas['preparation'], 'unspecified');
    eq($peas['confidence'], 'low');
    eq([$peas['gramsLow'], $peas['gramsHigh']], [80.0, 80.0], 'low ≤ estimate ≤ high');
    eq(count($out['questions']), 3);
    $notFood = OpenAiVision::sanitise(['is_food' => false, 'image_quality' => 'good', 'items' => MEAL['items'], 'questions' => ['x?']]);
    eq([$notFood['isFood'], $notFood['items'], $notFood['questions']], [false, [], []]);
});

test('provider failures map to safe errors', function () {
    $cases = [
        [new HttpException(HttpException::TIMEOUT), 'timeout'],
        [new HttpException(HttpException::NETWORK), 'provider_unavailable'],
        [new HttpResponse(401, '{}'), 'not_configured'],
        [new HttpResponse(429, '{}'), 'provider_busy'],
        [new HttpResponse(400, '{"error":{"message":"invalid image"}}'), 'bad_image'],
        [new HttpResponse(500, 'oops'), 'provider_unavailable'],
        [new HttpResponse(200, 'not json'), 'provider_unavailable'],
        [new HttpResponse(200, '{"choices":[{"message":{"content":"not json"}}]}'), 'provider_unavailable'],
        [openAiReply([], 'stop', 'I cannot help with that.'), 'refused'],
        [openAiReply(MEAL, 'length'), 'incomplete'],
    ];
    foreach ($cases as [$next, $reason]) {
        expectScanError(fn () => (new OpenAiVision(new FakeHttp($next), scanConfig()))->analyse(testJpeg()), $reason);
    }
    expectScanError(fn () => (new OpenAiVision(new FakeHttp(openAiReply(MEAL)), scanConfig(['openai_api_key' => ''])))->analyse(testJpeg()), 'not_configured');
});

test('image processing removes metadata, resizes, and re-encodes as JPEG', function () {
    $jpeg = testJpeg(3000, 2000);
    // Insert an EXIF APP1 segment with a recognisable "GPS" payload right after the SOI marker.
    $payload = "Exif\0\0GPS-SECRET-MARKER-53.3498N-6.2603W";
    $withExif = substr($jpeg, 0, 2) . "\xFF\xE1" . pack('n', strlen($payload) + 2) . $payload . substr($jpeg, 2);
    ok(str_contains($withExif, 'GPS-SECRET-MARKER'), 'fixture has metadata');
    $out = (new ImageProcessor(8_000_000))->process($withExif);
    ok(str_starts_with($out['jpeg'], "\xFF\xD8"), 'JPEG');
    ok(!str_contains($out['jpeg'], 'GPS-SECRET-MARKER'), 'metadata removed');
    ok(!str_contains($out['jpeg'], 'Exif'), 'no EXIF segment');
    eq([$out['width'], $out['height']], [1280, 853]);
    $png = (function () {
        $img = imagecreatetruecolor(300, 300);
        ob_start();
        imagepng($img);

        return (string) ob_get_clean();
    })();
    ok(str_starts_with((new ImageProcessor(8_000_000))->process($png)['jpeg'], "\xFF\xD8"), 'PNG converted to JPEG');
});

test('image checks reject non-images, tiny images and oversized files', function () {
    $p = new ImageProcessor(50_000);
    expectScanError(fn () => $p->process(''), 'no_image');
    expectScanError(fn () => $p->process('<?php echo "hi";'), 'unsupported_type');
    expectScanError(fn () => $p->process("GIF89a" . str_repeat("\0", 100)), 'unsupported_type');
    expectScanError(fn () => $p->process(testJpeg(20, 20)), 'bad_image');
    expectScanError(fn () => $p->process(str_repeat('x', 60_000)), 'too_large');
    // A JPEG header that claims huge dimensions is refused before decoding.
    $fake = testJpeg(100, 100);
    $pos = strpos($fake, "\xFF\xC0");
    $bomb = substr_replace($fake, pack('n', 20000) . pack('n', 20000), $pos + 5, 4);
    expectScanError(fn () => (new ImageProcessor(8_000_000))->process($bomb), 'too_large');
});

test('scan statistics: averages, cost from prices, usefulness from feedback, no personal data', function () {
    $dir = sys_get_temp_dir() . '/lgf-stats-' . bin2hex(random_bytes(4));
    $stats = new \LetsGetFit\Scan\ScanStats($dir, fn () => strtotime('2026-11-10 12:00:00 UTC'));
    $stats->scan('claude', 'claude-opus-5-5', 4000, null, 1600, 400, 3);
    $stats->scan('claude', 'claude-opus-5-5', 6000, null, 1400, 600, 1);
    $stats->scan('claude', 'claude-opus-5-5', 900, 'timeout');
    $stats->scan('openai', 'gpt-4o-mini', 2000, null, 3000, 300, 2);
    $stats->feedback('claude', 'claude-opus-5-5', 3, 1, 0, 1);
    $stats->scan('bad provider!', 'x', 1, null); // ignored
    $config = \LetsGetFit\Config::fromArray(['openai_price_input' => 0.15, 'openai_price_output' => 0.60, 'claude_price_input' => 0, 'claude_price_output' => 0]);
    $report = $stats->report('2026-11', $config);
    eq(count($report), 2);
    [$claude, $openai] = $report;
    eq([$claude['provider'], $claude['scans'], $claude['successRate'], $claude['avgSeconds'], $claude['avgInputTokens'], $claude['avgOutputTokens'], $claude['avgItems']], ['claude', 3, 0.667, 5.0, 1500, 500, 2.0]);
    // Opus 5.5 list price: (3000 × $4 + 1000 × $20) / 1M = $0.032 total, $0.016 per successful scan.
    eq([$claude['costTotal'], $claude['costPerScan']], [0.032, 0.016]);
    eq([$claude['saved'], $claude['keptRate'], $claude['changedRate'], $claude['removedRate'], $claude['addedPerSave']], [1, 0.75, 0.25, 0.0, 1.0]);
    eq($openai['costPerScan'], round((3000 * 0.15 + 300 * 0.60) / 1_000_000, 5));
    // An admin override replaces the built-in Claude price.
    $over = $stats->report('2026-11', $config->withOverrides(['claude_price_input' => 1.0, 'claude_price_output' => 5.0]));
    eq($over[0]['costTotal'], round((3000 * 1 + 1000 * 5) / 1_000_000, 4));
    eq($stats->month(-1), '2026-10');
    ok(!str_contains((string) file_get_contents($dir . '/2026-11.json'), 'bad provider'), 'invalid keys are not stored');
    eq($stats->report('2026-09', $config), []);
});

test('admin settings accept the scan provider, Claude key, effort and prices', function () {
    $v = [\LetsGetFit\Settings\SettingsStore::class, 'validate'];
    eq($v('enum:openai:claude:alternate', 'claude'), null);
    ok($v('enum:openai:claude:alternate', 'gemini') !== null, 'unknown provider');
    eq($v('secret', 'sk-ant-api03-AbC_dEf-123456'), null);
    eq($v('price', '0.15'), null);
    eq($v('price', 20), null);
    ok($v('price', '-1') !== null && $v('price', 'cheap') !== null, 'bad prices');
    eq(\LetsGetFit\Scan\ClaudeVision::prices(\LetsGetFit\Config::fromArray(['claude_price_input' => 0, 'claude_price_output' => 0]), 'claude-haiku-5-5'), [0.10, 0.50]);
});
