// Goal card on the Overview: healthy weight range, goal form, and the daily plan.

import { healthyWeightRange, validateGoal, planGoal, allowedLossRates, GAIN_RATES, HEALTHY_BMI } from '../lib/goals.js';
import { readWeightKg } from '../lib/validate.js';
import { kgToStonePounds, roundTo, KG_PER_POUND } from '../lib/units.js';
import { formatLocalDate } from '../lib/dates.js';
import { h, formatNumber, formatKcal, formatWeight, toast } from './dom.js';

const TYPES = [
  ['maintain', 'Maintain my weight'],
  ['lose', 'Lose weight'],
  ['gain', 'Gain weight'],
];

function rateLabel(kg, units) {
  return units === 'imperial' ? `${formatNumber(roundTo(kg / KG_PER_POUND, 1), 1)} lb a week` : `${formatNumber(kg, 2)} kg a week`;
}

function stripMeta(profile) {
  const { id, createdAt, updatedAt, ...rest } = profile;
  void id;
  void createdAt;
  void updatedAt;
  return rest;
}

export function goalCard(store, profile, units) {
  const range = healthyWeightRange(profile.heightCm);
  const goal = profile.goal ?? { type: 'maintain', targetKg: null, ratePerWeekKg: 0 };
  let type = goal.type;

  const form = h('form', { class: 'form', id: 'goal-form', novalidate: true });
  const status = h('p', { class: 'form-status', role: 'status', tabindex: '-1' });
  const typeChoices = h(
    'fieldset',
    { class: 'field' },
    h('legend', {}, 'Your goal'),
    h(
      'div',
      { class: 'segmented' },
      TYPES.map(([id, label]) =>
        h('label', {}, h('input', { type: 'radio', name: 'goalType', value: id, checked: id === type }), ` ${label}`),
      ),
    ),
  );
  const targetFields = h('div', { id: 'goal-target-fields' });
  const errorTarget = h('p', { class: 'field-error', id: 'goal-target-error', hidden: true });
  const errorRate = h('p', { class: 'field-error', id: 'goal-rate-error', hidden: true });

  function renderTargetFields() {
    if (type === 'maintain') {
      targetFields.replaceChildren();
      return;
    }
    const rates = type === 'lose' ? allowedLossRates(profile.weightKg) : GAIN_RATES;
    const current = goal.type === type ? goal : null;
    const sp = current?.targetKg ? kgToStonePounds(current.targetKg) : null;
    const weightInput =
      units === 'imperial'
        ? h(
            'div',
            { class: 'inline-inputs' },
            h('label', { for: 'goal-st' }, 'st'),
            h('input', { id: 'goal-st', name: 'weightSt', class: 'input input--tiny', inputmode: 'numeric', autocomplete: 'off', value: sp ? sp.stone : '', 'aria-describedby': 'goal-target-error goal-range' }),
            h('label', { for: 'goal-lb' }, 'lb'),
            h('input', { id: 'goal-lb', name: 'weightLb', class: 'input input--tiny', inputmode: 'decimal', autocomplete: 'off', value: sp ? sp.pounds : '', 'aria-describedby': 'goal-target-error goal-range' }),
          )
        : h(
            'div',
            { class: 'inline-inputs' },
            h('input', { id: 'goal-kg', name: 'weightKg', class: 'input input--short', inputmode: 'decimal', autocomplete: 'off', value: current?.targetKg ?? '', 'aria-describedby': 'goal-target-error goal-range' }),
            h('span', { class: 'unit' }, 'kg'),
          );
    targetFields.replaceChildren(
      h(
        'div',
        { class: 'field', dataset: { field: 'targetKg' } },
        h('label', { for: units === 'imperial' ? 'goal-st' : 'goal-kg' }, 'Target weight'),
        h('p', { class: 'hint', id: 'goal-range' }, `${type === 'lose' ? 'Lowest' : 'Highest'} target allowed for your height: ${formatWeight(type === 'lose' ? range.minKg : range.maxKg, units)}.`),
        weightInput,
        errorTarget,
      ),
      h(
        'div',
        { class: 'field', dataset: { field: 'ratePerWeekKg' } },
        h('label', { for: 'goal-rate' }, 'Pace'),
        h('p', { class: 'hint' }, type === 'lose' ? 'Slower is easier to keep up. LetsGetFit offers up to 1% of your body weight a week, and never more than 1 kg.' : 'A small surplus limits fat gain. The surplus is capped at 500 kcal a day.'),
        h('select', { id: 'goal-rate', name: 'ratePerWeekKg', class: 'input', 'aria-describedby': 'goal-rate-error' }, rates.map((r) => h('option', { value: String(r), selected: current ? current.ratePerWeekKg === r : r === 0.5 }, rateLabel(r, units)))),
        errorRate,
      ),
    );
  }

  typeChoices.addEventListener('change', (e) => {
    if (e.target.name === 'goalType') {
      type = e.target.value;
      renderTargetFields();
    }
  });
  renderTargetFields();

  form.append(status, typeChoices, targetFields, h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary', id: 'goal-save' }, 'Save goal')));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const el of [errorTarget, errorRate]) {
      el.hidden = true;
      el.textContent = '';
    }
    const raw = { type };
    if (type !== 'maintain') {
      const w = readWeightKg(Object.fromEntries(new FormData(form)), units);
      if (w.error) {
        errorTarget.textContent = w.error;
        errorTarget.hidden = false;
        form.querySelector('#goal-kg, #goal-st')?.focus();
        return;
      }
      raw.targetKg = w.value;
      raw.ratePerWeekKg = form.elements.ratePerWeekKg.value;
    }
    const result = validateGoal(raw, profile);
    if (!result.ok) {
      const { targetKg, ratePerWeekKg, type: typeError } = result.errors;
      if (targetKg) {
        errorTarget.textContent = targetKg;
        errorTarget.hidden = false;
      }
      if (ratePerWeekKg) {
        errorRate.textContent = ratePerWeekKg;
        errorRate.hidden = false;
      }
      if (typeError) {
        status.className = 'form-status notice-inline notice-inline--error';
        status.textContent = typeError;
      }
      (form.querySelector('[aria-describedby*="goal-target-error"]') ?? status).focus();
      return;
    }
    try {
      store.saveProfile({ ...stripMeta(store.profile), goal: { ...result.value, setAt: new Date().toISOString() } });
      toast('Goal saved.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  return h(
    'section',
    { class: 'card', id: 'goal-card', 'aria-labelledby': 'goal-title' },
    h('h2', { id: 'goal-title' }, 'Your goal'),
    h(
      'p',
      { id: 'healthy-range' },
      `Healthy weight range for your height: ${formatWeight(range.minKg, units)} to ${formatWeight(range.maxKg, units)} (BMI ${HEALTHY_BMI.min} to ${HEALTHY_BMI.max}). `,
      h('span', { class: 'muted' }, 'This range comes from BMI, so it does not account for muscle or build. There is no single “ideal” weight.'),
    ),
    planSummary(profile, goal, units),
    h('details', { class: 'disclosure', open: !profile.goal }, h('summary', {}, profile.goal ? 'Change goal' : 'Set a goal'), form),
    h(
      'p',
      { class: 'muted small' },
      'Targets are estimates. Bodies adapt, so check your weight trend after 3–4 weeks and adjust. If you have a health condition, take medication that affects weight, or are under 20, talk to your GP before changing how you eat. If food or weight is causing you worry, Bodywhys (bodywhys.ie) offers free support in Ireland.',
    ),
  );
}

function planSummary(profile, goal, units) {
  const plan = planGoal(profile, goal);
  const rows = [
    ['Maintenance estimate', formatKcal(Math.round(plan.maintenanceKcal / 10) * 10)],
    [goal.type === 'maintain' ? 'Daily energy' : 'Daily energy for your goal', `${formatKcal(plan.allowedKcal)}`],
  ];
  if (goal.type !== 'maintain') {
    rows.push(['Difference', `${plan.dailyChangeKcal < 0 ? '−' : '+'}${formatNumber(Math.round(Math.abs(plan.dailyChangeKcal) / 10) * 10)} kcal a day`]);
    rows.push(['Target', `${formatWeight(goal.targetKg, units)} (BMI ${formatNumber(roundTo(plan.targetBmi, 1), 1)})`]);
    if (plan.targetDate) rows.push(['Estimated time', `About ${formatNumber(Math.ceil(plan.weeksToTarget))} weeks, around ${formatLocalDate(plan.targetDate)}`]);
  }
  rows.push(['Protein, carbohydrate, fat, fibre', `${formatNumber(Math.round(plan.macros.proteinG))} g · ${formatNumber(Math.round(plan.macros.carbohydrateG))} g · ${formatNumber(Math.round(plan.macros.fatG))} g · ${formatNumber(plan.macros.fibreG)} g`]);
  return h(
    'div',
    { id: 'goal-plan' },
    h('dl', { class: 'stats goal-stats' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    plan.floorApplied
      ? h('p', { class: 'notice-inline', id: 'goal-floor' }, `Your daily energy has been kept at ${formatKcal(plan.floorKcal)}, the lowest LetsGetFit suggests without medical supervision. So your expected pace is slower: about ${rateLabel(roundTo(plan.effectiveRateKg, 2), units)}.`)
      : null,
  );
}
