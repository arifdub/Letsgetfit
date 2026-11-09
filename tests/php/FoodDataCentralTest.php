<?php

declare(strict_types=1);

use LetsGetFit\Config;
use LetsGetFit\FileCache;
use LetsGetFit\FoodDataCentral;
use LetsGetFit\FoodSearchController;
use LetsGetFit\Http\HttpClient;
use LetsGetFit\Http\HttpException;
use LetsGetFit\Http\HttpResponse;
use LetsGetFit\Nutrients;
use LetsGetFit\RateLimiter;
use LetsGetFit\UpstreamException;

/** Scripted HTTP client for tests. */
final class FakeHttp implements HttpClient
{
    /** @var list<array{url: string, headers: array<string,string>}> */
    public array $calls = [];

    /** @param HttpResponse|HttpException $next */
    public function __construct(public $next)
    {
    }

    public function get(string $url, array $headers, int $connectTimeout, int $timeout): HttpResponse
    {
        $this->calls[] = ['url' => $url, 'headers' => $headers, 'timeouts' => [$connectTimeout, $timeout]];
        if ($this->next instanceof HttpException) {
            throw $this->next;
        }

        return $this->next;
    }
}

function fixture(): string
{
    return (string) file_get_contents(__DIR__ . '/fixtures/fdc-search-apple.json');
}

function config(array $over = []): Config
{
    return Config::fromArray($over + [
        'fdc_api_key' => 'test-key', 'fdc_base_url' => 'https://fdc.example/v1',
        'connect_timeout_seconds' => 4, 'timeout_seconds' => 8,
        'rate_limit_requests' => 3, 'rate_limit_window_seconds' => 300, 'global_requests_per_hour' => 900,
    ]);
}

function controller(FakeHttp $http, ?Config $cfg = null, ?string $dir = null): FoodSearchController
{
    $cfg ??= config();
    $dir ??= tmpdir();

    return new FoodSearchController(new FoodDataCentral($http, $cfg), new FileCache($dir . '/cache', 3600), new RateLimiter($dir . '/rl', 'secret'), $cfg);
}

test('nutrient mapping: numbers, IDs, unit conversion, IU, unknowns', function () {
    $foods = json_decode(fixture(), true)['foods'];
    $fuji = Nutrients::fromFdc($foods[0]['foodNutrients']);
    near($fuji['energy'], 63.0, 'Atwater specific energy used when 208 is absent');
    eq($fuji['fibre'], null, 'missing fibre is unknown');
    eq($fuji['vitaminD'], null);
    $sr = Nutrients::fromFdc($foods[1]['foodNutrients']);
    near($sr['energy'], 52.0, 'kcal preferred over kJ');
    near($sr['vitaminD'], 0.0, 'a real zero stays zero');
    $juice = Nutrients::fromFdc($foods[2]['foodNutrients']);
    near($juice['energy'], 46.0, 'mapped by nutrientId');
    near($juice['vitaminD'], 1.0, '40 IU = 1 µg');
    $bake = Nutrients::fromFdc($foods[5]['foodNutrients']);
    near($bake['potassium'], 250.0, '0.25 g = 250 mg');
    eq($bake['fat'], null, 'negative is unknown');
    eq($bake['carbohydrate'], null, 'implausible > 100 g is unknown');
});

test('unit conversion', function () {
    near(Nutrients::convert(1.0, 'G', 'mg'), 1000.0);
    near(Nutrients::convert(500.0, 'UG', 'mg'), 0.5);
    near(Nutrients::convert(418.4, 'kJ', 'kcal'), 100.0);
    eq(Nutrients::convert(1.0, 'G', 'kcal'), null);
});

test('search normalises, de-duplicates and drops empty foods', function () {
    $http = new FakeHttp(new HttpResponse(200, fixture()));
    $results = (new FoodDataCentral($http, config()))->search('apple');
    eq(array_column($results, 'sourceId'), ['1750340', '171688', '2345678', '3456789']);
    $juice = $results[2];
    eq($juice['kind'], 'branded');
    eq($juice['name'], 'Cloudy Apple Juice', 'ALL CAPS tidied');
    eq($juice['brand'], 'Example Orchards Ltd');
    eq($juice['basis'], '100ml');
    eq($juice['servingOptions'], [['label' => '1 glass', 'grams' => 250.0]]);
    eq($results[0]['preparation'], 'raw');
    eq($results[3]['preparation'], 'cooked');
    eq($results[1]['kind'], 'generic');
    eq($results[1]['nutrientUnits']['vitaminD'], 'µg');
});

test('API key goes in a header, never in the URL; timeouts are passed', function () {
    $http = new FakeHttp(new HttpResponse(200, fixture()));
    (new FoodDataCentral($http, config()))->search('apple pie', 'generic');
    $call = $http->calls[0];
    eq($call['headers']['X-Api-Key'], 'test-key');
    ok(!str_contains($call['url'], 'test-key'), 'key must not be in URL');
    ok(str_contains($call['url'], 'query=apple%20pie'), 'query encoded');
    ok(str_contains($call['url'], 'dataType=Foundation%2CSR%20Legacy%2CSurvey%20%28FNDDS%29'), 'generic types only: ' . $call['url']);
    eq($call['timeouts'], [4, 8]);
});

test('demo key is used when no key is configured', function () {
    $cfg = config(['fdc_api_key' => '  ']);
    ok($cfg->usingDemoKey(), 'demo key');
    $http = new FakeHttp(new HttpResponse(200, fixture()));
    (new FoodDataCentral($http, $cfg))->search('apple');
    eq($http->calls[0]['headers']['X-Api-Key'], 'DEMO_KEY');
});

test('upstream failures map to safe error codes', function () {
    $cases = [
        [new HttpException(HttpException::TIMEOUT), 504, 'timeout'],
        [new HttpException(HttpException::NETWORK), 502, 'upstream_unavailable'],
        [new HttpResponse(429, ''), 503, 'upstream_busy'],
        [new HttpResponse(403, '{"error":{"code":"API_KEY_INVALID"}}'), 503, 'not_configured'],
        [new HttpResponse(500, 'oops'), 502, 'upstream_unavailable'],
        [new HttpResponse(200, 'not json'), 502, 'upstream_unavailable'],
        [new HttpResponse(200, '{"foods": "nope"}'), 502, 'upstream_unavailable'],
    ];
    foreach ($cases as [$next, $status, $code]) {
        [$s, $body] = controller(new FakeHttp($next))->handle(['q' => 'apple'], '1.2.3.4');
        eq($s, $status, $code);
        eq($body['error'], $code);
        ok(!str_contains(json_encode($body), 'test-key'), 'no secrets in errors');
    }
});

test('query validation', function () {
    $c = controller(new FakeHttp(new HttpResponse(200, fixture())));
    eq($c->handle(['q' => 'a'], 'ip')[0], 400);
    eq($c->handle([], 'ip')[0], 400);
    eq($c->handle(['q' => ['x']], 'ip')[0], 400);
    eq($c->handle(['q' => str_repeat('x', 101)], 'ip')[0], 400);
    eq($c->handle(['q' => "app\x00le"], 'ip')[0], 400);
    eq($c->handle(['q' => '  crème  fraîche '], 'ip')[0], 200);
});

test('results are cached: second identical search does not call upstream', function () {
    $http = new FakeHttp(new HttpResponse(200, fixture()));
    $dir = tmpdir();
    $c = controller($http, null, $dir);
    [$s1, $b1] = $c->handle(['q' => 'Apple'], 'ip');
    [$s2, $b2] = $c->handle(['q' => 'apple'], 'ip');
    eq([$s1, $s2], [200, 200]);
    eq($b1['cached'], false);
    eq($b2['cached'], true);
    eq(count($http->calls), 1);
    eq($b2['results'], $b1['results']);
});

test('per-visitor rate limit returns 429 with Retry-After', function () {
    $http = new FakeHttp(new HttpResponse(200, fixture()));
    $c = controller($http); // limit 3 per 300 s
    foreach (['aa', 'bb', 'cc'] as $q) {
        eq($c->handle(['q' => $q], '9.9.9.9')[0], 200);
    }
    [$s, $body, $headers] = $c->handle(['q' => 'dd'], '9.9.9.9');
    eq($s, 429);
    eq($body['error'], 'rate_limited');
    ok((int) $headers['Retry-After'] > 0, 'retry-after');
    eq($c->handle(['q' => 'dd'], '8.8.8.8')[0], 200, 'other visitors unaffected');
    eq($c->handle(['q' => 'aa'], '9.9.9.9')[0], 200, 'cached results are still served');
});

test('rate limiter window slides and IPs are not stored in clear', function () {
    $now = 1000;
    $dir = tmpdir();
    $rl = new RateLimiter($dir, 'secret', function () use (&$now) { return $now; });
    eq($rl->hitVisitor('203.0.113.7', 2, 60), 0);
    eq($rl->hitVisitor('203.0.113.7', 2, 60), 0);
    ok($rl->hitVisitor('203.0.113.7', 2, 60) > 0, 'blocked');
    $now += 61;
    eq($rl->hitVisitor('203.0.113.7', 2, 60), 0, 'allowed after window');
    foreach (glob($dir . '/*') as $f) {
        ok(!str_contains($f . file_get_contents($f), '203.0.113.7'), 'IP stored in clear');
    }
    eq($rl->hitGlobal(1), 0);
    ok($rl->hitGlobal(1) > 0, 'global cap');
});

test('config loads from the private folder and ignores unknown keys', function () {
    $dir = tmpdir();
    mkdir($dir . '/config');
    file_put_contents($dir . '/config/app.php', "<?php return ['fdc_api_key' => 'abc', 'evil' => 1, 'timeout_seconds' => 5];");
    $cfg = Config::load($dir);
    eq($cfg->fdcApiKey(), 'abc');
    eq($cfg->int('timeout_seconds'), 5);
    eq($cfg->string('storage_dir'), $dir . '/storage');
    eq($cfg->string('evil'), '');
    ok(Config::load(tmpdir())->usingDemoKey(), 'no config file -> demo key');
});
