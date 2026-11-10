// How the user changed a photo scan's suggestions before saving, to compare AI providers.
// Only counts leave the device: never food names, amounts or the photo.

/** An amount within 10% of the suggestion counts as kept. */
export const KEPT_TOLERANCE = 0.1;

/**
 * @param {Array<{ suggested: boolean, removed: boolean, chosen: number, grams: number, suggestedGrams?: number }>} rows
 * @returns {{ kept: number, changed: number, removed: number, added: number }}
 */
export function feedbackCounts(rows) {
  const counts = { kept: 0, changed: 0, removed: 0, added: 0 };
  for (const row of rows) {
    if (!row.suggested) {
      if (!row.removed) counts.added += 1;
      continue;
    }
    if (row.removed) {
      counts.removed += 1;
      continue;
    }
    const base = Number(row.suggestedGrams);
    const sameAmount = Number.isFinite(base) && base > 0 && Math.abs(Number(row.grams) - base) / base <= KEPT_TOLERANCE;
    if (row.chosen === 0 && sameAmount) counts.kept += 1;
    else counts.changed += 1;
  }
  return counts;
}
