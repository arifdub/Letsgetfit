<?php

declare(strict_types=1);

namespace LetsGetFit;

/**
 * Canonical nutrients (must match public/assets/js/lib/nutrients.js) and the
 * USDA FoodData Central nutrient numbers that map to them.
 */
final class Nutrients
{
    /** key => canonical unit */
    public const UNITS = [
        'energy' => 'kcal',
        'protein' => 'g',
        'carbohydrate' => 'g',
        'fat' => 'g',
        'fibre' => 'g',
        'iron' => 'mg',
        'calcium' => 'mg',
        'potassium' => 'mg',
        'vitaminD' => 'µg',
        'vitaminB12' => 'µg',
    ];

    /**
     * FoodData Central nutrient numbers, in order of preference per key.
     * 208 Energy (kcal); 958/957 Energy (Atwater specific/general factors, kcal) used by
     * Foundation foods; 268 Energy (kJ); 203 Protein; 205 Carbohydrate, by difference;
     * 204 Total lipid (fat); 291 Fibre, total dietary; 303 Iron; 301 Calcium; 306 Potassium;
     * 328 Vitamin D (D2 + D3), µg; 324 Vitamin D, IU; 418 Vitamin B-12.
     */
    public const FDC_NUMBERS = [
        'energy' => ['208', '958', '957', '268'],
        'protein' => ['203'],
        'carbohydrate' => ['205'],
        'fat' => ['204'],
        'fibre' => ['291'],
        'iron' => ['303'],
        'calcium' => ['301'],
        'potassium' => ['306'],
        'vitaminD' => ['328', '324'],
        'vitaminB12' => ['418'],
    ];

    /** FoodData Central nutrientId equivalents, used when a record lacks nutrientNumber. */
    public const FDC_IDS = [
        '1008' => '208', '2048' => '958', '2047' => '957', '1062' => '268',
        '1003' => '203', '1005' => '205', '1004' => '204', '1079' => '291',
        '1089' => '303', '1087' => '301', '1092' => '306',
        '1114' => '328', '1110' => '324', '1178' => '418',
    ];

    /** Upper plausibility limits per 100 g (anything above is treated as unknown). */
    public const MAX_PER_100G = [
        'energy' => 950, 'protein' => 100, 'carbohydrate' => 100, 'fat' => 100, 'fibre' => 100,
        'iron' => 1000, 'calcium' => 40000, 'potassium' => 40000, 'vitaminD' => 10000, 'vitaminB12' => 10000,
    ];

    /** Convert between mass units (g, mg, µg), energy units (kcal, kJ) and vitamin D IU → µg. */
    public static function convert(float $value, string $from, string $to): ?float
    {
        $f = self::normaliseUnit($from);
        $t = self::normaliseUnit($to);
        if ($f === $t) {
            return $value;
        }
        $mass = ['g' => 1.0, 'mg' => 1e-3, 'µg' => 1e-6];
        $energy = ['kcal' => 1.0, 'kj' => 1 / 4.184];
        if (isset($mass[$f], $mass[$t])) {
            return $value * $mass[$f] / $mass[$t];
        }
        if (isset($energy[$f], $energy[$t])) {
            return $value * $energy[$f] / $energy[$t];
        }

        return null;
    }

    public static function normaliseUnit(string $unit): string
    {
        $u = strtolower(trim($unit));

        return match ($u) {
            'ug', 'mcg', 'μg', 'µg' => 'µg',
            'kj' => 'kj',
            default => $u,
        };
    }

    /**
     * Map a FoodData Central foodNutrients array to canonical per-100 g values.
     * Missing or unusable values are null (unknown), never 0.
     *
     * @param array<int, mixed> $foodNutrients
     * @return array<string, float|null>
     */
    public static function fromFdc(array $foodNutrients): array
    {
        $byNumber = [];
        foreach ($foodNutrients as $n) {
            if (!is_array($n)) {
                continue;
            }
            $number = isset($n['nutrientNumber']) ? (string) $n['nutrientNumber'] : null;
            if (($number === null || $number === '') && isset($n['nutrientId'])) {
                $number = self::FDC_IDS[(string) $n['nutrientId']] ?? null;
            }
            $value = $n['value'] ?? ($n['amount'] ?? null);
            if ($number === null || !is_numeric($value) || isset($byNumber[$number])) {
                continue;
            }
            $byNumber[$number] = ['value' => (float) $value, 'unit' => (string) ($n['unitName'] ?? '')];
        }

        $out = [];
        foreach (self::FDC_NUMBERS as $key => $numbers) {
            $out[$key] = null;
            foreach ($numbers as $number) {
                if (!isset($byNumber[$number])) {
                    continue;
                }
                ['value' => $value, 'unit' => $unit] = $byNumber[$number];
                if ($value < 0) {
                    continue;
                }
                if ($number === '324') {
                    // Vitamin D in IU: 1 µg = 40 IU.
                    $converted = strtoupper($unit) === 'IU' ? $value / 40 : null;
                } else {
                    $converted = self::convert($value, $unit, self::UNITS[$key]);
                }
                if ($converted === null || $converted > self::MAX_PER_100G[$key]) {
                    continue;
                }
                $out[$key] = round($converted, 4);
                break;
            }
        }

        return $out;
    }
}
