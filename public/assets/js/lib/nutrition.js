// Maintenance-day nutrition example.
//
// This is an illustrative split inside published adult reference ranges. It is not a
// prescription or a personalised target.
//
// Reference values (European Food Safety Authority, Dietary Reference Values, 2010–2012):
//   Protein: Population Reference Intake 0.83 g per kg body weight per day (adults)
//   Carbohydrate: Reference Intake range 45–60 % of energy
//   Fat: Reference Intake range 20–35 % of energy
//   Dietary fibre: Adequate Intake 25 g per day (adults)
// Energy conversion factors (EU Regulation 1169/2011, Annex XIV):
//   protein 4 kcal/g, carbohydrate 4 kcal/g, fat 9 kcal/g, fibre 2 kcal/g
//
// Method: protein = the larger of 0.83 g/kg and 15 % of energy; fat = 30 % of energy
// (the middle of 20–35 %); fibre = 25 g; carbohydrate = the remaining energy at 4 kcal/g.

export const KCAL_PER_G = Object.freeze({ protein: 4, carbohydrate: 4, fat: 9, fibre: 2 });

export const REFERENCE = Object.freeze({
  proteinGPerKg: 0.83,
  proteinExampleEnergyShare: 0.15,
  fatExampleEnergyShare: 0.3,
  fatRange: [0.2, 0.35],
  carbohydrateRange: [0.45, 0.6],
  fibreG: 25,
});

/**
 * How far along each macro is against a day's guide amounts.
 * @param {{protein?: number, carbohydrate?: number, fat?: number, fibre?: number}} totals grams eaten
 * @param {{proteinG: number, carbohydrateG: number, fatG: number, fibreG: number}} guide grams for the day
 * @returns {Record<string, {targetG: number, fraction: number, percent: number, leftG: number, overG: number}>}
 */
export function macroProgress(totals, guide) {
  const out = {};
  for (const key of ['protein', 'carbohydrate', 'fat', 'fibre']) {
    const targetG = Math.round(guide?.[`${key}G`]);
    if (!Number.isFinite(targetG) || targetG <= 0) continue;
    const eaten = Number.isFinite(totals?.[key]) && totals[key] > 0 ? totals[key] : 0;
    const diff = targetG - Math.round(eaten);
    out[key] = { targetG, fraction: eaten / targetG, percent: Math.round((eaten / targetG) * 100), leftG: Math.max(0, diff), overG: Math.max(0, -diff) };
  }
  return out;
}

export function maintenanceExample(maintenanceKcal, weightKg) {
  if (!Number.isFinite(maintenanceKcal) || maintenanceKcal <= 0) throw new RangeError('maintenanceKcal must be positive');
  if (!Number.isFinite(weightKg) || weightKg <= 0) throw new RangeError('weightKg must be positive');

  const proteinFloorG = REFERENCE.proteinGPerKg * weightKg;
  const proteinShareG = (maintenanceKcal * REFERENCE.proteinExampleEnergyShare) / KCAL_PER_G.protein;
  const proteinG = Math.max(proteinFloorG, proteinShareG);
  const fatG = (maintenanceKcal * REFERENCE.fatExampleEnergyShare) / KCAL_PER_G.fat;
  const fibreG = REFERENCE.fibreG;
  const remainingKcal =
    maintenanceKcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat - fibreG * KCAL_PER_G.fibre;
  const carbohydrateG = Math.max(0, remainingKcal / KCAL_PER_G.carbohydrate);

  const share = (g, key) => (g * KCAL_PER_G[key]) / maintenanceKcal;
  const carbohydrateShare = share(carbohydrateG, 'carbohydrate');
  const [carbMin, carbMax] = REFERENCE.carbohydrateRange;

  return {
    proteinG,
    carbohydrateG,
    fatG,
    fibreG,
    proteinShare: share(proteinG, 'protein'),
    carbohydrateShare,
    fatShare: share(fatG, 'fat'),
    fibreShare: share(fibreG, 'fibre'),
    proteinFloorG,
    carbohydrateWithinRange: carbohydrateShare >= carbMin - 1e-9 && carbohydrateShare <= carbMax + 1e-9,
  };
}

// Balanced food examples, organised by the Healthy Ireland "Healthy Food for Life" food pyramid
// (Department of Health / HSE / safefood, 2016). Servings are the published adult guidance.
export const FOOD_PYRAMID = Object.freeze([
  {
    id: 'veg-fruit',
    shelf: 'Vegetables, salad and fruit',
    servings: '5–7 servings a day',
    examples: 'A bowl of homemade vegetable soup, a side salad, an apple or orange, a handful of berries, 150 ml unsweetened fruit juice (once a day at most).',
  },
  {
    id: 'cereals',
    shelf: 'Wholemeal cereals and breads, potatoes, pasta and rice',
    servings: '3–5 servings a day, up to 7 for very active adults',
    examples: 'Porridge oats, two slices of wholemeal or brown soda bread, a cup of cooked brown rice or wholewheat pasta, two medium potatoes.',
  },
  {
    id: 'dairy',
    shelf: 'Milk, yogurt and cheese',
    servings: '3 servings a day',
    examples: 'A glass of milk (200 ml), a carton of yogurt (125 g), two thumbs (25 g) of hard cheese. Choose reduced-fat or low-fat options where possible.',
  },
  {
    id: 'protein',
    shelf: 'Meat, poultry, fish, eggs, beans and nuts',
    servings: '2 servings a day',
    examples: 'Chicken breast, a fillet of salmon or mackerel, two eggs, half a tin of beans or lentils, a small handful of unsalted nuts. Have oily fish once a week.',
  },
  {
    id: 'fats',
    shelf: 'Fats, spreads and oils',
    servings: 'In very small amounts',
    examples: 'A thin scrape of spread on bread, one teaspoon of rapeseed or olive oil per person when cooking.',
  },
  {
    id: 'top-shelf',
    shelf: 'Foods and drinks high in fat, sugar and salt',
    servings: 'Not every day — at most once or twice a week',
    examples: 'Biscuits, cakes, crisps, sweets, sugary drinks. These are not needed for good health.',
  },
]);

export const MEAL_IDEAS = Object.freeze([
  { meal: 'Breakfast', idea: 'Porridge made with milk, topped with berries, and a glass of water or tea.' },
  { meal: 'Lunch', idea: 'Wholemeal sandwich with chicken or egg and salad, plus a bowl of vegetable soup.' },
  { meal: 'Dinner', idea: 'Baked salmon, boiled potatoes, and broccoli and carrots.' },
  { meal: 'Snacks', idea: 'A yogurt, a piece of fruit, or a small handful of unsalted nuts.' },
]);
