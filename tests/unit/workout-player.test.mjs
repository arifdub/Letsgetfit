import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoutine, EXERCISES } from '../../public/assets/js/lib/exercises.js';
import { getDemo } from '../../public/assets/js/lib/demos.js';
import { validateSession, newSession } from '../../public/assets/js/lib/training.js';
import {
  parseTarget, modesFor, planItem, cleanItem, cleanSettings, buildSegments, exerciseCount, createSession, advance, skip, end, snapshot, summarise,
  sessionMinutes, toDraftExercises, COUNTDOWN_SEC, SWITCH_SEC,
} from '../../public/assets/js/lib/workout-player.js';

const plan = (routineId) => getRoutine(routineId).exercises.map((e) => planItem(e.exerciseId, e));
const run = (session, seconds, step = 50) => {
  for (let t = 0; t < seconds * 1000 - 1e-6; t += step) advance(session, step);
};

test('plan defaults come from the routine; modes follow the exercise', () => {
  assert.deepEqual(parseTarget('8–12 reps'), { reps: 8 });
  assert.deepEqual(parseTarget('6–10 each side'), { reps: 6 });
  assert.deepEqual(parseTarget('20–30 seconds'), { seconds: 20 });
  assert.deepEqual(parseTarget('15–30 seconds each side'), { seconds: 15 });
  assert.deepEqual(parseTarget(''), {});
  const items = plan('home-starter');
  assert.deepEqual(items.map((i) => [i.exerciseId, i.mode, i.mode === 'reps' ? i.reps : i.seconds, i.sets, i.perSide]), [
    ['bodyweight-squat', 'reps', 10, 2, false], ['incline-push-up', 'reps', 8, 2, false], ['glute-bridge', 'reps', 10, 2, false],
    ['reverse-lunge', 'reps', 6, 2, true], ['bird-dog', 'reps', 6, 2, true], ['plank', 'time', 20, 2, false],
  ]);
  assert.deepEqual(modesFor('push-up'), ['reps', 'time']);
  assert.deepEqual(modesFor('plank'), ['time']);
  assert.deepEqual(modesFor('farmers-carry'), ['time']);
  assert.deepEqual(modesFor('brisk-walk'), ['time']);
  assert.equal(planItem('brisk-walk').seconds, 600);
  assert.equal(planItem('nope'), null);
  for (const ex of EXERCISES) assert.ok(modesFor(ex.id).length >= 1, ex.id);
  assert.deepEqual(cleanItem({ ...planItem('plank'), mode: 'reps', seconds: 99999, sets: 0 }), { ...planItem('plank'), mode: 'time', seconds: 3600, sets: 1 });
  assert.deepEqual(cleanSettings({ restSec: -5, pace: 'warp', still: 'yes' }), { restSec: 0, pace: 'normal', still: false });
});

test('segments: countdown first, rest between sets and exercises, both sides for one-sided moves', () => {
  const items = [planItem('bodyweight-squat', { sets: 2, target: '5 reps' }), planItem('side-plank', { sets: 1, target: '15 seconds' })];
  const segs = buildSegments(items, { restSec: 20, pace: 'normal' });
  assert.deepEqual(segs.map((s) => s.type), ['countdown', 'work', 'rest', 'work', 'rest', 'work', 'switch', 'work']);
  assert.equal(segs[0].sec, COUNTDOWN_SEC);
  assert.equal(segs[0].next.exerciseId, 'bodyweight-squat');
  assert.equal(segs[1].sec, 5 * getDemo('bodyweight-squat').cycle);
  assert.deepEqual([segs[2].sec, segs[2].next.set], [20, 2]);
  assert.equal(segs[4].next.exerciseId, 'side-plank');
  assert.deepEqual([segs[5].side, segs[5].mirrored, segs[6].sec, segs[7].side, segs[7].mirrored], [0, false, SWITCH_SEC, 1, true]);
  assert.equal(exerciseCount(segs), 2);
  // No rest: sets run straight on, but a new exercise still gets a short get-ready pause.
  assert.deepEqual(buildSegments(items, { restSec: 0 }).map((s) => [s.type, s.sec]).filter(([t]) => t === 'rest'), [['rest', COUNTDOWN_SEC]]);
  // Pace changes guided repetitions, not holds.
  const slow = buildSegments(items, { restSec: 20, pace: 'slow' });
  assert.ok(slow[1].cycleSec > segs[1].cycleSec);
  assert.equal(slow[5].sec, 15);
});

test('guided reps: the counter goes up only when the character finishes a full repetition', () => {
  const session = createSession(buildSegments([planItem('bodyweight-squat', { sets: 1, target: '3 reps' })], { restSec: 0 }));
  const cycle = getDemo('bodyweight-squat').cycle;
  assert.deepEqual([snapshot(session).type, snapshot(session).remainingSec], ['countdown', 3]);
  run(session, 1.5);
  assert.equal(snapshot(session).remainingSec, 2);
  run(session, 1.5);
  let s = snapshot(session);
  assert.deepEqual([s.type, s.reps, s.seg.target], ['work', 0, 3]);
  run(session, cycle * 0.98);
  s = snapshot(session);
  assert.equal(s.reps, 0, 'not counted mid-movement');
  assert.ok(s.phase > 0.9 && s.phase < 1);
  run(session, cycle * 0.04);
  assert.equal(snapshot(session).reps, 1);
  assert.ok(Math.abs(snapshot(session).progress - (cycle * 1.02) / (cycle * 3)) < 0.02, 'ring follows the same clock');
  run(session, cycle * 2);
  assert.equal(session.finished, true);
  assert.deepEqual(summarise(session, [planItem('bodyweight-squat')]), [{ exerciseId: 'bodyweight-squat', name: 'Bodyweight squat', perSide: false, sets: [{ reps: 3 }] }]);
});

test('timed mode, rest with a preview that lands on the start pose, and pausing', () => {
  const items = [planItem('plank', { sets: 2, target: '10 seconds' })];
  const session = createSession(buildSegments(items, { restSec: 8 }));
  run(session, 3);
  assert.deepEqual([snapshot(session).type, snapshot(session).remainingSec], ['work', 10]);
  run(session, 4);
  // Paused: nothing is fed to the clock, so nothing moves.
  const before = JSON.stringify(snapshot(session));
  advance(session, 0);
  assert.equal(JSON.stringify(snapshot(session)), before);
  assert.equal(snapshot(session).remainingSec, 6);
  run(session, 6);
  let s = snapshot(session);
  assert.deepEqual([s.type, s.remainingSec, s.next.set], ['rest', 8, 2]);
  run(session, 7.95);
  s = snapshot(session);
  assert.ok(Math.abs(s.phase) < 0.05, 'the preview reaches phase 0 as the rest ends');
  run(session, 0.05 + 10);
  assert.equal(session.finished, true);
  assert.deepEqual(summarise(session, items)[0].sets, [{ seconds: 10 }, { seconds: 10 }]);
  assert.equal(sessionMinutes(session), 1);
});

test('skip keeps what was done; end stops everything; a big jump in time carries over correctly', () => {
  const items = [planItem('push-up', { sets: 2, target: '5 reps' }), planItem('plank', { sets: 1, target: '20 seconds' })];
  const cycle = getDemo('push-up').cycle;
  const session = createSession(buildSegments(items, { restSec: 10 }));
  run(session, 3 + cycle * 2.5);
  assert.equal(snapshot(session).reps, 2);
  skip(session);
  assert.equal(snapshot(session).type, 'rest');
  skip(session);
  assert.deepEqual([snapshot(session).type, snapshot(session).seg.set, snapshot(session).reps], ['work', 2, 0]);
  skip(session); // nothing done in set 2: not recorded
  skip(session);
  assert.equal(snapshot(session).seg.exerciseId, 'plank');
  run(session, 7.5);
  end(session);
  assert.equal(snapshot(session).type, 'finished');
  assert.deepEqual(summarise(session, items).map((x) => [x.exerciseId, x.sets]), [['push-up', [{ reps: 2 }]], ['plank', [{ seconds: 7 }]]]);
  skip(session); // harmless after the end
  // One huge tick (a throttled tab) lands in the right place.
  const other = createSession(buildSegments([planItem('plank', { sets: 2, target: '10 seconds' })], { restSec: 5 }));
  advance(other, (3 + 10 + 5 + 4) * 1000);
  assert.deepEqual([snapshot(other).type, snapshot(other).seg.set, snapshot(other).remainingSec], ['work', 2, 6]);
});

test('per-side counting: alternating counts a rep per side per pass; one-sided does each side in turn', () => {
  const lunge = [planItem('reverse-lunge', { sets: 1, target: '2 each side' })];
  const a = createSession(buildSegments(lunge, { restSec: 0 }));
  const cycle = getDemo('reverse-lunge').cycle;
  run(a, 3 + cycle * 0.6);
  assert.equal(snapshot(a).reps, 0, 'one side done is not yet one each side');
  run(a, cycle * 0.5);
  assert.equal(snapshot(a).reps, 1);
  run(a, cycle);
  assert.deepEqual(summarise(a, lunge)[0], { exerciseId: 'reverse-lunge', name: 'Reverse lunge', perSide: true, sets: [{ reps: 2 }] });

  const row = [planItem('one-arm-row', { sets: 1, target: '4 each side' })];
  const b = createSession(buildSegments(row, { restSec: 0 }));
  const c = getDemo('one-arm-row').cycle;
  run(b, 3 + c * 4);
  assert.deepEqual([snapshot(b).type, snapshot(b).next.side, snapshot(b).next.mirrored], ['switch', 1, true]);
  run(b, SWITCH_SEC + c * 2.2);
  end(b);
  assert.deepEqual(b.log.map((l) => [l.side, l.reps, l.complete]), [[0, 4, true], [1, 2, false]]);
  assert.deepEqual(summarise(b, row)[0].sets, [{ reps: 4 }], 'per side');
});

test('completed work becomes a draft the existing session logger accepts', () => {
  const items = [planItem('goblet-squat', { sets: 2, target: '3 reps' }), planItem('plank', { sets: 1, target: '12 seconds' }), planItem('brisk-walk'), planItem('push-up', { sets: 1 })];
  items[2].seconds = 90;
  items[3].mode = 'time';
  items[3].seconds = 10;
  const session = createSession(buildSegments(items, { restSec: 0 }));
  advance(session, 3600 * 1000);
  assert.equal(session.finished, true);
  const exercises = toDraftExercises(summarise(session, items));
  assert.deepEqual(exercises.map((e) => [e.exerciseId, e.sets]), [
    ['goblet-squat', [{ reps: '3', load: '', amount: '' }, { reps: '3', load: '', amount: '' }]],
    ['plank', [{ reps: '', load: '', amount: '12' }]],
    ['brisk-walk', [{ reps: '', load: '', amount: '1.5' }]],
    ['push-up', [{ reps: '', load: '', amount: '' }]], // done for time: repetitions are for the person to fill in
  ]);
  const draft = { ...newSession(null, '2026-11-10'), durationMin: String(sessionMinutes(session)), exercises };
  const result = validateSession(draft, 'metric', '2026-11-10');
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.value.exercises.map((e) => [e.exerciseId, e.sets]), [
    ['goblet-squat', [{ reps: 3, loadKg: null }, { reps: 3, loadKg: null }]],
    ['plank', [{ durationSec: 12 }]],
    ['brisk-walk', [{ durationSec: 90 }]],
  ]);
});
