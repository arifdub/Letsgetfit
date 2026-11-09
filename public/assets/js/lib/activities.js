// Activity types and MET values for optional active-energy estimates.
//
// MET values: Ainsworth BE et al. "2011 Compendium of Physical Activities: a second update
//   of codes and MET values." Med Sci Sports Exerc. 2011;43(8):1575–1581.
//   Codes are the Compendium activity codes. See docs/FORMULAS.md for the source check status.
//
// Estimated active energy (kcal) = (MET − 1) × body weight (kg) × duration (hours)
//   1 MET is taken as 1 kcal/kg/h (the Compendium convention). Subtracting 1 MET removes the
//   resting energy you would have used anyway, so the figure is "active" (net) energy.
//
// These estimates are population averages. They are shown separately and are NOT added to the
// maintenance estimate, because the chosen activity level already includes usual exercise.

export const ACTIVITIES = Object.freeze([
  { id: 'walk-moderate', label: 'Walking, moderate pace (about 5 km/h)', met: 3.5, code: '17190' },
  { id: 'walk-brisk', label: 'Walking, brisk pace (about 5.6 km/h)', met: 4.3, code: '17200' },
  { id: 'hiking', label: 'Hill walking or hiking', met: 6.0, code: '17080' },
  { id: 'run-8kmh', label: 'Running, about 8 km/h', met: 8.3, code: '12030' },
  { id: 'run-9.7kmh', label: 'Running, about 9.7 km/h', met: 9.8, code: '12050' },
  { id: 'cycle-leisure', label: 'Cycling, leisurely (under 16 km/h)', met: 4.0, code: '01010' },
  { id: 'cycle-general', label: 'Cycling, general', met: 7.5, code: '01015' },
  { id: 'cycle-stationary', label: 'Exercise bike, general', met: 7.0, code: '02010' },
  { id: 'swim-laps', label: 'Swimming lengths, front crawl, light or moderate', met: 5.8, code: '18310' },
  { id: 'swim-leisure', label: 'Swimming, leisurely', met: 6.0, code: '18350' },
  { id: 'strength-moderate', label: 'Strength training, multiple exercises', met: 3.5, code: '02050' },
  { id: 'strength-vigorous', label: 'Strength training, vigorous', met: 6.0, code: '02054' },
  { id: 'circuit', label: 'Circuit training, vigorous', met: 8.0, code: '02040' },
  { id: 'aerobics', label: 'Aerobics class, general', met: 7.3, code: '03015' },
  { id: 'elliptical', label: 'Cross-trainer, moderate', met: 5.0, code: '02065' },
  { id: 'rowing-machine', label: 'Rowing machine, moderate', met: 4.8, code: '02071' },
  { id: 'yoga', label: 'Yoga, hatha', met: 2.5, code: '02150' },
  { id: 'pilates', label: 'Pilates', met: 3.0, code: '02105' },
  { id: 'stretching', label: 'Stretching, mild', met: 2.3, code: '02101' },
  { id: 'football', label: 'Football (soccer), casual', met: 7.0, code: '15610' },
  { id: 'tennis', label: 'Tennis, general', met: 7.3, code: '15675' },
  { id: 'golf', label: 'Golf, general', met: 4.8, code: '15255' },
  { id: 'gardening', label: 'Gardening, general', met: 3.8, code: '08245' },
  { id: 'other', label: 'Other activity (no estimate)', met: null, code: null },
]);

export const MAX_DURATION_MIN = 600;

export function getActivity(id) {
  return ACTIVITIES.find((a) => a.id === id) ?? null;
}

/** Net active energy in kcal, or null when the activity has no MET value or inputs are missing. */
export function estimateActiveKcal({ met, weightKg, durationMin }) {
  if (!Number.isFinite(met) || met <= 1) return null;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;
  return (met - 1) * weightKg * (durationMin / 60);
}

/** Rounded to the nearest 5 kcal for display. */
export function roundActiveKcal(kcal) {
  return kcal === null ? null : Math.round(kcal / 5) * 5;
}
