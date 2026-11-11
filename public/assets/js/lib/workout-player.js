// The guided workout: turning a plan into timed segments, and a clock-driven engine that says
// what is on screen at any moment. Pure logic, no DOM and no timers: the UI feeds it elapsed
// milliseconds, so pausing is simply not feeding it, and the countdown, repetition counter,
// progress ring and animation phase all come from the same clock and cannot drift apart.

import { getExercise } from './exercises.js';
import { getDemo } from './demos.js';

export const COUNTDOWN_SEC = 3;
export const SWITCH_SEC = 5;
export const LIMITS = Object.freeze({ reps: [1, 100], seconds: [5, 3600], sets: [1, 10], restSec: [0, 300] });
export const PACES = Object.freeze([
  { id: 'slow', label: 'Slower', factor: 1.4 },
  { id: 'normal', label: 'Normal', factor: 1 },
  { id: 'fast', label: 'Faster', factor: 0.75 },
]);
export const DEFAULT_SETTINGS = Object.freeze({ restSec: 30, pace: 'normal', still: false, music: true, voice: true });

const clampInt = (value, [min, max], fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** The starting numbers in a routine target such as "8–12 reps", "6–8 each side" or "20–30 seconds". */
export function parseTarget(target = '') {
  const first = /(\d+)/.exec(String(target));
  if (!first) return {};
  const n = Number(first[1]);
  return /second|sec\b/i.test(target) ? { seconds: n } : /minute|min\b/i.test(target) ? { seconds: n * 60 } : { reps: n };
}

/** Whether an exercise can be done as guided repetitions, for a time, or either. */
export function modesFor(exerciseId) {
  const ex = getExercise(exerciseId);
  const demo = getDemo(exerciseId);
  if (!ex || !demo) return [];
  return demo.kind === 'reps' && (ex.logType === 'reps' || ex.logType === 'load') ? ['reps', 'time'] : ['time'];
}

/** One line of the plan, with defaults from the routine where it has them. */
export function planItem(exerciseId, { sets = 1, target = '' } = {}) {
  const ex = getExercise(exerciseId);
  const demo = getDemo(exerciseId);
  if (!ex || !demo) return null;
  const parsed = parseTarget(target);
  const modes = modesFor(exerciseId);
  return {
    exerciseId,
    name: ex.name,
    modes,
    mode: modes[0],
    reps: clampInt(parsed.reps, LIMITS.reps, 10),
    seconds: clampInt(parsed.seconds, LIMITS.seconds, ex.logType === 'cardio' ? 600 : 30),
    sets: clampInt(sets, LIMITS.sets, 1),
    perSide: demo.sides !== 'none',
  };
}

/** Keep edited plan values inside the limits. */
export function cleanItem(item) {
  return {
    ...item,
    mode: item.modes.includes(item.mode) ? item.mode : item.modes[0],
    reps: clampInt(item.reps, LIMITS.reps, 10),
    seconds: clampInt(item.seconds, LIMITS.seconds, 30),
    sets: clampInt(item.sets, LIMITS.sets, 1),
  };
}

export function cleanSettings(settings = {}) {
  return {
    restSec: clampInt(settings.restSec, LIMITS.restSec, DEFAULT_SETTINGS.restSec),
    pace: PACES.some((p) => p.id === settings.pace) ? settings.pace : DEFAULT_SETTINGS.pace,
    still: settings.still === true,
    // Sound is on unless it was switched off.
    music: settings.music !== false,
    voice: settings.voice !== false,
  };
}

/**
 * The whole session as a list of segments: a 3-2-1 countdown, then work, "switch sides" and rest.
 * One-sided exercises do the first side, pause to switch, then the second side (shown mirrored).
 */
export function buildSegments(items, settings = DEFAULT_SETTINGS) {
  const { restSec, pace } = cleanSettings(settings);
  const factor = PACES.find((p) => p.id === pace).factor;
  const work = [];
  items.map(cleanItem).forEach((item, index) => {
    const demo = getDemo(item.exerciseId);
    if (!demo) return;
    const cycleSec = demo.cycle * (demo.kind === 'reps' ? factor : 1);
    const target = item.mode === 'reps' ? item.reps : item.seconds;
    const base = { type: 'work', item: index, exerciseId: item.exerciseId, name: item.name, sets: item.sets, mode: item.mode, target, cycleSec, sec: item.mode === 'reps' ? target * cycleSec : target };
    for (let set = 1; set <= item.sets; set += 1) {
      if (demo.sides === 'each') work.push([{ ...base, set, side: 0, mirrored: false }, { type: 'switch', sec: SWITCH_SEC }, { ...base, set, side: 1, mirrored: true }]);
      else work.push([{ ...base, set, side: null, mirrored: false }]);
    }
  });
  const segments = [];
  work.forEach((group, i) => {
    if (i === 0) segments.push({ type: 'countdown', sec: COUNTDOWN_SEC });
    else {
      // Always a moment to get ready for a different exercise, even with rest set to zero.
      const changes = group[0].exerciseId !== work[i - 1][0].exerciseId;
      const sec = Math.max(restSec, changes ? COUNTDOWN_SEC : 0);
      if (sec > 0) segments.push({ type: 'rest', sec });
    }
    segments.push(...group);
  });
  // Every pause knows what comes next, for the preview.
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].type !== 'work') segments[i].next = segments.slice(i + 1).find((s) => s.type === 'work') ?? null;
  }
  return segments;
}

/** How many exercises the session has, and which one a work segment is (for "1 of 12"). */
export const exerciseCount = (segments) => new Set(segments.filter((s) => s.type === 'work').map((s) => s.item)).size;

export function createSession(segments) {
  return { segments, index: 0, elapsedMs: 0, activeMs: 0, finished: segments.length === 0, log: [] };
}

const repsDone = (seg, elapsedMs) => Math.min(seg.target, Math.floor(elapsedMs / (seg.cycleSec * 1000) + 1e-6));

function record(session, complete) {
  const seg = session.segments[session.index];
  if (!seg || seg.type !== 'work') return;
  const seconds = complete ? Math.round(seg.sec) : Math.floor(session.elapsedMs / 1000);
  const reps = seg.mode === 'reps' ? (complete ? seg.target : repsDone(seg, session.elapsedMs)) : null;
  if (seg.mode === 'reps' ? reps < 1 : seconds < 1) return;
  session.log.push({ item: seg.item, exerciseId: seg.exerciseId, set: seg.set, side: seg.side, mode: seg.mode, reps, seconds, complete });
}

/** Move the clock on. Returns true if the segment changed (or the session finished). */
export function advance(session, dtMs) {
  if (session.finished || !(dtMs > 0)) return false;
  let changed = false;
  session.elapsedMs += dtMs;
  session.activeMs += dtMs;
  while (!session.finished && session.elapsedMs >= session.segments[session.index].sec * 1000) {
    session.elapsedMs -= session.segments[session.index].sec * 1000;
    record(session, true);
    session.index += 1;
    changed = true;
    if (session.index >= session.segments.length) {
      session.finished = true;
      session.elapsedMs = 0;
    }
  }
  return changed;
}

/** Leave the current segment now, keeping what was done of it. */
export function skip(session) {
  if (session.finished) return;
  record(session, false);
  session.index += 1;
  session.elapsedMs = 0;
  if (session.index >= session.segments.length) session.finished = true;
}

/** Index of the first work segment of an exercise (by its place in the plan), or -1. */
const firstWorkOf = (session, item) => session.segments.findIndex((s) => s.type === 'work' && s.item === item);

/** The exercise on screen: the one being done, or the one a pause leads to. */
export function currentItem(session) {
  if (session.finished) return -1;
  const seg = session.segments[session.index];
  return seg.type === 'work' ? seg.item : (seg.next?.item ?? -1);
}

/**
 * Go straight to an exercise (any one, forwards or back), keeping what was done so far.
 * It starts with a short 3-2-1, from its first set.
 */
export function jumpTo(session, item) {
  if (session.finished) return false;
  let target = firstWorkOf(session, item);
  if (target < 0) return false;
  record(session, false);
  const before = session.segments[target - 1];
  if (before?.type === 'countdown') target -= 1;
  else session.segments.splice(target, 0, { type: 'countdown', sec: COUNTDOWN_SEC, next: session.segments[target] });
  session.index = target;
  session.elapsedMs = 0;
  return true;
}

/** Start the set on screen again from zero. What was done of it so far is not kept. */
export function repeatSet(session) {
  if (session.finished) return false;
  if (session.segments[session.index].type !== 'work') return false;
  session.elapsedMs = 0;
  return true;
}

/**
 * Change the repetitions (or seconds) of an exercise for the set in progress and the sets still
 * to come. Sets already finished keep what was done.
 */
export function retarget(session, item, value) {
  if (session.finished) return null;
  let applied = null;
  session.segments.forEach((seg, i) => {
    if (seg.type !== 'work' || seg.item !== item || i < session.index) return;
    const target = clampInt(value, seg.mode === 'reps' ? LIMITS.reps : LIMITS.seconds, seg.target);
    seg.target = target;
    seg.sec = seg.mode === 'reps' ? target * seg.cycleSec : target;
    applied = target;
  });
  return applied;
}

const KEEP_GOING = Object.freeze(['Keep going!', 'You’ve got this!', 'Nice and steady.', 'Stay strong!', 'Looking good!']);

/**
 * What the voice says at this instant, if anything: the 3-2-1, each finished repetition, time
 * calls and a few encouraging words. `prev` is what was returned as `mark` last time.
 * @returns {{ say: string|null, mark: { index: number, reps: number|null, remainingSec: number } }}
 */
export function spokenCue(prev, session, s = snapshot(session)) {
  if (s.type === 'finished') return { say: prev?.index === -1 ? null : 'Workout complete. Well done!', mark: { index: -1, reps: null, remainingSec: 0 } };
  const mark = { index: session.index, reps: s.reps ?? null, remainingSec: s.remainingSec };
  const fresh = !prev || prev.index !== mark.index;
  let say = null;
  if (s.type === 'work') {
    const { mode, target } = s.seg;
    if (fresh) say = 'Go!';
    else if (mode === 'reps' && s.reps > prev.reps) {
      if (s.reps >= target) say = `${s.reps}. Done!`;
      else if (s.reps === target - 1 && target > 2) say = `${s.reps}. Last one!`;
      else if (s.reps * 2 === target && target >= 6) say = `${s.reps}. Halfway!`;
      else if (s.reps % 5 === 0 && target - s.reps > 2) say = `${s.reps}. ${KEEP_GOING[(s.reps / 5) % KEEP_GOING.length]}`;
      else say = String(s.reps);
    } else if (mode === 'time' && s.remainingSec !== prev.remainingSec) {
      const left = s.remainingSec;
      if (left <= 3 && left > 0) say = String(left);
      else if (left === 10 && target >= 20) say = 'Ten seconds.';
      else if (left * 2 === target && target >= 20) say = 'Halfway!';
      else if (left > 10 && left % 15 === 0 && left !== target) say = KEEP_GOING[(left / 15) % KEEP_GOING.length];
    }
  } else if (fresh) {
    say = s.type === 'rest' ? `Rest. Next, ${s.next.name}.` : s.type === 'switch' ? 'Switch sides.' : `Get ready. ${s.next.name}.`;
  } else if (s.remainingSec !== prev.remainingSec && s.remainingSec <= 3 && s.remainingSec > 0) say = String(s.remainingSec);
  return { say, mark };
}

/** Stop the whole session now, keeping what was done. */
export function end(session) {
  if (session.finished) return;
  record(session, false);
  session.finished = true;
}

/** Everything the screen needs for this instant. */
export function snapshot(session) {
  if (session.finished) return { type: 'finished' };
  const seg = session.segments[session.index];
  const e = session.elapsedMs;
  const total = seg.sec * 1000;
  const progress = total > 0 ? Math.min(1, e / total) : 1;
  const remainingSec = Math.max(0, Math.ceil((total - e) / 1000 - 1e-6));
  if (seg.type !== 'work') {
    const next = seg.next;
    // The preview is timed so that it reaches the start position exactly as the pause ends.
    return { type: seg.type, seg, next, progress, remainingSec, phase: next ? (e - total) / (next.cycleSec * 1000) : 0, untilStartSec: (total - e) / 1000 };
  }
  return {
    type: 'work',
    seg,
    progress,
    remainingSec,
    phase: e / (seg.cycleSec * 1000),
    reps: seg.mode === 'reps' ? repsDone(seg, e) : null,
  };
}

/**
 * What was done, per exercise and set. For one-sided exercises a set's value is per side
 * (the larger of the two sides, if they differ because one was cut short).
 */
export function summarise(session, items) {
  const out = [];
  items.forEach((item, index) => {
    const entries = session.log.filter((l) => l.item === index);
    const sets = [];
    for (const set of [...new Set(entries.map((l) => l.set))].sort((a, b) => a - b)) {
      const mine = entries.filter((l) => l.set === set);
      const mode = mine[0].mode;
      sets.push(mode === 'reps' ? { reps: Math.max(...mine.map((l) => l.reps)) } : { seconds: Math.max(...mine.map((l) => l.seconds)) });
    }
    if (sets.length) out.push({ exerciseId: item.exerciseId, name: item.name, perSide: item.perSide, sets });
  });
  return out;
}

/** Whole minutes the session took (at least 1), without paused time. */
export const sessionMinutes = (session) => Math.max(1, Math.round(session.activeMs / 60000));

/**
 * Completed work in the shape the session logger edits (strings, one entry per set), so the
 * existing "Save session" flow records it. Load is left for the person to fill in; so are
 * repetitions when a repetition exercise was done for time.
 */
export function toDraftExercises(summary) {
  return summary.map(({ exerciseId, name, sets }) => {
    const ex = getExercise(exerciseId);
    return {
      exerciseId,
      name,
      logType: ex.logType,
      target: '',
      sets: sets.map((s) => {
        if (ex.logType === 'time') return { reps: '', load: '', amount: String(s.seconds ?? '') };
        if (ex.logType === 'cardio') return { reps: '', load: '', amount: s.seconds ? String(Math.max(0.5, Math.round((s.seconds / 60) * 10) / 10)) : '' };
        return { reps: s.reps ? String(s.reps) : '', load: '', amount: '' };
      }),
    };
  });
}
