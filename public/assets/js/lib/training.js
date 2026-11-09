// Training sessions, weekly summaries and the weight trend. Pure functions, no DOM.

import { getExercise } from './exercises.js';
import { getActivity, estimateActiveKcal, roundActiveKcal } from './activities.js';
import { parseNumber } from './validate.js';
import { isValidLocalDate, parseLocalDate, toLocalDateString } from './dates.js';
import { KG_PER_POUND, roundTo } from './units.js';

export const SESSION_LIMITS = Object.freeze({ reps: 1000, loadKg: 1000, seconds: 3600, minutes: 600, durationMin: 600 });

// Session RPE on the Borg CR10 scale, as used for session-RPE (Foster et al., 2001).
export const EFFORT_SCALE = Object.freeze([
  { value: 1, label: '1 – Very, very easy' },
  { value: 2, label: '2 – Easy' },
  { value: 3, label: '3 – Moderate' },
  { value: 4, label: '4 – Somewhat hard' },
  { value: 5, label: '5 – Hard' },
  { value: 6, label: '6' },
  { value: 7, label: '7 – Very hard' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
  { value: 10, label: '10 – Maximal' },
]);

// "Resistance training, multiple exercises, 8–15 repetitions" (Compendium code 02050).
export const SESSION_MET = 3.5;

/** A new session draft, optionally from a routine. */
export function newSession(routine = null, localDate = toLocalDateString()) {
  return {
    localDate,
    routineId: routine?.id ?? null,
    title: routine?.name ?? 'Training session',
    durationMin: routine ? String(routine.minutes) : '',
    sessionRpe: '',
    notes: '',
    showEstimate: false,
    exercises: (routine?.exercises ?? []).map((item) => sessionExercise(item.exerciseId, item.sets, item.target)),
  };
}

export function sessionExercise(exerciseId, sets = 3, target = '') {
  const ex = getExercise(exerciseId);
  return {
    exerciseId,
    name: ex?.name ?? exerciseId,
    logType: ex?.logType ?? 'reps',
    target,
    sets: Array.from({ length: Math.max(1, sets) }, () => ({ reps: '', load: '', amount: '' })),
  };
}

/** Swap an exercise for a substitution, keeping the number of sets and the target. */
export function swapExercise(item, newExerciseId) {
  return sessionExercise(newExerciseId, item.sets.length, item.target);
}

function numberOrNull(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  return parseNumber(String(raw));
}

/**
 * Validate a session draft (strings from inputs) and convert it to stored, metric form.
 * A set counts only if it has reps (reps/load types) or an amount (time/cardio). Empty sets are dropped.
 * @param {object} draft
 * @param {'metric'|'imperial'} units  load is entered in kg or lb
 */
export function validateSession(draft, units = 'metric', today = toLocalDateString()) {
  const errors = {};
  if (!isValidLocalDate(draft.localDate)) errors.localDate = 'Enter a valid date.';
  else if (draft.localDate > today) errors.localDate = 'The date cannot be in the future.';

  const duration = numberOrNull(draft.durationMin);
  if (duration === null) errors.durationMin = 'Enter how long the session took, in minutes.';
  else if (!Number.isInteger(duration) || duration < 1 || duration > SESSION_LIMITS.durationMin) errors.durationMin = 'Enter whole minutes from 1 to 600.';

  let rpe = null;
  if (draft.sessionRpe !== '' && draft.sessionRpe !== null && draft.sessionRpe !== undefined) {
    rpe = Number(draft.sessionRpe);
    if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) errors.sessionRpe = 'Choose an effort from 1 to 10.';
  }

  const exercises = [];
  const setErrors = [];
  (draft.exercises ?? []).forEach((item, ei) => {
    const ex = getExercise(item.exerciseId);
    if (!ex) return;
    const sets = [];
    item.sets.forEach((set, si) => {
      const where = `${ex.name}, set ${si + 1}`;
      if (ex.logType === 'reps' || ex.logType === 'load') {
        const reps = numberOrNull(set.reps);
        const load = ex.logType === 'load' ? numberOrNull(set.load) : null;
        if (reps === null && load === null) return; // empty set
        if (reps === null || !Number.isInteger(reps) || reps < 1 || reps > SESSION_LIMITS.reps) {
          setErrors.push({ ei, si, field: 'reps', message: `${where}: enter whole repetitions from 1 to ${SESSION_LIMITS.reps}.` });
          return;
        }
        let loadKg = null;
        if (load !== null) {
          const kg = units === 'imperial' ? load * KG_PER_POUND : load;
          if (!Number.isFinite(kg) || kg < 0 || kg > SESSION_LIMITS.loadKg) {
            setErrors.push({ ei, si, field: 'load', message: `${where}: enter a load from 0 to ${units === 'imperial' ? '2,200 lb' : '1,000 kg'}.` });
            return;
          }
          loadKg = roundTo(kg, 2);
        }
        sets.push({ reps, loadKg });
      } else {
        const amount = numberOrNull(set.amount);
        if (amount === null) return;
        if (ex.logType === 'time') {
          if (!Number.isInteger(amount) || amount < 1 || amount > SESSION_LIMITS.seconds) {
            setErrors.push({ ei, si, field: 'amount', message: `${where}: enter whole seconds from 1 to ${SESSION_LIMITS.seconds}.` });
            return;
          }
          sets.push({ durationSec: amount });
        } else {
          if (!Number.isFinite(amount) || amount <= 0 || amount > SESSION_LIMITS.minutes) {
            setErrors.push({ ei, si, field: 'amount', message: `${where}: enter minutes from 1 to ${SESSION_LIMITS.minutes}.` });
            return;
          }
          sets.push({ durationSec: Math.round(amount * 60) });
        }
      }
    });
    if (sets.length) exercises.push({ exerciseId: ex.id, name: ex.name, logType: ex.logType, sets });
  });
  if (setErrors.length) errors.sets = setErrors;
  if (!errors.sets && exercises.length === 0) errors.exercises = 'Record at least one set before saving.';

  if (Object.keys(errors).length) return { ok: false, errors, value: null };
  return {
    ok: true,
    errors: {},
    value: {
      type: 'session',
      localDate: draft.localDate,
      routineId: draft.routineId ?? null,
      title: String(draft.title ?? 'Training session').trim().slice(0, 80) || 'Training session',
      durationMin: duration,
      sessionRpe: rpe,
      notes: String(draft.notes ?? '').trim().slice(0, 300),
      exercises,
      showEstimate: Boolean(draft.showEstimate),
    },
  };
}

/** Add the optional, labelled energy estimate snapshot to a validated session. */
export function withSessionEstimate(session, weightKg) {
  const kcal = session.showEstimate ? roundActiveKcal(estimateActiveKcal({ met: SESSION_MET, weightKg, durationMin: session.durationMin })) : null;
  return { ...session, metUsed: SESSION_MET, weightKgUsed: session.showEstimate ? weightKg ?? null : null, estimatedActiveKcal: kcal };
}

export function sessionStats(session) {
  let sets = 0;
  let reps = 0;
  let volumeKg = 0;
  let timedSec = 0;
  for (const ex of session.exercises ?? []) {
    for (const s of ex.sets) {
      sets += 1;
      if (Number.isFinite(s.reps)) reps += s.reps;
      if (Number.isFinite(s.reps) && Number.isFinite(s.loadKg)) volumeKg += s.reps * s.loadKg;
      if (Number.isFinite(s.durationSec)) timedSec += s.durationSec;
    }
  }
  return { sets, reps, volumeKg, timedSec, exercises: (session.exercises ?? []).length };
}

/** Convert a stored session back into an editable draft. */
export function sessionToDraft(session, units = 'metric') {
  return {
    localDate: session.localDate,
    routineId: session.routineId ?? null,
    title: session.title,
    durationMin: String(session.durationMin ?? ''),
    sessionRpe: session.sessionRpe ? String(session.sessionRpe) : '',
    notes: session.notes ?? '',
    showEstimate: Boolean(session.showEstimate),
    exercises: (session.exercises ?? []).map((ex) => ({
      exerciseId: ex.exerciseId,
      name: ex.name,
      logType: ex.logType,
      target: '',
      sets: ex.sets.map((s) => ({
        reps: Number.isFinite(s.reps) ? String(s.reps) : '',
        load: Number.isFinite(s.loadKg) ? String(units === 'imperial' ? roundTo(s.loadKg / KG_PER_POUND, 1) : roundTo(s.loadKg, 2)) : '',
        amount: Number.isFinite(s.durationSec) ? String(ex.logType === 'cardio' ? roundTo(s.durationSec / 60, 1) : s.durationSec) : '',
      })),
    })),
  };
}

/* ---------------- Weeks ---------------- */

/** Monday of the week containing localDate (weeks run Monday to Sunday). */
export function weekStart(localDate) {
  const d = parseLocalDate(localDate);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return toLocalDateString(d);
}

function addDays(localDate, days) {
  const d = parseLocalDate(localDate);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

/**
 * Weekly summaries for the last `weeks` weeks, newest first.
 * Active minutes = logged activity and session durations (all logged training counts).
 */
export function weeklySummaries(workouts, { weeks = 8, today = toLocalDateString() } = {}) {
  const thisWeek = weekStart(today);
  const out = [];
  for (let i = 0; i < weeks; i += 1) {
    const start = addDays(thisWeek, -7 * i);
    const end = addDays(start, 6);
    const inWeek = workouts.filter((w) => w.localDate >= start && w.localDate <= end);
    const sessions = inWeek.filter((w) => w.type === 'session');
    const strengthDays = new Set(
      sessions.filter((s) => (s.exercises ?? []).some((e) => getExercise(e.exerciseId)?.category !== 'cardio')).map((s) => s.localDate),
    ).size;
    let sets = 0;
    let volumeKg = 0;
    for (const s of sessions) {
      const st = sessionStats(s);
      sets += st.sets;
      volumeKg += st.volumeKg;
    }
    out.push({
      weekStart: start,
      weekEnd: end,
      workouts: inWeek.length,
      sessions: sessions.length,
      activities: inWeek.length - sessions.length,
      minutes: inWeek.reduce((sum, w) => sum + (Number.isFinite(w.durationMin) ? w.durationMin : 0), 0),
      strengthDays,
      sets,
      volumeKg,
    });
  }
  return out;
}

/* ---------------- Weight trend ---------------- */

export const TREND_WINDOW_DAYS = 7;

/**
 * Daily readings with a trailing 7-day average (all readings from the 7 days up to and
 * including that date). Several readings on one day are averaged first.
 */
export function weightTrend(weights) {
  const byDay = new Map();
  for (const w of weights) {
    if (!isValidLocalDate(w.localDate) || !Number.isFinite(w.weightKg)) continue;
    const list = byDay.get(w.localDate) ?? [];
    list.push(w.weightKg);
    byDay.set(w.localDate, list);
  }
  const days = [...byDay.entries()]
    .map(([localDate, list]) => ({ localDate, weightKg: list.reduce((a, b) => a + b, 0) / list.length }))
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
  return days.map((day) => {
    const from = addDays(day.localDate, -(TREND_WINDOW_DAYS - 1));
    const window = days.filter((d) => d.localDate >= from && d.localDate <= day.localDate);
    return { ...day, trendKg: window.reduce((a, d) => a + d.weightKg, 0) / window.length, windowCount: window.length };
  });
}

function daysBetween(a, b) {
  return Math.round((parseLocalDate(b) - parseLocalDate(a)) / 86400000);
}

/**
 * Change in the 7-day average over about four weeks. Returns null unless there are at least
 * 4 readings spanning at least 21 days, so a single day's fluctuation is never reported as change.
 */
export function trendChange(points, { days = 28, minSpanDays = 21, minReadings = 4 } = {}) {
  if (points.length < minReadings) return null;
  const last = points[points.length - 1];
  const first = points[0];
  if (daysBetween(first.localDate, last.localDate) < minSpanDays) return null;
  const cutoff = addDays(last.localDate, -days);
  const candidates = points.filter((p) => p.localDate <= cutoff);
  const base = candidates.length ? candidates[candidates.length - 1] : first;
  return { fromDate: base.localDate, toDate: last.localDate, days: daysBetween(base.localDate, last.localDate), changeKg: last.trendKg - base.trendKg };
}

export function activityLabel(workout) {
  if (workout.type === 'session') return workout.title;
  return workout.activityLabel ?? getActivity(workout.activityId)?.label ?? 'Workout';
}
