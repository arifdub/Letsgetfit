// Nutrient definitions, units and arithmetic for the food diary.
//
// Rules:
//  - Every nutrient has one canonical unit. Values are stored with their unit map
//    (nutrientUnits) so the meaning of a stored number never depends on code defaults.
//  - null means UNKNOWN, never zero. Unknown values stay unknown through scaling and
//    are counted separately in totals, so incomplete totals can be flagged.
//  - Food values are per 100 g of the food as eaten/sold (per100g). Diary entries store a
//    snapshot of per100g plus the grams eaten, so old entries never change if a source does.

export const NUTRIENTS = Object.freeze([
  { key: 'energy', label: 'Energy', unit: 'kcal', group: 'core', decimals: 0, max100g: 950 },
  { key: 'protein', label: 'Protein', unit: 'g', group: 'core', decimals: 1, max100g: 100 },
  { key: 'carbohydrate', label: 'Carbohydrate', unit: 'g', group: 'core', decimals: 1, max100g: 100 },
  { key: 'fat', label: 'Fat', unit: 'g', group: 'core', decimals: 1, max100g: 100 },
  { key: 'fibre', label: 'Fibre', unit: 'g', group: 'core', decimals: 1, max100g: 100 },
  { key: 'iron', label: 'Iron', unit: 'mg', group: 'micro', decimals: 1, max100g: 1000 },
  { key: 'calcium', label: 'Calcium', unit: 'mg', group: 'micro', decimals: 0, max100g: 40000 },
  { key: 'potassium', label: 'Potassium', unit: 'mg', group: 'micro', decimals: 0, max100g: 40000 },
  { key: 'vitaminD', label: 'Vitamin D', unit: 'µg', group: 'micro', decimals: 1, max100g: 10000 },
  { key: 'vitaminB12', label: 'Vitamin B12', unit: 'µg', group: 'micro', decimals: 1, max100g: 10000 },
]);

export const NUTRIENT_KEYS = Object.freeze(NUTRIENTS.map((n) => n.key));
export const CANONICAL_UNITS = Object.freeze(Object.fromEntries(NUTRIENTS.map((n) => [n.key, n.unit])));

export function getNutrient(key) {
  return NUTRIENTS.find((n) => n.key === key) ?? null;
}

// Mass units in grams; energy units in kcal.
const MASS_IN_G = { g: 1, mg: 1e-3, 'µg': 1e-6, ug: 1e-6, mcg: 1e-6 };
const ENERGY_IN_KCAL = { kcal: 1, kj: 1 / 4.184 };

/** Convert a value between compatible units. Returns null if the units are not compatible. */
export function convertUnit(value, from, to) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const f = String(from).toLowerCase();
  const t = String(to).toLowerCase();
  const norm = (u) => (u === 'μg' ? 'µg' : u); // Greek mu vs micro sign
  const a = norm(f);
  const b = norm(t);
  if (a === b) return value;
  if (a in MASS_IN_G && b in MASS_IN_G) return (value * MASS_IN_G[a]) / MASS_IN_G[b];
  if (a in ENERGY_IN_KCAL && b in ENERGY_IN_KCAL) return (value * ENERGY_IN_KCAL[a]) / ENERGY_IN_KCAL[b];
  return null;
}

export function emptyNutrients() {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, null]));
}

/**
 * Bring an untrusted { key: value } map (with an optional unit map) into canonical units.
 * Unknown keys are dropped; missing, negative, non-numeric or implausible values become null.
 */
export function normaliseNutrients(values, units = CANONICAL_UNITS) {
  const out = emptyNutrients();
  if (!values || typeof values !== 'object') return out;
  for (const n of NUTRIENTS) {
    const raw = values[n.key];
    if (raw === null || raw === undefined || raw === '') continue;
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num) || num < 0) continue;
    const converted = convertUnit(num, units?.[n.key] ?? n.unit, n.unit);
    if (converted === null || converted > n.max100g) continue;
    out[n.key] = converted;
  }
  return out;
}

/** Nutrients for an amount in grams, from per-100 g values. Unknown stays unknown. */
export function scaleNutrients(per100g, grams) {
  const out = emptyNutrients();
  if (!Number.isFinite(grams) || grams < 0) return out;
  for (const key of NUTRIENT_KEYS) {
    const v = per100g?.[key];
    out[key] = Number.isFinite(v) ? (v * grams) / 100 : null;
  }
  return out;
}

/**
 * Sum nutrients across diary entries.
 * @returns {{ totals: Record<string, number>, missing: Record<string, number>, count: number }}
 *   totals: sum of known values (0 when nothing is known); missing: entries with unknown values.
 */
export function sumNutrients(entries) {
  const totals = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0]));
  const missing = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0]));
  for (const entry of entries) {
    for (const key of NUTRIENT_KEYS) {
      const v = entry.nutrients?.[key];
      if (Number.isFinite(v)) totals[key] += v;
      else missing[key] += 1;
    }
  }
  return { totals, missing, count: entries.length };
}

export function knownCount(per100g) {
  return NUTRIENT_KEYS.filter((k) => Number.isFinite(per100g?.[k])).length;
}
