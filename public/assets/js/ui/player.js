// The guided workout: a setup screen to review the plan, then a full-screen player with the
// animated demonstration, a countdown or guided repetition counter, rests and a summary.
//
// All timing comes from lib/workout-player.js; this file feeds it the time that has passed and
// draws what it reports. Pausing (the button, Escape, or the app going to the background)
// simply stops feeding the clock, so everything resumes from exactly the same point.

import { getExercise, SAFETY_NOTE } from '../lib/exercises.js';
import { getDemo, sideAt } from '../lib/demos.js';
import {
  planItem, cleanItem, cleanSettings, buildSegments, exerciseCount, createSession, advance, skip, end, snapshot, summarise, sessionMinutes,
  toDraftExercises, PACES, LIMITS, DEFAULT_SETTINGS,
} from '../lib/workout-player.js';
import { createStage } from './figure.js';
import { $, h, formatNumber, confirmAction } from './dom.js';

const SETTINGS_KEY = 'letsgetfit.player';
const INTRO_SEC = 2; // getting into a hold is shown over the last two seconds before it starts
const CUE_SEC = 6;
const MAX_TICK_MS = 1000;

export function loadPlayerSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (saved) return cleanSettings(saved);
  } catch {
    /* use the defaults */
  }
  return { ...DEFAULT_SETTINGS, still: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false };
}

function savePlayerSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* not essential */
  }
}

const clock = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec));
const sideName = (demo, index) => demo.sideNames?.[index] ?? '';

/** A small looping (or still) demonstration, for the exercise library and the setup list. */
export function demoPreview(exerciseId, { still = false, size = 'small', thumbnail = false } = {}) {
  const ex = getExercise(exerciseId);
  const demo = getDemo(exerciseId);
  const stage = createStage({ label: `${ex.name}: demonstration` });
  stage.svg.classList.add(`stage--${size}`);
  stage.setDemo(demo);
  let frame = 0;
  let started = 0;
  const tick = (now) => {
    if (!stage.svg.isConnected) return; // removed from the page: stop
    started ||= now;
    stage.draw((now - started) / (demo.cycle * 1000));
    frame = requestAnimationFrame(tick);
  };
  return {
    node: stage.svg,
    start() {
      cancelAnimationFrame(frame);
      if (thumbnail) stage.draw(demo.kind === 'hold' ? 0 : demo.peak);
      else if (still) stage.drawStill();
      else {
        stage.draw(0);
        frame = requestAnimationFrame(tick);
      }
    },
    stop() {
      cancelAnimationFrame(frame);
      started = 0;
    },
  };
}

/**
 * @param {{ onLog: (result: { title: string, routineId: string|null, durationMin: number, exercises: object[] }) => void }} options
 */
export function initPlayer({ onLog }) {
  const dialog = $('#workout-player');
  let settings = loadPlayerSettings();
  let context = { title: 'Workout', routineId: null };
  let items = [];
  let run = null; // the session in progress: { session, paused, frame, last, ... }
  let wakeLock = null;

  const numberField = (id, label, value, [min, max], onChange, hint) => {
    const input = h('input', { id, class: 'input input--short', type: 'number', inputmode: 'numeric', min, max, step: 1, value });
    input.addEventListener('change', () => {
      onChange(input.value);
    });
    return h('div', { class: 'field field--inline' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  };

  /* ---------------- Setup ---------------- */

  function setupRow(item, i) {
    const ex = getExercise(item.exerciseId);
    const demo = getDemo(item.exerciseId);
    const preview = demoPreview(item.exerciseId, { thumbnail: true });
    preview.start();
    const fields = h('div', { class: 'setup-item__fields' });
    const cardio = ex.logType === 'cardio';
    const renderFields = () => {
      const each = item.perSide ? ' each side' : '';
      fields.replaceChildren(
        item.modes.length > 1
          ? h(
              'fieldset',
              { class: 'segmented segmented--small' },
              h('legend', { class: 'visually-hidden' }, `${item.name}: count by`),
              ['reps', 'time'].map((mode) => {
                const radio = h('input', { type: 'radio', name: `setup-mode-${i}`, value: mode, checked: item.mode === mode });
                radio.addEventListener('change', () => {
                  item.mode = mode;
                  renderFields();
                  fields.querySelector(`input[value="${mode}"]`)?.focus();
                });
                return h('label', {}, radio, mode === 'reps' ? ' Reps' : ' Time');
              }),
            )
          : null,
        item.mode === 'reps'
          ? numberField(`setup-reps-${i}`, `Reps${each}`, item.reps, LIMITS.reps, (v) => (item.reps = v))
          : cardio
            ? numberField(`setup-minutes-${i}`, 'Minutes', Math.max(1, Math.round(item.seconds / 60)), [1, 60], (v) => (item.seconds = Number(v) * 60))
            : numberField(`setup-seconds-${i}`, `Seconds${each}`, item.seconds, LIMITS.seconds, (v) => (item.seconds = v)),
        numberField(`setup-sets-${i}`, 'Sets', item.sets, LIMITS.sets, (v) => (item.sets = v)),
      );
    };
    renderFields();
    return h(
      'li',
      { class: 'setup-item', dataset: { exercise: item.exerciseId } },
      h('div', { class: 'setup-item__preview' }, preview.node),
      h(
        'div',
        { class: 'setup-item__body' },
        h('p', { class: 'setup-item__name' }, item.name),
        h('p', { class: 'muted small' }, demo.sides === 'alternate' ? 'Alternates sides. ' : demo.sides === 'each' ? 'One side, then the other. ' : '', ex.cues[0]),
        fields,
      ),
    );
  }

  function renderSetup() {
    const start = h('button', { type: 'button', class: 'button button--primary button--large', id: 'player-begin' }, 'Start workout');
    start.addEventListener('click', begin);
    const cancel = h('button', { type: 'button', class: 'button button--ghost', id: 'player-cancel' }, 'Cancel');
    cancel.addEventListener('click', close);
    const pace = h('select', { id: 'setup-pace', class: 'input' }, PACES.map((p) => h('option', { value: p.id, selected: settings.pace === p.id }, p.label)));
    pace.addEventListener('change', () => (settings.pace = pace.value));
    const still = h('input', { type: 'checkbox', id: 'setup-still', checked: settings.still });
    still.addEventListener('change', () => (settings.still = still.checked));
    dialog.replaceChildren(
      h(
        'div',
        { class: 'player__setup' },
        h('h2', { id: 'player-title', tabindex: '-1' }, context.title),
        h('p', { class: 'muted' }, 'Check the plan and change anything you like. The cartoon shows each movement, and counts time or repetitions with you.'),
        h('ol', { class: 'setup-list', 'aria-label': 'Exercises in this workout' }, items.map(setupRow)),
        h(
          'div',
          { class: 'setup-options' },
          numberField('setup-rest', 'Rest between sets and exercises (seconds)', settings.restSec, LIMITS.restSec, (v) => (settings.restSec = v)),
          h('div', { class: 'field' }, h('label', { for: 'setup-pace' }, 'Demo pace for repetitions'), h('p', { class: 'hint' }, 'Guided reps count the cartoon’s repetitions, so pick a pace you can follow comfortably.'), pace),
          h('div', { class: 'field' }, h('label', { class: 'checkbox' }, still, 'Show still poses instead of animation'), h('p', { class: 'hint' }, 'Shows the start and end positions without movement. Timers and counters work the same way.')),
        ),
        h('p', { class: 'muted small' }, SAFETY_NOTE),
        h('div', { class: 'form__actions player__setup-actions' }, start, cancel),
      ),
    );
  }

  /* ---------------- Player ---------------- */

  function begin() {
    items = items.map(cleanItem);
    settings = cleanSettings(settings);
    savePlayerSettings(settings);
    const segments = buildSegments(items, settings);
    const stage = createStage({ ring: true });
    const ui = {
      count: h('p', { class: 'player__count', id: 'player-count' }),
      title: h('h2', { class: 'player__title', id: 'player-title', tabindex: '-1' }),
      sub: h('p', { class: 'player__sub', id: 'player-sub' }),
      big: h('p', { class: 'player__big', id: 'player-big', 'aria-hidden': 'true' }),
      counter: h('p', { class: 'player__counter', id: 'player-counter' }),
      label: h('p', { class: 'player__label', id: 'player-label' }),
      cue: h('p', { class: 'player__cue', id: 'player-cue' }),
      live: h('p', { class: 'visually-hidden', 'aria-live': 'polite', id: 'player-live' }),
      pause: h('button', { type: 'button', class: 'player__button player__button--main', id: 'player-pause' }, 'Pause'),
      skip: h('button', { type: 'button', class: 'player__button', id: 'player-skip' }, 'Skip'),
      end: h('button', { type: 'button', class: 'player__button', id: 'player-end' }, 'End workout'),
    };
    run = { session: createSession(segments), total: exerciseCount(segments), paused: false, frame: 0, last: 0, stage, ui, drawn: null };
    ui.pause.addEventListener('click', () => setPaused(!run.paused));
    ui.skip.addEventListener('click', () => {
      skip(run.session);
      render();
    });
    ui.end.addEventListener('click', async () => {
      const wasPaused = run.paused;
      setPaused(true);
      if (await confirmAction({ title: 'End this workout?', body: 'The sets you have finished are kept, and you can save them to your log.', confirmLabel: 'End workout' })) {
        end(run.session);
        render();
      } else if (!wasPaused) setPaused(false);
    });
    dialog.replaceChildren(
      h(
        'div',
        { class: 'player__run' },
        h('header', { class: 'player__top' }, ui.count, ui.title, ui.sub),
        h('div', { class: 'player__stage' }, stage.svg, ui.big),
        h('footer', { class: 'player__bottom' }, ui.counter, ui.label, ui.cue, h('div', { class: 'player__controls' }, ui.skip, ui.pause, ui.end), ui.live),
      ),
    );
    dialog.classList.add('player--running');
    requestWakeLock();
    render();
    ui.pause.focus();
    run.last = performance.now();
    run.frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!run) return;
    if (!run.paused) {
      // A long gap means the page was not being drawn: never count it as exercise time.
      advance(run.session, Math.min(MAX_TICK_MS, now - run.last));
      render();
    }
    if (!run) return; // the workout finished during this frame
    run.last = now;
    if (run && !run.session.finished) run.frame = requestAnimationFrame(tick);
  }

  function setPaused(paused) {
    if (!run || run.session.finished) return;
    run.paused = paused;
    run.last = performance.now();
    run.ui.pause.textContent = paused ? 'Resume' : 'Pause';
    dialog.classList.toggle('player--paused', paused);
    run.ui.live.textContent = paused ? 'Paused.' : 'Resumed.';
    if (paused) releaseWakeLock();
    else requestWakeLock();
    render();
  }

  /** Point the stage at a segment's exercise; in still mode this is the only drawing needed. */
  function showDemo(seg, key) {
    const demo = getDemo(seg.exerciseId);
    if (run.drawn !== key) {
      run.drawn = key;
      run.stage.setDemo(demo, { mirrored: seg.mirrored, label: `${seg.name}: demonstration` });
      if (settings.still) run.stage.drawStill();
    }
    return demo;
  }

  function render() {
    if (!run) return;
    const s = snapshot(run.session);
    if (s.type === 'finished') {
      renderFinish();
      return;
    }
    const { ui, stage } = run;
    const segmentKey = `${run.session.index}`;
    const changed = ui.count.dataset.segment !== segmentKey;
    ui.count.dataset.segment = segmentKey;
    dialog.dataset.phase = s.type;

    if (s.type === 'work') {
      const seg = s.seg;
      const demo = showDemo(seg, segmentKey);
      if (!settings.still) stage.draw(s.phase);
      stage.setProgress(s.progress);
      const side = demo.sides === 'alternate' ? sideName(demo, sideAt(demo, s.phase)) : demo.sides === 'each' ? sideName(demo, seg.side) : '';
      const sub = [seg.sets > 1 ? `Set ${seg.set} of ${seg.sets}` : '', side].filter(Boolean).join(' · ');
      if (ui.sub.textContent !== sub) ui.sub.textContent = sub;
      const each = demo.sides !== 'none' ? ' each side' : '';
      const counter = seg.mode === 'reps' ? String(s.reps) : clock(s.remainingSec);
      if (ui.counter.textContent !== counter) ui.counter.textContent = counter;
      if (changed) {
        ui.count.textContent = `${seg.item + 1} of ${run.total}`;
        ui.title.textContent = seg.name;
        ui.big.textContent = '';
        ui.label.textContent = seg.mode === 'reps' ? `Guided reps · of ${seg.target}${each}` : `${seg.target >= 60 ? 'time' : 'seconds'} left${each}`;
        ui.skip.textContent = 'Skip';
        ui.live.textContent = `${seg.name}. ${sub}`;
      }
      const cues = getExercise(seg.exerciseId).cues;
      const cue = cues[Math.floor((run.session.elapsedMs / 1000) / CUE_SEC) % cues.length];
      if (ui.cue.textContent !== cue) ui.cue.textContent = cue;
      return;
    }

    // Countdown, switch sides, or rest: show what comes next.
    const next = s.next;
    const demo = showDemo(next, `${segmentKey}-next`);
    if (!settings.still) {
      if (demo.kind === 'hold') stage.draw(1 - Math.min(1, s.untilStartSec / INTRO_SEC), { intro: true });
      else stage.draw(s.type === 'rest' ? s.phase : 0);
    }
    stage.setProgress(s.type === 'rest' ? s.progress : 0);
    const big = s.type === 'rest' ? '' : String(s.remainingSec);
    if (ui.big.textContent !== big) ui.big.textContent = big;
    const counter = s.type === 'rest' ? clock(s.remainingSec) : '';
    if (ui.counter.textContent !== counter) ui.counter.textContent = counter;
    if (changed) {
      const nextSide = demo.sides === 'each' ? sideName(demo, next.side) : '';
      const setText = next.sets > 1 ? `Set ${next.set} of ${next.sets}` : '';
      ui.count.textContent = `${next.item + 1} of ${run.total}`;
      if (s.type === 'rest') {
        ui.title.textContent = 'Rest';
        ui.sub.textContent = `Next: ${[next.name, setText, nextSide].filter(Boolean).join(' · ')}`;
        ui.label.textContent = 'rest';
        ui.skip.textContent = 'Skip rest';
      } else if (s.type === 'switch') {
        ui.title.textContent = 'Switch sides';
        ui.sub.textContent = [next.name, nextSide].filter(Boolean).join(' · ');
        ui.label.textContent = '';
        ui.skip.textContent = 'Skip';
      } else {
        ui.title.textContent = next.name;
        ui.sub.textContent = ['Get ready', setText, nextSide].filter(Boolean).join(' · ');
        ui.label.textContent = '';
        ui.skip.textContent = 'Skip';
      }
      ui.cue.textContent = getExercise(next.exerciseId).cues[0];
      ui.live.textContent = `${ui.title.textContent}. ${ui.sub.textContent}`;
    }
  }

  /* ---------------- Finish ---------------- */

  function renderFinish() {
    const { session } = run;
    cancelAnimationFrame(run.frame);
    releaseWakeLock();
    const summary = summarise(session, items);
    const minutes = sessionMinutes(session);
    const result = { title: context.title, routineId: context.routineId, durationMin: minutes, exercises: toDraftExercises(summary) };
    run = null;
    dialog.classList.remove('player--running', 'player--paused');
    delete dialog.dataset.phase;
    const save = h('button', { type: 'button', class: 'button button--primary button--large', id: 'player-save' }, 'Save to workout log');
    save.addEventListener('click', () => {
      close();
      onLog(result);
    });
    const done = h('button', { type: 'button', class: 'button button--ghost', id: 'player-close' }, summary.length ? 'Close without saving' : 'Close');
    done.addEventListener('click', close);
    const setText = (item, set) => (set.reps !== undefined ? `${formatNumber(set.reps)} ${set.reps === 1 ? 'rep' : 'reps'}` : set.seconds >= 60 ? `${clock(set.seconds)} min` : `${formatNumber(set.seconds)} s`) + (item.perSide ? ' each side' : '');
    dialog.replaceChildren(
      h(
        'div',
        { class: 'player__setup player__finish' },
        h('h2', { id: 'player-title', tabindex: '-1' }, summary.length ? 'Workout complete' : 'Workout ended'),
        summary.length
          ? h('p', {}, `${context.title}: about ${formatNumber(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}, ${formatNumber(summary.reduce((n, x) => n + x.sets.length, 0))} sets across ${formatNumber(summary.length)} ${summary.length === 1 ? 'exercise' : 'exercises'}.`)
          : h('p', {}, 'No sets were finished, so there is nothing to save.'),
        summary.length
          ? h('ul', { class: 'finish-list', id: 'player-summary' }, summary.map((item) => h('li', {}, h('strong', {}, item.name), h('span', { class: 'muted' }, ` ${item.sets.map((set) => setText(item, set)).join(', ')}`))))
          : null,
        summary.length ? h('p', { class: 'muted small' }, 'Saving opens the session log with these sets filled in, so you can add weights and how hard it felt before you save.') : null,
        h('div', { class: 'form__actions player__setup-actions' }, summary.length ? save : null, done),
      ),
    );
    $('#player-title', dialog).focus();
  }

  /* ---------------- Opening, closing, background ---------------- */

  async function requestWakeLock() {
    try {
      wakeLock ??= (await navigator.wakeLock?.request('screen')) ?? null;
      wakeLock?.addEventListener?.('release', () => {
        wakeLock = null;
      });
    } catch {
      wakeLock = null; // not supported or not allowed: the workout still runs
    }
  }

  function releaseWakeLock() {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  }

  function close() {
    if (run) cancelAnimationFrame(run.frame);
    run = null;
    releaseWakeLock();
    dialog.classList.remove('player--running', 'player--paused');
    delete dialog.dataset.phase;
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
  }

  // Escape: leave the setup, but only pause a running workout.
  dialog.addEventListener('cancel', (event) => {
    if (run) {
      event.preventDefault();
      setPaused(true);
    }
  });
  dialog.addEventListener('close', () => {
    if (run) close();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && run && !run.paused) setPaused(true);
  });
  window.addEventListener('pagehide', () => {
    if (run && !run.paused) setPaused(true);
  });

  return {
    /**
     * Open the setup screen.
     * @param {Array<{ exerciseId: string, sets?: number, target?: string }>} plan
     * @param {{ title: string, routineId?: string|null }} about
     */
    open(plan, about) {
      items = plan.map((p) => planItem(p.exerciseId, p)).filter(Boolean);
      if (!items.length) return;
      settings = loadPlayerSettings();
      context = { title: about.title, routineId: about.routineId ?? null };
      renderSetup();
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
      $('#player-title', dialog).focus();
    },
    get active() {
      return dialog.open;
    },
  };
}
