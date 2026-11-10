// Workout log and weight log views. Both follow the same pattern: one form for add and edit,
// a list with edit and delete controls, and an empty state.

import { ACTIVITIES, getActivity, estimateActiveKcal, roundActiveKcal } from '../lib/activities.js';
import { validateWorkout, validateWeightEntry } from '../lib/validate.js';
import { toLocalDateString, formatLocalDate } from '../lib/dates.js';
import { kgToStonePounds, roundTo, KG_PER_POUND } from '../lib/units.js';
import { sessionStats, activityLabel } from '../lib/training.js';
import { $, h, formatNumber, formatWeight, applyUnitsVisibility, showFormErrors, clearFormErrors, toast, confirmAction, emptyState, readForm } from './dom.js';

/** The weight to use for MET estimates: the calculator weight, else the latest log entry. */
export function currentWeightKg(store) {
  return store.profile?.weightKg ?? store.weights[0]?.weightKg ?? null;
}

function setDateLimits(input) {
  const today = toLocalDateString();
  input.max = today;
  if (!input.value) input.value = today;
}

function entryActions(label, onEdit, onDelete) {
  return h(
    'div',
    { class: 'entry__actions' },
    h('button', { type: 'button', class: 'button button--small', onclick: onEdit, 'aria-label': `Edit ${label}` }, 'Edit'),
    h('button', { type: 'button', class: 'button button--small button--danger-ghost', onclick: onDelete, 'aria-label': `Delete ${label}` }, 'Delete'),
  );
}

/* ---------------- Workouts ---------------- */

export function initWorkouts(store, { onEditSession } = {}) {
  const form = $('#workout-form');
  const summary = $('#workout-errors');
  const list = $('#workout-list');
  const submit = $('#workout-submit');
  const cancel = $('#workout-cancel');
  const title = $('#workout-form-title');
  let editingId = null;

  form.elements.activityId.replaceChildren(
    h('option', { value: '' }, 'Choose an activity'),
    ...ACTIVITIES.map((a) => h('option', { value: a.id }, a.label)),
  );
  setDateLimits(form.elements.localDate);

  const labels = { localDate: 'Date', activityId: 'Activity type', durationMin: 'Duration' };

  function resetForm() {
    editingId = null;
    form.reset();
    form.elements.localDate.value = '';
    setDateLimits(form.elements.localDate);
    clearFormErrors(form, summary);
    title.textContent = 'Add a workout';
    submit.textContent = 'Add workout';
    cancel.hidden = true;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = validateWorkout(readForm(form));
    if (!result.ok) {
      showFormErrors(form, result.errors, {
        summary,
        labels,
        errorId: (f) => `workout-${f}-error`,
        focusTarget: (f) => form.querySelector(`[data-field="${f}"] input, [data-field="${f}"] select`),
      });
      return;
    }
    const activity = getActivity(result.value.activityId);
    const weightKg = currentWeightKg(store);
    const kcal = result.value.showEstimate
      ? roundActiveKcal(estimateActiveKcal({ met: activity.met, weightKg, durationMin: result.value.durationMin }))
      : null;
    // Snapshot the inputs so the entry stays the same if the MET table or weight changes later.
    const record = {
      type: 'activity',
      localDate: result.value.localDate,
      activityId: activity.id,
      activityLabel: activity.label,
      durationMin: result.value.durationMin,
      notes: result.value.notes,
      showEstimate: result.value.showEstimate,
      metUsed: activity.met,
      weightKgUsed: result.value.showEstimate ? weightKg : null,
      estimatedActiveKcal: kcal,
    };
    try {
      if (editingId) store.updateWorkout(editingId, record);
      else store.addWorkout(record);
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    const wasEditing = Boolean(editingId);
    resetForm();
    toast(wasEditing ? 'Workout updated.' : 'Workout added.');
    if (result.value.showEstimate && kcal === null) {
      toast(activity.met === null ? 'Workout saved. There is no estimate for “Other activity”.' : 'Workout saved. Add your weight on the Overview or Progress page to see an estimate.', 'info');
    }
  });

  cancel.addEventListener('click', () => {
    resetForm();
    title.focus?.();
    form.elements.localDate.focus();
  });

  function edit(entry) {
    editingId = entry.id;
    clearFormErrors(form, summary);
    form.elements.localDate.value = entry.localDate;
    form.elements.activityId.value = entry.activityId;
    form.elements.durationMin.value = entry.durationMin;
    form.elements.notes.value = entry.notes ?? '';
    form.elements.showEstimate.checked = Boolean(entry.showEstimate);
    title.textContent = 'Edit workout';
    submit.textContent = 'Save changes';
    cancel.hidden = false;
    form.scrollIntoView({ block: 'start' });
    form.elements.localDate.focus();
  }

  async function remove(entry) {
    const ok = await confirmAction({
      title: 'Delete this workout?',
      body: `${activityLabel(entry)} on ${formatLocalDate(entry.localDate)} will be removed from this device.`,
    });
    if (!ok) return;
    try {
      store.deleteWorkout(entry.id);
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    if (editingId === entry.id) resetForm();
    toast('Workout deleted.');
    $('#workouts-title').focus();
  }

  function render() {
    const entries = store.workouts;
    if (entries.length === 0) {
      list.replaceChildren(emptyState('No workouts yet', 'Start a routine or log an activity above. Walks, classes and gym sessions all count.'));
      return;
    }
    list.replaceChildren(
      h(
        'ul',
        { class: 'entries', 'aria-label': 'Workout history' },
        entries.map((entry) => {
          const label = activityLabel(entry);
          const when = formatLocalDate(entry.localDate);
          let estimate = null;
          if (entry.showEstimate) {
            estimate =
              entry.estimatedActiveKcal === null || entry.estimatedActiveKcal === undefined
                ? h('p', { class: 'entry__meta muted' }, 'No estimate available')
                : h('p', { class: 'entry__meta' }, `About ${formatNumber(entry.estimatedActiveKcal)} kcal active energy (estimate, not added automatically)`);
          }
          const isSession = entry.type === 'session';
          const stats = isSession ? sessionStats(entry) : null;
          const meta = [when, `${entry.durationMin} min`];
          if (isSession) {
            meta.push(`${stats.sets} ${stats.sets === 1 ? 'set' : 'sets'}`);
            if (stats.volumeKg > 0) meta.push(`${formatNumber(Math.round(store.units === 'imperial' ? stats.volumeKg / KG_PER_POUND : stats.volumeKg))} ${store.units === 'imperial' ? 'lb' : 'kg'} lifted`);
            if (entry.sessionRpe) meta.push(`effort ${entry.sessionRpe}/10`);
          }
          return h(
            'li',
            { class: `entry${isSession ? ' entry--session' : ''}`, dataset: { id: entry.id, type: entry.type ?? 'activity' } },
            h(
              'div',
              { class: 'entry__body' },
              h('p', { class: 'entry__title' }, label),
              h('p', { class: 'entry__meta' }, meta.join(' · ')),
              estimate,
              entry.notes ? h('p', { class: 'entry__notes' }, entry.notes) : null,
              isSession ? sessionDetails(entry, store.units) : null,
            ),
            entryActions(`${label}, ${when}`, () => (isSession ? onEditSession?.(entry) : edit(entry)), () => remove(entry)),
          );
        }),
      ),
    );
  }

  store.subscribe(render);
  render();
  async function openQuickAdd() {
    if (editingId) {
      const discard = await confirmAction({
        title: 'Leave workout editing?',
        body: 'Unsaved changes to this workout will be discarded.',
        confirmLabel: 'Start new activity',
      });
      if (!discard) {
        form.elements.activityId.focus();
        return;
      }
      resetForm();
    }
    setDateLimits(form.elements.localDate);
    form.elements.localDate.value = toLocalDateString();
    form.scrollIntoView({ block: 'start' });
    form.elements.activityId.focus({ preventScroll: true });
  }

  return { render, resetForm, openQuickAdd };
}

/* ---------------- Weight log ---------------- */

export function initWeights(store) {
  const form = $('#weight-form');
  const summary = $('#weight-errors');
  const list = $('#weight-list');
  const submit = $('#weight-submit');
  const cancel = $('#weight-cancel');
  const title = $('#weight-form-title');
  const syncField = $('#weight-sync-field');
  let editingId = null;
  const labels = { localDate: 'Date', weight: 'Weight' };

  setDateLimits(form.elements.localDate);

  function applyUnits() {
    applyUnitsVisibility(form, store.units);
    syncField.hidden = !store.profile;
  }

  function resetForm() {
    editingId = null;
    form.reset();
    form.elements.localDate.value = '';
    setDateLimits(form.elements.localDate);
    clearFormErrors(form, summary);
    title.textContent = 'Log your weight';
    submit.textContent = 'Add entry';
    cancel.hidden = true;
    applyUnits();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = readForm(form);
    const result = validateWeightEntry(raw, store.units);
    if (!result.ok) {
      showFormErrors(form, result.errors, {
        summary,
        labels,
        errorId: (f) => `weight-${f}-error`,
        focusTarget: (f) => [...form.querySelectorAll(`[data-field="${f}"] input`)].find((el) => el.offsetParent !== null),
      });
      return;
    }
    const wasEditing = Boolean(editingId);
    try {
      if (editingId) store.updateWeight(editingId, result.value);
      else store.addWeight(result.value);
      // Only update the calculator from the most recent entry, so back-filling old dates
      // does not overwrite a newer current weight.
      const latest = store.weights[0];
      if (store.profile && raw.updateProfile && latest && latest.localDate <= result.value.localDate) {
        store.saveProfile({ ...stripMeta(store.profile), weightKg: result.value.weightKg });
      }
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    resetForm();
    toast(wasEditing ? 'Weight entry updated.' : 'Weight entry added.');
  });

  cancel.addEventListener('click', () => {
    resetForm();
    form.elements.localDate.focus();
  });

  function edit(entry) {
    editingId = entry.id;
    clearFormErrors(form, summary);
    applyUnits();
    form.elements.localDate.value = entry.localDate;
    form.elements.weightKg.value = roundTo(entry.weightKg, 1);
    const { stone, pounds } = kgToStonePounds(entry.weightKg);
    form.elements.weightSt.value = stone;
    form.elements.weightLb.value = pounds;
    form.elements.notes.value = entry.notes ?? '';
    form.elements.updateProfile.checked = false;
    title.textContent = 'Edit weight entry';
    submit.textContent = 'Save changes';
    cancel.hidden = false;
    form.scrollIntoView({ block: 'start' });
    form.elements.localDate.focus();
  }

  async function remove(entry) {
    const ok = await confirmAction({
      title: 'Delete this weight entry?',
      body: `The entry for ${formatLocalDate(entry.localDate)} will be removed from this device.`,
    });
    if (!ok) return;
    try {
      store.deleteWeight(entry.id);
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    if (editingId === entry.id) resetForm();
    toast('Weight entry deleted.');
    $('#progress-title').focus();
  }

  function render() {
    if (!editingId) applyUnits();
    const entries = store.weights;
    if (entries.length === 0) {
      list.replaceChildren(emptyState('No weight entries yet', 'Weighing at a similar time of day, for example in the morning, makes entries easier to compare.'));
      return;
    }
    list.replaceChildren(
      h(
        'ul',
        { class: 'entries', 'aria-label': 'Weight log' },
        entries.map((entry) => {
          const when = formatLocalDate(entry.localDate);
          return h(
            'li',
            { class: 'entry', dataset: { id: entry.id } },
            h(
              'div',
              { class: 'entry__body' },
              h('p', { class: 'entry__title' }, formatWeight(entry.weightKg, store.units)),
              h('p', { class: 'entry__meta' }, when),
              entry.notes ? h('p', { class: 'entry__notes' }, entry.notes) : null,
            ),
            entryActions(`weight entry, ${when}`, () => edit(entry), () => remove(entry)),
          );
        }),
      ),
    );
  }

  store.subscribe(render);
  render();
  return { render, resetForm };
}

function stripMeta(profile) {
  const { id, createdAt, updatedAt, ...rest } = profile;
  return rest;
}

function sessionDetails(entry, units) {
  const loadText = (kg) => (units === 'imperial' ? `${formatNumber(roundTo(kg / KG_PER_POUND, 1), 1)} lb` : `${formatNumber(roundTo(kg, 2), 2)} kg`);
  const setText = (ex, s) => {
    if (ex.logType === 'cardio') return `${formatNumber(roundTo(s.durationSec / 60, 1), 1)} min`;
    if (ex.logType === 'time') return `${s.durationSec} s`;
    return Number.isFinite(s.loadKg) ? `${s.reps} × ${loadText(s.loadKg)}` : `${s.reps}`;
  };
  return h(
    'details',
    { class: 'disclosure disclosure--compact' },
    h('summary', {}, 'Exercises and sets'),
    h('ul', { class: 'bullets small' }, entry.exercises.map((ex) => h('li', {}, h('strong', {}, ex.name), `: ${ex.sets.map((s) => setText(ex, s)).join(', ')}`))),
  );
}
