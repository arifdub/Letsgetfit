// Resting and maintenance energy estimates.
//
// Equation: Mifflin–St Jeor (1990)
//   REE (kcal/day) = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) + s
//   s = +5 for the male coefficient, −161 for the female coefficient
// Source: Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO.
//   "A new predictive equation for resting energy expenditure in healthy individuals."
//   Am J Clin Nutr. 1990;51(2):241–247. doi:10.1093/ajcn/51.2.241
// Population: 498 healthy adults (251 men, 247 women) aged 19–78 years,
//   normal-weight and obese, measured by indirect calorimetry.
// The study measured resting energy expenditure (REE); it is commonly described as BMR.
//
// Maintenance energy = REE × physical activity level (PAL).
// PAL ranges: FAO/WHO/UNU (2004) Human energy requirements, Table 5.1 —
//   sedentary or light activity lifestyle 1.40–1.69,
//   active or moderately active lifestyle 1.70–1.99,
//   vigorous or vigorously active lifestyle 2.00–2.40.
// The report defines PAL relative to BMR; using the Mifflin–St Jeor REE in place of BMR is an
// approximation and is documented in docs/FORMULAS.md.

export const SEX_COEFFICIENTS = Object.freeze({ male: 5, female: -161 });

export const ACTIVITY_LEVELS = Object.freeze([
  {
    id: 'mostly-seated',
    pal: 1.4,
    label: 'Mostly seated',
    description:
      'Desk or seated work, little walking, and no regular exercise. Uses the lower bound of the FAO/WHO/UNU sedentary or light range (1.40).',
  },
  {
    id: 'light',
    pal: 1.55,
    label: 'Lightly active',
    description:
      'Mostly seated or standing with some daily walking or light activity. Midpoint of the sedentary or light range (1.40–1.69).',
  },
  {
    id: 'moderate',
    pal: 1.85,
    label: 'Moderately active',
    description:
      'An active job, or about an hour of moderate exercise such as brisk walking or cycling most days. Midpoint of the active or moderately active range (1.70–1.99).',
  },
  {
    id: 'vigorous',
    pal: 2.2,
    label: 'Very active',
    description:
      'Heavy physical work, or long sessions of vigorous training on most days. Midpoint of the vigorous range (2.00–2.40).',
  },
]);

export function getActivityLevel(id) {
  return ACTIVITY_LEVELS.find((level) => level.id === id) ?? null;
}

/** Resting energy expenditure (kcal/day) by Mifflin–St Jeor. Inputs must already be validated. */
export function mifflinStJeor({ weightKg, heightCm, ageYears, sex }) {
  const s = SEX_COEFFICIENTS[sex];
  if (s === undefined) throw new RangeError(`Unknown sex coefficient: ${sex}`);
  for (const [name, v] of Object.entries({ weightKg, heightCm, ageYears })) {
    if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} must be a positive number`);
  }
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + s;
}

/** Estimated maintenance energy (kcal/day) = REE × PAL. */
export function maintenanceEnergy(reeKcal, activityLevelId) {
  const level = getActivityLevel(activityLevelId);
  if (!level) throw new RangeError(`Unknown activity level: ${activityLevelId}`);
  return reeKcal * level.pal;
}

/** Round an energy estimate for display, to avoid implying false precision. */
export function roundEnergyForDisplay(kcal) {
  return Math.round(kcal / 10) * 10;
}
