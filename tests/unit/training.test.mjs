import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, ROUTINES, LOG_TYPES, EQUIPMENT, DIFFICULTY, getExercise, getRoutine, filterExercises } from '../../public/assets/js/lib/exercises.js';
import { getActivity } from '../../public/assets/js/lib/activities.js';
import {
  newSession,
  swapExercise,
  validateSession,
  withSessionEstimate,
  sessionStats,
  sessionToDraft,
  weekStart,
  weeklySummaries,
  weightTrend,
  trendChange,
  EFFORT_SCALE,
} from '../../public/assets/js/lib/training.js';
import { toLocalDateString } from '../../public/assets/js/lib/dates.js';
import { csvCell, toCsv, workoutsCsv, setsCsv, weightsCsv, diaryCsv } from '../../public/assets/js/lib/csv.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('library integrity: unique IDs, valid fields, substitutions resolve, cues present', () => {
  const ids = new Set(EXERCISES.map((e) => e.id));
  assert.equal(ids.size, EXERCISES.length);
  for (const e of EXERCISES) {
    assert.ok(LOG_TYPES.includes(e.logType), e.id);
    assert.ok(Object.hasOwn(DIFFICULTY, e.difficulty), e.id);
    assert.ok(e.equipment.length > 0 && e.equipment.every((k) => Object.hasOwn(EQUIPMENT, k)), e.id);
    assert.ok(e.cues.length >= 2, `${e.id} needs form cues`);
    assert.ok(e.substitutions.length >= 1, `${e.id} needs a substitution`);
    for (const sub of e.substitutions) {
      assert.ok(ids.has(sub), `${e.id} -> ${sub}`);
      assert.notEqual(sub, e.id);
    }
    if (e.logType === 'cardio') assert.ok(getActivity(e.activityId)?.met, `${e.id} maps to a MET activity`);
  }
});

test('routines reference real exercises and include home and gym options', () => {
  for (const r of ROUTINES) {
    assert.ok(r.exercises.length >= 4, r.id);
    for (const item of r.exercises) {
      assert.ok(getExercise(item.exerciseId), `${r.id}: ${item.exerciseId}`);
      assert.ok(item.sets >= 1 && item.sets <= 5);
      assert.ok(item.target.length > 0);
    }
  }
  assert.ok(ROUTINES.some((r) => r.location === 'home'));
  assert.ok(ROUTINES.some((r) => r.location === 'gym'));
  // A no-equipment option exists: every exercise in Home starter works without weights.
  assert.ok(getRoutine('home-starter').exercises.every((i) => getExercise(i.exerciseId).equipment.some((k) => ['none', 'mat', 'chair'].includes(k))));
});

test('library filters', () => {
  const body = filterExercises({ equipment: 'bodyweight' });
  assert.ok(body.some((e) => e.id === 'push-up'));
  assert.ok(!body.some((e) => e.id === 'leg-press'));
  assert.ok(filterExercises({ equipment: 'gym' }).every((e) => e.equipment.some((k) => ['machine', 'cable', 'barbell', 'bench', 'bar'].includes(k))));
  assert.deepEqual(filterExercises({ category: 'cardio' }).map((e) => e.category), ['cardio', 'cardio', 'cardio']);
  assert.deepEqual(filterExercises({ text: 'HAMSTRING' }).map((e) => e.id).sort(), ['dumbbell-rdl', 'glute-bridge', 'leg-curl']);
});

test('new session from a routine pre-fills exercises and empty sets', () => {
  const s = newSession(getRoutine('gym-a'), '2026-11-09');
  assert.equal(s.title, 'Gym full body A');
  assert.equal(s.durationMin, '45');
  assert.equal(s.exercises.length, 5);
  assert.equal(s.exercises[0].sets.length, 3);
  assert.equal(s.exercises[0].logType, 'load');
  assert.equal(newSession(null, '2026-11-09').exercises.length, 0);
});

test('swapping keeps the number of sets and the target', () => {
  const s = newSession(getRoutine('gym-a'), '2026-11-09');
  const swapped = swapExercise(s.exercises[0], 'goblet-squat');
  assert.equal(swapped.exerciseId, 'goblet-squat');
  assert.equal(swapped.sets.length, 3);
  assert.equal(swapped.target, '10–12 reps');
});

function filledDraft() {
  const s = newSession(getRoutine('home-dumbbell'), '2026-11-09');
  s.durationMin = '40';
  s.sessionRpe = '6';
  s.exercises[0].sets = [{ reps: '10', load: '12' }, { reps: '10', load: '12,5' }, { reps: '', load: '' }]; // goblet squat
  s.exercises[1].sets = [{ reps: '8', load: '' }]; // floor press, no load recorded
  s.exercises[5].sets = [{ reps: '6' }]; // dead bug (reps only)
  return s;
}

test('session validation stores metric values and drops empty sets', () => {
  const r = validateSession(filledDraft(), 'metric', '2026-11-09');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.type, 'session');
  assert.equal(r.value.durationMin, 40);
  assert.equal(r.value.sessionRpe, 6);
  assert.equal(r.value.exercises.length, 3);
  assert.deepEqual(r.value.exercises[0].sets, [{ reps: 10, loadKg: 12 }, { reps: 10, loadKg: 12.5 }]);
  assert.deepEqual(r.value.exercises[1].sets, [{ reps: 8, loadKg: null }]);
  const stats = sessionStats(r.value);
  assert.deepEqual(stats, { sets: 4, reps: 34, volumeKg: 245, timedSec: 0, exercises: 3 });
});

test('imperial load is converted to kg once', () => {
  const d = newSession(getRoutine('gym-a'), '2026-11-09');
  d.durationMin = '45';
  d.exercises[0].sets = [{ reps: '10', load: '100' }];
  const r = validateSession(d, 'imperial', '2026-11-09');
  assert.equal(r.value.exercises[0].sets[0].loadKg, 45.36);
  const back = sessionToDraft(r.value, 'imperial');
  assert.equal(back.exercises[0].sets[0].load, '100');
});

test('time and cardio sets', () => {
  const d = newSession(null, '2026-11-09');
  d.durationMin = '30';
  d.exercises = [
    { exerciseId: 'plank', sets: [{ amount: '30' }, { amount: '45' }] },
    { exerciseId: 'exercise-bike', sets: [{ amount: '20' }] },
  ];
  const r = validateSession(d, 'metric', '2026-11-09');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.exercises[0].sets, [{ durationSec: 30 }, { durationSec: 45 }]);
  assert.deepEqual(r.value.exercises[1].sets, [{ durationSec: 1200 }]);
  assert.equal(sessionToDraft(r.value).exercises[1].sets[0].amount, '20');
});

test('session validation errors', () => {
  const today = '2026-11-09';
  const empty = validateSession({ ...newSession(null, today), durationMin: '30' }, 'metric', today);
  assert.match(empty.errors.exercises, /at least one set/);
  const d = filledDraft();
  d.durationMin = '';
  d.localDate = '2026-11-10';
  d.sessionRpe = '11';
  d.exercises[0].sets[0] = { reps: '10.5', load: '12' };
  d.exercises[0].sets[1] = { reps: '10', load: '-5' };
  const r = validateSession(d, 'metric', today);
  assert.ok(r.errors.durationMin);
  assert.ok(r.errors.localDate);
  assert.ok(r.errors.sessionRpe);
  assert.equal(r.errors.sets.length, 2);
  assert.match(r.errors.sets[0].message, /Goblet squat, set 1: enter whole repetitions/);
  assert.match(r.errors.sets[1].message, /set 2: enter a load/);
});

test('session energy estimate is optional, labelled, and uses 3.5 MET net', () => {
  const v = validateSession({ ...filledDraft(), showEstimate: true }, 'metric', '2026-11-09').value;
  const e = withSessionEstimate(v, 80);
  // (3.5 − 1) × 80 kg × 40/60 h = 133.3 -> 135
  assert.equal(e.estimatedActiveKcal, 135);
  assert.equal(withSessionEstimate({ ...v, showEstimate: false }, 80).estimatedActiveKcal, null);
  assert.equal(withSessionEstimate(v, null).estimatedActiveKcal, null);
});

test('effort scale is CR10 1–10', () => {
  assert.deepEqual(EFFORT_SCALE.map((e) => e.value), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('weeks start on Monday', () => {
  assert.equal(weekStart('2026-11-09'), '2026-11-09'); // Monday
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // Sunday
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(weekStart('2027-01-01'), '2026-12-28'); // across a year end
});

test('weekly summaries count sessions, activities, minutes, strength days and volume', () => {
  const session = validateSession(filledDraft(), 'metric', '2026-11-09').value;
  const workouts = [
    { ...session, localDate: '2026-11-10' },
    { ...session, localDate: '2026-11-10' }, // same day: one strength day
    { ...session, localDate: '2026-11-12' },
    { type: 'activity', localDate: '2026-11-11', activityId: 'walk-brisk', durationMin: 30 },
    { type: 'activity', localDate: '2026-11-03', activityId: 'yoga', durationMin: 20 }, // previous week
  ];
  const [thisWeek, lastWeek, older] = weeklySummaries(workouts, { weeks: 3, today: '2026-11-13' });
  assert.equal(thisWeek.weekStart, '2026-11-09');
  assert.equal(thisWeek.sessions, 3);
  assert.equal(thisWeek.activities, 1);
  assert.equal(thisWeek.minutes, 150);
  assert.equal(thisWeek.strengthDays, 2);
  assert.equal(thisWeek.sets, 12);
  assert.equal(thisWeek.volumeKg, 735);
  assert.equal(lastWeek.minutes, 20);
  assert.equal(older.workouts, 0);
});

test('weight trend: 7-day trailing average, same-day readings averaged', () => {
  const pts = weightTrend([
    { localDate: '2026-11-01', weightKg: 80 },
    { localDate: '2026-11-03', weightKg: 81 },
    { localDate: '2026-11-03', weightKg: 80 }, // same day -> 80.5
    { localDate: '2026-11-07', weightKg: 79.5 },
    { localDate: '2026-11-08', weightKg: 79 }, // 11-01 drops out of the window
    { localDate: 'bad', weightKg: 1 },
  ]);
  assert.deepEqual(pts.map((p) => p.localDate), ['2026-11-01', '2026-11-03', '2026-11-07', '2026-11-08']);
  close(pts[1].weightKg, 80.5);
  close(pts[1].trendKg, 80.25);
  close(pts[2].trendKg, (80 + 80.5 + 79.5) / 3);
  close(pts[3].trendKg, (80.5 + 79.5 + 79) / 3);
  assert.equal(pts[3].windowCount, 3);
});

test('trend change needs enough data and ignores single-day swings', () => {
  const few = weightTrend([
    { localDate: '2026-11-01', weightKg: 80 },
    { localDate: '2026-11-02', weightKg: 78 }, // big one-day drop
  ]);
  assert.equal(trendChange(few), null);
  const shortSpan = weightTrend(['01', '03', '05', '07', '09'].map((d) => ({ localDate: `2026-11-${d}`, weightKg: 80 })));
  assert.equal(trendChange(shortSpan), null, 'under 21 days');
  // A reading every second day for 36 days, drifting down 0.05 kg a day.
  const readings = [];
  for (let i = 0; i <= 35; i += 2) readings.push({ localDate: toLocalDateString(new Date(2026, 9, 1 + i)), weightKg: 82 - i * 0.05 });
  const pts = weightTrend(readings);
  const change = trendChange(pts);
  assert.ok(change);
  assert.ok(change.days >= 28 && change.days <= 30, String(change.days));
  assert.ok(change.changeKg < 0);
});

test('CSV escaping and formula-injection protection', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+353'), "'+353");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell(-1.5), '-1.5', 'numbers are not prefixed');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  const csv = toCsv([{ label: 'x', value: (r) => r }], [1, 'two']);
  assert.equal(csv, '﻿x\r\n1\r\ntwo\r\n');
});

test('CSV exports have stable headers and one row per record or set', () => {
  const session = { id: 's1', ...validateSession(filledDraft(), 'metric', '2026-11-09').value };
  const activity = { id: 'a1', type: 'activity', localDate: '2026-11-08', activityLabel: 'Yoga, hatha', durationMin: 20, notes: '=cmd' };
  const w = workoutsCsv([session, activity]).replace('﻿', '').split('\r\n');
  assert.equal(w[0], 'date,type,name,duration_min,effort_rpe_1_10,sets,volume_kg,estimated_active_kcal,notes,id');
  assert.equal(w[1], "2026-11-08,activity,\"Yoga, hatha\",20,,,,,'=cmd,a1");
  assert.equal(w[2], '2026-11-09,session,Home with dumbbells,40,6,4,245,,,s1');
  const s = setsCsv([session, activity]).replace('﻿', '').trim().split('\r\n');
  assert.equal(s.length, 1 + 4);
  assert.equal(s[1], '2026-11-09,Home with dumbbells,Goblet squat,1,10,12,,s1');
  assert.match(weightsCsv([{ id: 'k', localDate: '2026-11-01', weightKg: 80.2 }]), /2026-11-01,80\.2,,k/);
  const d = diaryCsv([{ id: 'd', localDate: '2026-11-01', meal: 'lunch', name: 'Apple', source: 'custom', servingG: 150, nutrients: { energy: 78, vitaminD: null } }]);
  assert.match(d.split('\r\n')[0], /amount_g,energy_kcal,protein_g,.*vitaminD_ug,vitaminB12_ug,id$/);
  assert.match(d, /2026-11-01,lunch,Apple,,custom,,150,78,/);
});
