// Workouts view: this week's summary, starter routines, the session logger and the exercise library.

import { EXERCISES, ROUTINES, EQUIPMENT, DIFFICULTY, CATEGORIES, getExercise, getRoutine, filterExercises, SAFETY_NOTE, ACTIVITY_GUIDELINE } from '../lib/exercises.js';
import { newSession, sessionExercise, swapExercise, validateSession, withSessionEstimate, sessionToDraft, weeklySummaries, EFFORT_SCALE } from '../lib/training.js';
import { toLocalDateString } from '../lib/dates.js';
import { $, h, formatNumber, toast, confirmAction } from './dom.js';
import { currentWeightKg } from './logs.js';
import { weekLabel } from './progress.js';

const LOCATION = { home: 'Home', gym: 'Gym' };

function badge(text) {
  return h('span', { class: 'badge' }, text);
}

export function initTraining(store) {
  const panel = $('#session-panel');
  const routinesHost = $('#routine-list');
  const resumeHost = $('#session-resume');
  let draft = null; // { ...session draft, editingId? }
  let saveTimer = null;

  /* ---------------- This week ---------------- */

  function renderWeek() {
    const [w] = weeklySummaries(store.workouts, { weeks: 1 });
    const host = $('#week-summary');
    host.replaceChildren(
      h('h2', {}, `This week · ${weekLabel(w)}`),
      h(
        'dl',
        { class: 'week-stats' },
        h('div', {}, h('dt', {}, 'Workouts'), h('dd', { id: 'week-workouts' }, String(w.workouts))),
        h('div', {}, h('dt', {}, 'Active minutes'), h('dd', { id: 'week-minutes' }, formatNumber(w.minutes))),
        h('div', {}, h('dt', {}, 'Strength days'), h('dd', { id: 'week-strength' }, String(w.strengthDays))),
      ),
      h('details', { class: 'disclosure' },
        h('summary', {}, 'About these totals'),
        h('p', { class: 'muted small' }, `The WHO guideline for adults is at least ${ACTIVITY_GUIDELINE.moderateMinutes} minutes of moderate activity a week and muscle strengthening on ${ACTIVITY_GUIDELINE.strengthDays} or more days. Active minutes here include all logged activity.`),
        h('p', { class: 'muted small' }, 'Your maintenance estimate already includes your usual activity level. Logged workouts are tracked separately.'),
      ),
    );
  }

  /* ---------------- Routines ---------------- */

  function renderRoutines() {
    routinesHost.replaceChildren(
      ...ROUTINES.map((r) => {
        const start = h('button', { type: 'button', class: 'button button--small button--primary', dataset: { startRoutine: r.id }, 'aria-label': `Start ${r.name}` }, 'Start');
        start.addEventListener('click', () => startSession(getRoutine(r.id)));
        return h(
          'li',
          { class: 'routine' },
          h('div', { class: 'routine__body' }, h('p', { class: 'entry__title' }, r.name), h('span', { class: 'badges' }, badge(LOCATION[r.location]), badge(DIFFICULTY[r.difficulty]), badge(`About ${r.minutes} min`)), h('p', { class: 'small' }, r.description), h('p', { class: 'muted small' }, `Equipment: ${r.equipmentSummary}. ${r.exercises.map((i) => getExercise(i.exerciseId).name).join(', ')}.`)),
          start,
        );
      }),
    );
  }

  function renderResume() {
    const existing = store.draftSession;
    if (!existing || draft) {
      resumeHost.replaceChildren();
      return;
    }
    const resume = h('button', { type: 'button', class: 'button button--small button--primary', id: 'resume-session' }, 'Resume');
    resume.addEventListener('click', () => openPanel(existing));
    const discard = h('button', { type: 'button', class: 'button button--small button--danger-ghost' }, 'Discard');
    discard.addEventListener('click', discardDraft);
    resumeHost.replaceChildren(h('div', { class: 'notice-inline', role: 'status' }, h('p', {}, `You have an unsaved session: ${existing.title}.`), h('div', { class: 'form__actions' }, resume, discard)));
  }

  async function startSession(routine) {
    if (draft || store.draftSession) {
      const ok = await confirmAction({ title: 'Replace the unsaved session?', body: 'You have a session in progress. Starting a new one discards it.', confirmLabel: 'Start new' });
      if (!ok) return;
    }
    openPanel(newSession(routine, toLocalDateString()));
  }

  /* ---------------- Session panel ---------------- */

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        store.saveDraftSession(draft);
      } catch {
        /* storage full: the session is still on screen */
      }
    }, 250);
  }

  function openPanel(d) {
    draft = structuredClone(d);
    try {
      store.saveDraftSession(draft);
    } catch {
      /* ignore */
    }
    renderResume();
    renderPanel();
    panel.hidden = false;
    panel.scrollIntoView({ block: 'start' });
    $('#session-title-heading').focus();
    $('#library').classList.add('library--adding');
  }

  function closePanel() {
    clearTimeout(saveTimer);
    draft = null;
    store.saveDraftSession(null);
    panel.hidden = true;
    panel.replaceChildren();
    $('#library').classList.remove('library--adding');
    renderResume();
  }

  async function discardDraft() {
    const ok = await confirmAction({ title: 'Discard this session?', body: 'Sets you have entered for this session will be lost.', confirmLabel: 'Discard' });
    if (!ok) return;
    closePanel();
    toast('Session discarded.');
    $('#workouts-title').focus();
  }

  function field(id, label, input, hint) {
    return h('div', { class: 'field', dataset: { field: id } }, h('label', { for: `session-${id}` }, label), hint ? h('p', { class: 'hint' }, hint) : null, input, h('p', { class: 'field-error', id: `session-${id}-error`, hidden: true }));
  }

  function bind(input, apply) {
    input.addEventListener('input', () => {
      apply(input.type === 'checkbox' ? input.checked : input.value);
      persist();
    });
    input.addEventListener('change', () => {
      apply(input.type === 'checkbox' ? input.checked : input.value);
      persist();
    });
    return input;
  }

  function setRow(item, ei, set, si, ex) {
    const loadUnit = store.units === 'imperial' ? 'lb' : 'kg';
    const cells = [];
    const label = `${ex.name}, set ${si + 1}`;
    if (ex.logType === 'reps' || ex.logType === 'load') {
      cells.push(
        h('label', { class: 'visually-hidden', for: `set-${ei}-${si}-reps` }, `${label}: repetitions`),
        bind(h('input', { id: `set-${ei}-${si}-reps`, class: 'input input--set', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: set.reps ?? '', placeholder: 'reps' }), (v) => (set.reps = v)),
      );
      if (ex.logType === 'load') {
        cells.push(
          h('span', { class: 'set-times', 'aria-hidden': 'true' }, '×'),
          h('label', { class: 'visually-hidden', for: `set-${ei}-${si}-load` }, `${label}: load in ${loadUnit === 'kg' ? 'kilograms' : 'pounds'}`),
          bind(h('input', { id: `set-${ei}-${si}-load`, class: 'input input--set', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: set.load ?? '', placeholder: loadUnit }), (v) => (set.load = v)),
          h('span', { class: 'unit', 'aria-hidden': 'true' }, loadUnit),
        );
      } else cells.push(h('span', { class: 'unit', 'aria-hidden': 'true' }, 'reps'));
    } else {
      const unit = ex.logType === 'time' ? 'seconds' : 'minutes';
      cells.push(
        h('label', { class: 'visually-hidden', for: `set-${ei}-${si}-amount` }, `${label}: ${unit}`),
        bind(h('input', { id: `set-${ei}-${si}-amount`, class: 'input input--set', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: set.amount ?? '', placeholder: ex.logType === 'time' ? 'sec' : 'min' }), (v) => (set.amount = v)),
        h('span', { class: 'unit', 'aria-hidden': 'true' }, unit === 'seconds' ? 'sec' : 'min'),
      );
    }
    const remove = h('button', { type: 'button', class: 'button button--small button--ghost set-remove', 'aria-label': `Remove ${label}`, title: 'Remove set' }, '×');
    remove.addEventListener('click', () => {
      item.sets.splice(si, 1);
      if (item.sets.length === 0) item.sets.push({ reps: '', load: '', amount: '' });
      persist();
      renderPanel();
      document.getElementById(`add-set-${ei}`)?.focus();
    });
    return h('li', { class: 'set-row', dataset: { set: si } }, h('span', { class: 'set-number', 'aria-hidden': 'true' }, `${si + 1}`), ...cells, remove);
  }

  function exerciseCard(item, ei) {
    const ex = getExercise(item.exerciseId);
    const swap = h(
      'select',
      { class: 'input input--swap', id: `swap-${ei}`, 'aria-label': `Swap ${ex.name} for another exercise` },
      h('option', { value: '' }, 'Swap for…'),
      ex.substitutions.map((id) => h('option', { value: id }, getExercise(id).name)),
    );
    swap.addEventListener('change', () => {
      if (!swap.value) return;
      draft.exercises[ei] = swapExercise(item, swap.value);
      persist();
      renderPanel();
      toast(`Swapped for ${getExercise(swap.value).name}.`, 'info');
      document.getElementById(`swap-${ei}`)?.focus();
    });
    const addSet = h('button', { type: 'button', class: 'button button--small', id: `add-set-${ei}` }, 'Add set');
    addSet.addEventListener('click', () => {
      const last = item.sets[item.sets.length - 1] ?? {};
      item.sets.push({ reps: '', load: last.load ?? '', amount: '' });
      persist();
      renderPanel();
      document.getElementById(`set-${ei}-${item.sets.length - 1}-${ex.logType === 'reps' || ex.logType === 'load' ? 'reps' : 'amount'}`)?.focus();
    });
    const remove = h('button', { type: 'button', class: 'button button--small button--danger-ghost', 'aria-label': `Remove ${ex.name} from this session` }, 'Remove exercise');
    remove.addEventListener('click', () => {
      draft.exercises.splice(ei, 1);
      persist();
      renderPanel();
      $('#add-exercise-select')?.focus();
    });
    return h(
      'li',
      { class: 'session-exercise', dataset: { exercise: item.exerciseId } },
      h('div', { class: 'session-exercise__head' }, h('h3', {}, ex.name), item.target ? h('span', { class: 'muted small' }, `Target: ${item.target}`) : null),
      h('details', { class: 'disclosure disclosure--compact' }, h('summary', {}, 'How to do it'), h('ul', { class: 'bullets small' }, ex.cues.map((c) => h('li', {}, c)))),
      h('ol', { class: 'set-list', 'aria-label': `${ex.name} sets` }, item.sets.map((set, si) => setRow(item, ei, set, si, ex))),
      h('div', { class: 'form__actions form__actions--tight' }, addSet, swap, remove),
    );
  }

  function renderPanel() {
    if (!draft) return;
    const summary = h('div', { class: 'error-summary', id: 'session-errors', role: 'alert', tabindex: '-1', hidden: true }, h('h3', {}, 'Please check the following'), h('ul'));
    const addSelect = h(
      'select',
      { class: 'input', id: 'add-exercise-select', 'aria-label': 'Exercise to add' },
      h('option', { value: '' }, 'Choose an exercise…'),
      Object.entries(CATEGORIES).map(([cat, label]) => h('optgroup', { label }, EXERCISES.filter((e) => e.category === cat).map((e) => h('option', { value: e.id }, e.name)))),
    );
    const addButton = h('button', { type: 'button', class: 'button button--small' }, 'Add exercise');
    addButton.addEventListener('click', () => {
      if (!addSelect.value) {
        addSelect.focus();
        return;
      }
      addExercise(addSelect.value);
    });
    const save = h('button', { type: 'submit', class: 'button button--primary', id: 'session-save' }, draft.editingId ? 'Save changes' : 'Save session');
    const discard = h('button', { type: 'button', class: 'button button--danger-ghost' }, draft.editingId ? 'Cancel editing' : 'Discard');
    discard.addEventListener('click', draft.editingId ? () => {
      closePanel();
      $('#workouts-title').focus();
    } : discardDraft);

    const form = h(
      'form',
      { class: 'form', id: 'session-form', novalidate: true },
      summary,
      h('div', { class: 'grid-2' }, field('title', 'Session name', bind(h('input', { id: 'session-title', class: 'input', type: 'text', maxlength: '80', value: draft.title }), (v) => (draft.title = v))), field('date', 'Date', bind(h('input', { id: 'session-date', class: 'input', type: 'date', value: draft.localDate, max: toLocalDateString() }), (v) => (draft.localDate = v)))),
      draft.exercises.length
        ? h('ol', { class: 'session-exercises', 'aria-label': 'Exercises in this session' }, draft.exercises.map(exerciseCard))
        : h('p', { class: 'muted' }, 'No exercises yet. Add one below, or from the exercise library.'),
      h('div', { class: 'add-exercise' }, addSelect, addButton),
      h(
        'div',
        { class: 'grid-2' },
        field('duration', 'Duration (minutes)', bind(h('input', { id: 'session-duration', class: 'input input--short', type: 'text', inputmode: 'numeric', value: draft.durationMin }), (v) => (draft.durationMin = v))),
        field(
          'rpe',
          'How hard was it overall? (optional)',
          bind(h('select', { id: 'session-rpe', class: 'input' }, h('option', { value: '' }, 'Not recorded'), EFFORT_SCALE.map((e) => h('option', { value: String(e.value), selected: String(e.value) === String(draft.sessionRpe) }, e.label))), (v) => (draft.sessionRpe = v)),
          'Rate the whole session from 1 (very, very easy) to 10 (maximal).',
        ),
      ),
      field('notes', 'Notes (optional)', bind(h('input', { id: 'session-notes', class: 'input', type: 'text', maxlength: '300', value: draft.notes }), (v) => (draft.notes = v))),
      h('div', { class: 'field' }, h('label', { class: 'checkbox' }, bind(h('input', { type: 'checkbox', id: 'session-estimate', checked: Boolean(draft.showEstimate) }), (v) => (draft.showEstimate = v)), 'Show estimated active calories'), h('p', { class: 'hint' }, 'A rough average for resistance training (3.5 MET). The Dashboard can include this in today’s budget if it was extra exercise.')),
      h('div', { class: 'form__actions' }, save, discard),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveSession(form, summary);
    });
    panel.replaceChildren(h('h2', { id: 'session-title-heading', tabindex: '-1' }, draft.editingId ? 'Edit session' : 'Session in progress'), h('p', { class: 'muted small' }, SAFETY_NOTE), form);
  }

  function addExercise(id) {
    if (!draft) return;
    draft.exercises.push(sessionExercise(id, 3, ''));
    persist();
    renderPanel();
    toast(`${getExercise(id).name} added to the session.`, 'info');
    document.querySelector(`.session-exercise:last-child [id^="set-"]`)?.focus();
  }

  function saveSession(form, summary) {
    const result = validateSession(draft, store.units);
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    for (const el of form.querySelectorAll('.field-error')) {
      el.hidden = true;
      el.textContent = '';
    }
    if (!result.ok) {
      const items = [];
      const fieldMap = { localDate: 'date', durationMin: 'duration', sessionRpe: 'rpe' };
      for (const [key, id] of Object.entries(fieldMap)) {
        if (!result.errors[key]) continue;
        const input = document.getElementById(`session-${id}`);
        input?.setAttribute('aria-invalid', 'true');
        const err = document.getElementById(`session-${id}-error`);
        if (err) {
          err.textContent = result.errors[key];
          err.hidden = false;
        }
        items.push([input, result.errors[key]]);
      }
      for (const e of result.errors.sets ?? []) {
        const input = document.getElementById(`set-${e.ei}-${e.si}-${e.field}`);
        input?.setAttribute('aria-invalid', 'true');
        items.push([input, e.message]);
      }
      if (result.errors.exercises) items.push([document.getElementById('add-exercise-select'), result.errors.exercises]);
      $('ul', summary).replaceChildren(
        ...items.map(([input, message]) => {
          const a = h('a', { href: input?.id ? `#${input.id}` : '#' }, message);
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            input?.focus();
          });
          return h('li', {}, a);
        }),
      );
      summary.hidden = false;
      summary.focus();
      return;
    }
    const record = withSessionEstimate(result.value, currentWeightKg(store));
    try {
      if (draft.editingId) store.updateWorkout(draft.editingId, record);
      else store.addWorkout(record);
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    const editing = Boolean(draft.editingId);
    closePanel();
    toast(editing ? 'Session updated.' : `Session saved: ${record.title}.`);
    $('#workouts-title').focus();
  }

  /* ---------------- Library ---------------- */

  function renderLibrary() {
    const host = $('#library-results');
    const text = $('#library-search').value;
    const equipment = $('#library-equipment').value;
    const category = $('#library-category').value;
    const list = filterExercises({ text, equipment, category });
    $('#library-count').textContent = `${list.length} ${list.length === 1 ? 'exercise' : 'exercises'}`;
    host.replaceChildren(
      list.length
        ? h(
            'ul',
            { class: 'library-list' },
            list.map((e) => {
              const add = h('button', { type: 'button', class: 'button button--small library-add', 'aria-label': `Add ${e.name} to the session` }, 'Add to session');
              add.addEventListener('click', () => {
                addExercise(e.id);
                panel.scrollIntoView({ block: 'start' });
              });
              return h(
                'li',
                { dataset: { exercise: e.id } },
                h(
                  'details',
                  { class: 'exercise' },
                  h('summary', {}, h('span', { class: 'exercise__name' }, e.name), h('span', { class: 'badges' }, badge(CATEGORIES[e.category]), badge(DIFFICULTY[e.difficulty]), badge(e.equipment.map((k) => EQUIPMENT[k]).join(' or ')))),
                  h('p', { class: 'small' }, h('strong', {}, 'Works: '), e.muscles),
                  h('p', { class: 'small' }, h('strong', {}, 'How to do it')),
                  h('ol', { class: 'bullets small' }, e.cues.map((c) => h('li', {}, c))),
                  h('p', { class: 'small' }, h('strong', {}, 'Swap for: '), e.substitutions.map((id) => getExercise(id).name).join(', ')),
                  add,
                ),
              );
            }),
          )
        : h('p', { class: 'muted' }, 'No exercises match. Try another filter.'),
    );
  }

  for (const id of ['library-search', 'library-equipment', 'library-category']) $(`#${id}`).addEventListener('input', renderLibrary);
  $('#start-empty-session').addEventListener('click', () => startSession(null));

  function render() {
    renderWeek();
    renderResume();
  }

  store.subscribe(render);
  renderRoutines();
  renderLibrary();
  render();

  return {
    /** Open a saved session for editing. */
    editSession(entry) {
      if (draft) {
        toast('Save or discard the session in progress first.', 'error');
        panel.scrollIntoView({ block: 'start' });
        return;
      }
      openPanel({ ...sessionToDraft(entry, store.units), editingId: entry.id });
    },
  };
}
