// Food records, custom-food and diary-entry validation, and duplicate detection.

import { NUTRIENTS, CANONICAL_UNITS, normaliseNutrients, scaleNutrients, knownCount } from './nutrients.js';
import { parseNumber } from './validate.js';
import { isValidLocalDate, toLocalDateString } from './dates.js';

export const MEALS = Object.freeze([
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snacks', label: 'Snacks' },
]);

export const FOOD_KINDS = Object.freeze({ generic: 'Generic', branded: 'Branded' });
export const PREPARATIONS = Object.freeze({ raw: 'Raw', cooked: 'Cooked', 'not-applicable': 'Not applicable', unspecified: 'Not stated' });
export const SOURCES = Object.freeze({
  custom: 'Your food',
  'usda-fdc': 'USDA FoodData Central',
});

export const SERVING_LIMITS = Object.freeze({ min: 1, max: 5000 });

/** Guess raw / cooked from a food description. */
export function detectPreparation(name) {
  const text = String(name ?? '').toLowerCase();
  if (/\b(raw|uncooked|fresh)\b/.test(text)) return 'raw';
  if (/\b(cooked|boiled|baked|roasted|grilled|fried|steamed|stewed|braised|poached|microwaved|toasted|scrambled)\b/.test(text)) return 'cooked';
  return 'unspecified';
}

/** Normalised text used to spot duplicates. */
export function normaliseName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Identity used to de-duplicate foods: source + source ID, or custom name + brand + preparation. */
export function foodIdentity(food) {
  if (food.source && food.source !== 'custom' && food.sourceId) return `${food.source}:${food.sourceId}`;
  return `custom:${normaliseName(food.name)}|${normaliseName(food.brand)}|${food.preparation ?? 'unspecified'}`;
}

export function findDuplicate(foods, candidate, { ignoreId } = {}) {
  const id = foodIdentity(candidate);
  return foods.find((f) => f.id !== ignoreId && foodIdentity(f) === id) ?? null;
}

function cleanText(raw, max) {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Validate the custom food form. Blank nutrient fields mean "unknown", not zero.
 * Raw values are per 100 g.
 */
export function validateCustomFood(raw) {
  const errors = {};
  const name = cleanText(raw.name, 80);
  if (name.length < 2) errors.name = 'Enter a name of at least 2 characters.';
  const brand = cleanText(raw.brand, 60);
  const kind = raw.kind === 'branded' ? 'branded' : 'generic';
  if (kind === 'branded' && !brand) errors.brand = 'Enter the brand for a branded food.';
  const preparation = Object.hasOwn(PREPARATIONS, raw.preparation) ? raw.preparation : 'unspecified';

  const per100g = {};
  for (const n of NUTRIENTS) {
    const text = raw[`n_${n.key}`];
    if (text === undefined || String(text).trim() === '') {
      per100g[n.key] = null;
      continue;
    }
    const value = parseNumber(String(text));
    if (!Number.isFinite(value) || value < 0) errors[`n_${n.key}`] = `Enter ${n.label.toLowerCase()} as a number, or leave it blank if unknown.`;
    else if (value > n.max100g) errors[`n_${n.key}`] = `${n.label} cannot be more than ${n.max100g} ${n.unit} per 100 g.`;
    else per100g[n.key] = value;
  }
  const massSum = ['protein', 'carbohydrate', 'fat', 'fibre'].reduce((s, k) => s + (per100g[k] ?? 0), 0);
  if (!errors.n_protein && !errors.n_carbohydrate && !errors.n_fat && !errors.n_fibre && massSum > 105) {
    errors.n_protein = 'Protein, carbohydrate, fat and fibre add up to more than 100 g per 100 g. Check the values are per 100 g.';
  }
  if (Object.keys(errors).length === 0 && knownCount(per100g) === 0) errors.n_energy = 'Enter at least one nutrient value, such as energy.';

  let servingOptions = [];
  if (raw.servingG !== undefined && String(raw.servingG).trim() !== '') {
    const g = parseNumber(String(raw.servingG));
    if (!Number.isFinite(g) || g < SERVING_LIMITS.min || g > SERVING_LIMITS.max) errors.servingG = `Enter a usual serving between ${SERVING_LIMITS.min} and ${SERVING_LIMITS.max} g, or leave it blank.`;
    else servingOptions = [{ label: '1 serving', grams: g }];
  }

  if (Object.keys(errors).length) return { ok: false, errors, value: null };
  return {
    ok: true,
    errors: {},
    value: {
      source: 'custom',
      sourceId: null,
      name,
      brand: brand || null,
      kind,
      preparation,
      per100g,
      nutrientUnits: { ...CANONICAL_UNITS },
      basis: '100g',
      servingOptions,
    },
  };
}

/**
 * Accept a food from the server's search API. The browser re-validates everything so a
 * faulty or tampered response cannot store nonsense.
 */
export function foodFromApi(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.source === 'ai-estimate') return foodFromEstimate(result);
  const source = result.source === 'usda-fdc' ? 'usda-fdc' : null;
  const sourceId = typeof result.sourceId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(result.sourceId) ? result.sourceId : null;
  const name = cleanText(result.name, 160);
  if (!source || !sourceId || name.length < 1) return null;
  const per100g = normaliseNutrients(result.per100g, result.nutrientUnits);
  const servingOptions = Array.isArray(result.servingOptions)
    ? result.servingOptions
        .filter((s) => s && Number.isFinite(s.grams) && s.grams >= SERVING_LIMITS.min && s.grams <= SERVING_LIMITS.max)
        .slice(0, 5)
        .map((s) => ({ label: cleanText(s.label, 60) || 'Serving', grams: s.grams }))
    : [];
  return {
    source,
    sourceId,
    name,
    brand: cleanText(result.brand, 80) || null,
    kind: result.kind === 'branded' ? 'branded' : 'generic',
    preparation: Object.hasOwn(PREPARATIONS, result.preparation) ? result.preparation : detectPreparation(name),
    dataType: cleanText(result.dataType, 40) || null,
    per100g,
    nutrientUnits: { ...CANONICAL_UNITS },
    basis: result.basis === '100ml' ? '100ml' : '100g',
    servingOptions,
  };
}

export const ESTIMATE_SUFFIX = ' (AI estimate)';

/**
 * A food the database could not match, with the AI's rough per-100 g values. It is kept as one
 * of the person's own foods, with "(AI estimate)" in its name so it is never mistaken for
 * database data, and `estimated: true` while it is on screen.
 */
export function foodFromEstimate(result) {
  const base = cleanText(result?.name, 80 - ESTIMATE_SUFFIX.length);
  if (base.length < 1) return null;
  const all = normaliseNutrients(result.per100g, result.nutrientUnits);
  const per100g = Object.fromEntries(NUTRIENTS.map((n) => [n.key, null]));
  for (const key of ['energy', 'protein', 'carbohydrate', 'fat', 'fibre']) per100g[key] = all[key] ?? null;
  if (per100g.energy === null) return null;
  return {
    source: 'custom',
    sourceId: null,
    name: base.endsWith(ESTIMATE_SUFFIX.trim()) ? base : base + ESTIMATE_SUFFIX,
    brand: null,
    kind: 'generic',
    preparation: Object.hasOwn(PREPARATIONS, result.preparation) ? result.preparation : 'unspecified',
    per100g,
    nutrientUnits: { ...CANONICAL_UNITS },
    basis: '100g',
    servingOptions: [],
    estimated: true,
  };
}

/**
 * Several foods and amounts as one food for "My foods", so the same meal can be added again in
 * one step. Values are per 100 g of the whole meal; a nutrient is unknown only if no part has it.
 * @param {string} name
 * @param {{ food: object, grams: number }[]} parts
 */
export function combineFoods(name, parts) {
  const clean = cleanText(name, 80);
  const used = parts.filter((p) => p?.food && Number.isFinite(p.grams) && p.grams > 0);
  const total = used.reduce((s, p) => s + p.grams, 0);
  if (clean.length < 2 || !used.length || total < SERVING_LIMITS.min || total > SERVING_LIMITS.max) return null;
  const per100g = {};
  for (const n of NUTRIENTS) {
    const known = used.filter((p) => Number.isFinite(p.food.per100g?.[n.key]));
    per100g[n.key] = known.length ? Math.round((known.reduce((s, p) => s + (p.food.per100g[n.key] * p.grams) / 100, 0) / total) * 100 * 100) / 100 : null;
  }
  return {
    source: 'custom',
    sourceId: null,
    name: clean,
    brand: null,
    kind: 'generic',
    preparation: 'unspecified',
    per100g,
    nutrientUnits: { ...CANONICAL_UNITS },
    basis: '100g',
    servingOptions: [{ label: '1 meal', grams: Math.round(total * 10) / 10 }],
  };
}

/** A default name for a saved meal: its foods, shortened. */
export function mealName(names) {
  const parts = names.map((n) => cleanText(n, 80).replace(ESTIMATE_SUFFIX, '')).filter(Boolean);
  let out = parts.slice(0, 4).join(', ');
  if (parts.length > 4) out += ' and more';
  return out.length > 80 ? `${out.slice(0, 77).trim()}…` : out;
}

export function validateDiaryEntry(raw, today = toLocalDateString()) {
  const errors = {};
  if (!isValidLocalDate(raw.localDate)) errors.localDate = 'Enter a valid date.';
  else if (raw.localDate > today) errors.localDate = 'The date cannot be in the future.';
  if (!MEALS.some((m) => m.id === raw.meal)) errors.meal = 'Choose a meal.';
  const grams = parseNumber(String(raw.servingG ?? ''));
  if (!Number.isFinite(grams)) errors.servingG = 'Enter the amount in grams.';
  else if (grams < SERVING_LIMITS.min || grams > SERVING_LIMITS.max) errors.servingG = `Enter between ${SERVING_LIMITS.min} and ${SERVING_LIMITS.max} g.`;
  if (Object.keys(errors).length) return { ok: false, errors, value: null };
  return { ok: true, errors: {}, value: { localDate: raw.localDate, meal: raw.meal, servingG: Math.round(grams * 10) / 10 } };
}

/** Build the stored diary entry: a full snapshot of the food plus the computed nutrients. */
export function buildDiaryEntry(food, { localDate, meal, servingG }) {
  return {
    localDate,
    meal,
    foodId: food.id ?? null,
    source: food.source,
    sourceId: food.sourceId ?? null,
    name: food.name,
    brand: food.brand ?? null,
    kind: food.kind,
    preparation: food.preparation,
    basis: food.basis ?? '100g',
    servingG,
    per100g: { ...food.per100g },
    nutrientUnits: { ...(food.nutrientUnits ?? CANONICAL_UNITS) },
    nutrients: scaleNutrients(food.per100g, servingG),
  };
}

/** Re-calculate an entry for new grams using ITS OWN snapshot, never the current library food. */
export function rescaleEntry(entry, servingG) {
  return { ...entry, servingG, nutrients: scaleNutrients(entry.per100g, servingG) };
}
