import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackCounts } from '../../public/assets/js/lib/scan-feedback.js';

test('scan feedback counts kept, changed, removed and added items', () => {
  const rows = [
    { suggested: true, removed: false, chosen: 0, grams: 120, suggestedGrams: 120 }, // kept
    { suggested: true, removed: false, chosen: 0, grams: 130, suggestedGrams: 120 }, // within 10%: kept
    { suggested: true, removed: false, chosen: 0, grams: 200, suggestedGrams: 120 }, // amount changed
    { suggested: true, removed: false, chosen: 1, grams: 120, suggestedGrams: 120 }, // other match chosen
    { suggested: true, removed: true, chosen: 0, grams: 50, suggestedGrams: 50 }, // removed
    { suggested: false, removed: false, chosen: 0, grams: 10 }, // added by the user
    { suggested: false, removed: true, chosen: 0, grams: 10 }, // added then removed: not counted
  ];
  assert.deepEqual(feedbackCounts(rows), { kept: 2, changed: 2, removed: 1, added: 1 });
  assert.deepEqual(feedbackCounts([]), { kept: 0, changed: 0, removed: 0, added: 0 });
});
