<?php

declare(strict_types=1);

namespace LetsGetFit;

use LetsGetFit\Http\HttpClient;
use LetsGetFit\Http\HttpException;

/**
 * Adapter for USDA FoodData Central search (https://fdc.nal.usda.gov/api-guide).
 * The API key is sent in the X-Api-Key header, so it never appears in URLs or access logs.
 * Results are normalised to LetsGetFit's food format with per-100 g values.
 */
final class FoodDataCentral
{
    public const SOURCE = 'usda-fdc';
    private const GENERIC_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];
    private const BRANDED_TYPES = ['Branded'];

    public function __construct(private HttpClient $http, private Config $config)
    {
    }

    /**
     * @return list<array<string, mixed>>
     * @throws UpstreamException
     */
    public function search(string $query, string $type = 'all', int $pageSize = 25): array
    {
        $types = match ($type) {
            'generic' => self::GENERIC_TYPES,
            'branded' => self::BRANDED_TYPES,
            default => array_merge(self::GENERIC_TYPES, self::BRANDED_TYPES),
        };
        $url = rtrim($this->config->string('fdc_base_url'), '/') . '/foods/search?' . http_build_query([
            'query' => $query,
            'pageSize' => $pageSize,
            'dataType' => implode(',', $types),
        ], '', '&', PHP_QUERY_RFC3986);

        try {
            $response = $this->http->get(
                $url,
                ['X-Api-Key' => $this->config->fdcApiKey()],
                max(1, $this->config->int('connect_timeout_seconds')),
                max(1, $this->config->int('timeout_seconds')),
            );
        } catch (HttpException $e) {
            throw new UpstreamException($e->kind === HttpException::TIMEOUT ? UpstreamException::TIMEOUT : UpstreamException::UNAVAILABLE);
        }

        if ($response->status === 429) {
            throw new UpstreamException(UpstreamException::BUSY);
        }
        if ($response->status === 401 || $response->status === 403) {
            throw new UpstreamException(UpstreamException::NOT_CONFIGURED);
        }
        if ($response->status !== 200) {
            throw new UpstreamException(UpstreamException::UNAVAILABLE);
        }
        $data = json_decode($response->body, true);
        if (!is_array($data) || !isset($data['foods']) || !is_array($data['foods'])) {
            throw new UpstreamException(UpstreamException::UNAVAILABLE);
        }

        $results = [];
        $seen = [];
        foreach ($data['foods'] as $food) {
            $item = is_array($food) ? self::normalise($food) : null;
            if ($item === null) {
                continue;
            }
            // De-duplicate by source ID, and by identical name + brand + type.
            $dupeKey = strtolower($item['name'] . '|' . ($item['brand'] ?? '') . '|' . ($item['dataType'] ?? ''));
            if (isset($seen[$item['sourceId']]) || isset($seen[$dupeKey])) {
                continue;
            }
            $seen[$item['sourceId']] = $seen[$dupeKey] = true;
            $results[] = $item;
        }

        return $results;
    }

    /** @param array<string, mixed> $food @return array<string, mixed>|null */
    public static function normalise(array $food): ?array
    {
        $id = $food['fdcId'] ?? null;
        $description = trim((string) ($food['description'] ?? ''));
        if (!is_numeric($id) || $description === '') {
            return null;
        }
        $dataType = (string) ($food['dataType'] ?? '');
        $branded = $dataType === 'Branded';
        $name = self::tidyName($description);
        $brand = trim((string) ($food['brandName'] ?? '')) ?: trim((string) ($food['brandOwner'] ?? ''));
        $per100g = Nutrients::fromFdc(is_array($food['foodNutrients'] ?? null) ? $food['foodNutrients'] : []);
        if (count(array_filter($per100g, static fn ($v) => $v !== null)) === 0) {
            return null; // nothing usable
        }

        $servingUnit = strtolower((string) ($food['servingSizeUnit'] ?? ''));
        $basis = $branded && in_array($servingUnit, ['ml', 'mlt'], true) ? '100ml' : '100g';
        $servingOptions = [];
        $servingSize = $food['servingSize'] ?? null;
        if ($branded && is_numeric($servingSize) && in_array($servingUnit, ['g', 'grm', 'ml', 'mlt'], true)) {
            $grams = round((float) $servingSize, 1);
            if ($grams >= 1 && $grams <= 5000) {
                $label = trim((string) ($food['householdServingFullText'] ?? ''));
                $servingOptions[] = ['label' => $label !== '' ? mb_substr($label, 0, 60) : '1 serving', 'grams' => $grams];
            }
        }

        return [
            'source' => self::SOURCE,
            'sourceId' => (string) (int) $id,
            'name' => mb_substr($name, 0, 160),
            'brand' => $brand !== '' ? mb_substr(self::tidyName($brand), 0, 80) : null,
            'kind' => $branded ? 'branded' : 'generic',
            'dataType' => $dataType,
            'preparation' => self::detectPreparation($description),
            'basis' => $basis,
            'per100g' => $per100g,
            'nutrientUnits' => Nutrients::UNITS,
            'servingOptions' => $servingOptions,
        ];
    }

    /** Must match detectPreparation() in public/assets/js/lib/food.js. */
    public static function detectPreparation(string $name): string
    {
        $text = strtolower($name);
        if (preg_match('/\b(raw|uncooked|fresh)\b/', $text)) {
            return 'raw';
        }
        if (preg_match('/\b(cooked|boiled|baked|roasted|grilled|fried|steamed|stewed|braised|poached|microwaved|toasted|scrambled)\b/', $text)) {
            return 'cooked';
        }

        return 'unspecified';
    }

    /** Branded descriptions are often ALL CAPS: make them readable. */
    private static function tidyName(string $text): string
    {
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;
        if (mb_strtoupper($text) === $text && preg_match('/[A-Z]{3}/', $text)) {
            $text = mb_convert_case(mb_strtolower($text), MB_CASE_TITLE);
        }

        return trim($text);
    }
}
