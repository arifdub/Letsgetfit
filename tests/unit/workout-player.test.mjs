import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoutine, EXERCISES } from '../../public/assets/js/lib/exercises.js';
import { getDemo } from '../../public/assets/js/lib/demos.js';
import { validateSession, newSession } from '../../public/assets/js/lib/training.js';
import {
  parseTarget, modesFor, planItem, cleanItem, cleanSettings, buildSegments, exerciseCount, createSession, advance, skip, end, snapshot, summarise,
  sessionMinutes, toDraftExercises, currentItem, jumpTo, repeatSet, retarget, spokenCue, COUNTDOWN_SEC, SWITCH_SEC,
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
  assert.deepEqual(cleanSettings({ restSec: -5, pace: 'warp', still: 'yes' }), { restSec: 0, pace: 'normal', still: false, music: true, voice: true });
  assert.deepEqual(cleanSettings({ music: false, voice: false }), { restSec: 30, pace: 'normal', still: false, music: false, voice: false }, 'sound stays off once switched off');
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

const three = () => {
  const items = plan('no-equipment-three').map((i) => ({ ...i, reps: 4, sets: 2 }));
  return { items, session: createSession(buildSegments(items, { restSec: 10, pace: 'normal' })) };
};

test('go to any exercise: forwards or back, with a 3-2-1, keeping what was done', () => {
  const { items, session } = three();
  assert.equal(currentItem(session), 0, 'the countdown leads to the first exercise');
  run(session, COUNTDOWN_SEC + 3.1); // one squat done
  assert.equal(snapshot(session).reps, 1);
  assert.equal(jumpTo(session, 2), true);
  let s = snapshot(session);
  assert.deepEqual([s.type, s.next.exerciseId, s.next.set, s.remainingSec, currentItem(session)], ['countdown', 'hindu-push-up', 1, 3, 2]);
  run(session, COUNTDOWN_SEC + 0.1);
  s = snapshot(session);
  assert.deepEqual([s.type, s.seg.exerciseId, s.seg.set], ['work', 'hindu-push-up', 1]);
  // Back to the second exercise, from its first set.
  jumpTo(session, 1);
  run(session, COUNTDOWN_SEC + 0.1);
  assert.deepEqual([snapshot(session).seg.exerciseId, snapshot(session).seg.set], ['push-up', 1]);
  // Jumping to the same exercise twice does not stack countdowns.
  jumpTo(session, 1);
  const n = session.segments.length;
  jumpTo(session, 1);
  assert.equal(session.segments.length, n);
  assert.equal(jumpTo(session, 9), false, 'no such exercise');
  end(session);
  assert.deepEqual(summarise(session, items).map((x) => [x.exerciseId, x.sets]), [['bodyweight-squat', [{ reps: 1 }]]], 'the squat that was finished is kept');
  assert.equal(jumpTo(session, 0), false, 'nothing to go to once finished');
});

test('starting from a later exercise leaves the earlier ones undone', () => {
  const { items, session } = three();
  jumpTo(session, 1);
  run(session, 600);
  assert.equal(session.finished, true);
  assert.deepEqual(summarise(session, items).map((x) => x.exerciseId), ['push-up', 'hindu-push-up']);
});

test('repeat the set, and change the repetitions for this set and the ones to come', () => {
  const { session } = three();
  assert.equal(repeatSet(session), false, 'nothing to repeat during the countdown');
  run(session, COUNTDOWN_SEC + 6.1);
  assert.equal(snapshot(session).reps, 2);
  assert.equal(repeatSet(session), true);
  assert.deepEqual([snapshot(session).reps, snapshot(session).seg.set], [0, 1]);
  assert.equal(retarget(session, 0, 6), 6);
  assert.deepEqual(session.segments.filter((x) => x.type === 'work' && x.item === 0).map((x) => [x.target, x.sec]), [[6, 18], [6, 18]]);
  assert.equal(session.segments.find((x) => x.type === 'work' && x.item === 1).target, 4, 'other exercises are untouched');
  assert.equal(retarget(session, 0, 500), 100, 'kept inside the limits');
  // Fewer than already done: the set completes straight away with what was done counted.
  run(session, 6.1);
  retarget(session, 0, 2);
  run(session, 0.1);
  assert.deepEqual(session.log.at(-1), { item: 0, exerciseId: 'bodyweight-squat', set: 1, side: null, mode: 'reps', reps: 2, seconds: 6, complete: true });
  assert.equal(snapshot(session).type, 'rest');
  // A set that is already finished keeps its numbers; only what is left changes.
  retarget(session, 0, 3);
  assert.deepEqual(session.segments.filter((x) => x.type === 'work' && x.item === 0).map((x) => x.target), [2, 3]);
});

test('voice: 3-2-1, go, each finished repetition, encouragement, rest and the end', () => {
  const items = [{ ...planItem('bodyweight-squat', { sets: 1, target: '6 reps' }) }, { ...planItem('plank', { sets: 1, target: '30 seconds' }) }];
  const session = createSession(buildSegments(items, { restSec: 5, pace: 'normal' }));
  const said = [];
  let mark = null;
  for (let t = 0; t < 70000 && !session.finished; t += 100) {
    const cue = spokenCue(mark, session);
    mark = cue.mark;
    if (cue.say) said.push(cue.say);
    advance(session, 100);
  }
  said.push(spokenCue(mark, session).say);
  assert.deepEqual(said, [
    'Get ready. Bodyweight squat.', '2', '1', 'Go!', '1', '2', '3. Halfway!', '4', '5. Last one!',
    'Rest. Next, Plank.', '3', '2', '1', 'Go!', 'Halfway!', 'Ten seconds.', '3', '2', '1',
    'Workout complete. Well done!',
  ]);
  // Nothing is repeated while the moment stays the same (for example when paused).
  const again = createSession(buildSegments(items, { restSec: 5 }));
  const first = spokenCue(null, again);
  assert.equal(spokenCue(first.mark, again).say, null);
});
