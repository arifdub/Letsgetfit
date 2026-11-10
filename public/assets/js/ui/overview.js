import { ACTIVITY_LEVELS, getActivityLevel, mifflinStJeor, maintenanceEnergy, roundEnergyForDisplay } from '../lib/energy.js';
import { calculateBmi, bmiCategory } from '../lib/bmi.js';
import { maintenanceExample, FOOD_PYRAMID, MEAL_IDEAS, REFERENCE } from '../lib/nutrition.js';
import { validateProfile, checkEligibility, ELIGIBLE_AGE } from '../lib/validate.js';
import { cmToFeetInches, kgToStonePounds, roundTo } from '../lib/units.js';
import { $, $$, h, formatNumber, formatKcal, formatKj, formatWeight, formatHeight, applyUnitsVisibility, showFormErrors, clearFormErrors, toast } from './dom.js';
import { methodsSection } from './methods.js';
import { goalCard } from './goals.js';
import { summaryBar } from './chart.js';

const FIELD_LABELS = {
  ageYears: 'Age',
  height: 'Height',
  weight: 'Current weight',
  sex: 'Equation coefficient',
  activityLevel: 'Usual activity',
  pregnancy: 'Pregnancy or breastfeeding',
};

const INELIGIBLE = {
  pregnancy: {
    title: 'Estimates are not shown during pregnancy or breastfeeding',
    body: 'Energy and nutrient needs change during pregnancy and breastfeeding, and the equations used here were not developed for those times. Your GP, midwife or public health nurse can advise you. You can still use the workout and weight logs.',
  },
  'under-age': {
    title: `This calculator is for adults aged ${ELIGIBLE_AGE.min} and over`,
    body: 'Under 20, BMI is assessed with age- and sex-specific growth charts, and energy needs depend on growth, so adult formulas do not apply. Your GP can advise you.',
  },
  'over-age': {
    title: `Estimates are not shown above age ${ELIGIBLE_AGE.max}`,
    body: `The resting energy equation was developed with adults aged 19 to 78, so LetsGetFit does not extend it beyond ${ELIGIBLE_AGE.max}. Your GP or a registered dietitian can give you an estimate that suits you. You can still use the workout and weight logs.`,
  },
};

export function initOverview(store) {
  const form = $('#profile-form');
  const results = $('#overview-results');
  const intro = $('#overview-intro');
  const summary = $('#profile-errors');
  const cancel = $('#profile-cancel');
  let editing = false;
  let hadProfile = Boolean(store.profile);

  // Activity level choices are generated from the single source of truth in energy.js.
  $('#activity-choices').replaceChildren(
    ...ACTIVITY_LEVELS.map((level) =>
      h(
        'label',
        { class: 'choice choice--stacked' },
        h('input', { type: 'radio', name: 'activityLevel', value: level.id }),
        h('span', {}, h('strong', {}, level.label), h('span', { class: 'choice__desc' }, level.description)),
      ),
    ),
  );

  for (const radio of $$('input[name="units"]', form)) {
    radio.addEventListener('change', () => applyUnitsVisibility(form, radio.value));
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(
      [...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']),
    );
    const result = validateProfile(raw);
    if (!result.ok) {
      showFormErrors(form, result.errors, {
        summary,
        labels: FIELD_LABELS,
        errorId: (field) => `${field}-error`,
        focusTarget: (field) => firstControl(form, field),
      });
      return;
    }
    clearFormErrors(form, summary);
    const { units, ...profile } = result.profile;
    try {
      store.setUnits(units);
      store.saveProfile(profile);
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    editing = false;
    render();
    toast('Your estimates are ready.');
    $('#overview-title').focus();
  });

  cancel.addEventListener('click', () => {
    editing = false;
    clearFormErrors(form, summary);
    render();
    $('#overview-title').focus();
  });

  function startEditing() {
    editing = true;
    render();
    fillForm(form, store.profile, store.units);
    $('#profile-form-title').scrollIntoView({ block: 'start' });
    firstControl(form, 'ageYears')?.focus();
  }

  function render() {
    $('#overview-loading').hidden = true;
    const profile = store.profile;
    const showForm = !profile || editing;
    intro.hidden = Boolean(profile);
    form.hidden = !showForm;
    cancel.hidden = !profile;
    results.hidden = showForm;
    if (!profile) {
      // Data was cleared: empty the form so old values are not left on screen.
      if (hadProfile) {
        form.reset();
        clearFormErrors(form, summary);
      }
      const units = store.units;
      const radio = form.querySelector(`input[name="units"][value="${units}"]`);
      if (radio) radio.checked = true;
      applyUnitsVisibility(form, units);
    }
    hadProfile = Boolean(profile);
    if (!showForm) results.replaceChildren(...renderResults(profile, store.units, startEditing, store));
  }

  store.subscribe(() => {
    if (!editing) render();
  });
  render();
  return { render };
}

function firstControl(form, field) {
  const wrapper = form.querySelector(`[data-field="${field}"]`);
  return wrapper ? [...wrapper.querySelectorAll('input, select')].find((el) => el.offsetParent !== null || el.type === 'radio') : null;
}

function fillForm(form, profile, units) {
  form.reset();
  form.querySelector(`input[name="units"][value="${units}"]`).checked = true;
  applyUnitsVisibility(form, units);
  form.elements.ageYears.value = profile.ageYears;
  form.elements.heightCm.value = roundTo(profile.heightCm, 1);
  form.elements.weightKg.value = roundTo(profile.weightKg, 1);
  const { feet, inches } = cmToFeetInches(profile.heightCm);
  form.elements.heightFt.value = feet;
  form.elements.heightIn.value = inches;
  const { stone, pounds } = kgToStonePounds(profile.weightKg);
  form.elements.weightSt.value = stone;
  form.elements.weightLb.value = pounds;
  const set = (name, value) => {
    const el = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) el.checked = true;
  };
  set('sex', profile.sex);
  set('activityLevel', profile.activityLevel);
  set('pregnancy', profile.pregnantOrBreastfeeding ? 'yes' : 'no');
}

function renderResults(profile, units, onEdit, store) {
  const level = getActivityLevel(profile.activityLevel);
  const eligibility = checkEligibility(profile);
  const basedOn = h(
    'div',
    { class: 'card based-on' },
    h('h2', {}, 'Your profile'),
    h(
      'p',
      {},
      `${profile.ageYears} years · ${formatHeight(profile.heightCm, units)} · ${formatWeight(profile.weightKg, units)} · ${
        profile.sex === 'female' ? 'female' : 'male'
      } coefficient · ${level?.label ?? 'activity not set'}`,
    ),
    h('button', { type: 'button', class: 'button', onclick: onEdit }, 'Edit my details'),
  );

  if (!eligibility.eligible) {
    const msg = INELIGIBLE[eligibility.reason];
    return [h('div', { class: 'card notice', role: 'status' }, h('h2', {}, msg.title), h('p', {}, msg.body)), basedOn];
  }

  const ree = mifflinStJeor({ weightKg: profile.weightKg, heightCm: profile.heightCm, ageYears: profile.ageYears, sex: profile.sex });
  const maintenance = maintenanceEnergy(ree, profile.activityLevel);
  const reeShown = roundEnergyForDisplay(ree);
  const maintenanceShown = roundEnergyForDisplay(maintenance);
  const bmi = calculateBmi(profile.weightKg, profile.heightCm);
  const bmiShown = roundTo(bmi, 1);
  const category = bmiCategory(bmi, profile.ageYears);
  const example = maintenanceExample(maintenanceShown, profile.weightKg);

  const stats = h(
    'div',
    { class: 'stat-grid' },
    statCard({
      id: 'stat-maintenance',
      mark: '≈',
      label: 'Maintenance energy',
      value: formatKcal(maintenanceShown),
      sub: `${formatKj(maintenanceShown)} per day`,
      note: `Resting energy × ${formatNumber(level.pal, 2)} for “${level.label.toLowerCase()}”. Your usual exercise is already included.`,
    }),
    statCard({
      id: 'stat-ree',
      mark: '↯',
      label: 'Resting energy (BMR)',
      value: formatKcal(reeShown),
      sub: `${formatKj(reeShown)} per day`,
      note: 'Energy your body uses at complete rest, estimated with the Mifflin–St Jeor equation.',
    }),
    statCard({
      id: 'stat-bmi',
      mark: '◇',
      label: 'BMI',
      value: formatNumber(bmiShown, 1),
      sub: category ? `Adult screening category: ${category.label}` : '',
      note: 'A screening measure only. See below for what it can and cannot tell you.',
    }),
  );

  const estimateNote = h(
    'p',
    { class: 'muted estimate-note' },
    'Daily energy needs vary. Use these estimates as a starting point.',
  );

  const bmiCard = h(
    'div',
    { class: 'reference-section' },
    h('h2', {}, 'About your BMI'),
    h(
      'p',
      {},
      `BMI is weight in kilograms divided by height in metres squared. For adults aged 20 and over, the US Centers for Disease Control and Prevention (CDC) use these screening categories: underweight below 18.5, healthy weight 18.5 to under 25, overweight 25 to under 30, and obesity 30 or above (class 1: 30 to under 35, class 2: 35 to under 40, class 3: 40 or above).`,
    ),
    h(
      'p',
      {},
      'BMI does not measure body fat, muscle, fitness or overall health. It can read high for muscular people and may not reflect health risk equally across ages and ethnic backgrounds. Use it as one screening number and talk to your GP if you have questions about your weight.',
    ),
  );

  return [
    h('div', { class: 'results', 'aria-live': 'polite' }, stats, estimateNote),
    h('div', { class: 'overview-actions', 'aria-label': 'Quick links' },
      h('a', { class: 'button button--primary', href: '#food' }, 'Open food diary'),
      h('a', { class: 'button', href: '#progress' }, 'View progress'),
    ),
    goalCard(store, profile, units),
    nutritionCard(example, maintenanceShown, profile.weightKg),
    basedOn,
    h('details', { class: 'card disclosure expandable-card' },
      h('summary', {}, 'Food examples and how estimates work'), foodCard(), bmiCard, methodsSection(),
    ),
  ];
}

function statCard({ id, mark, label, value, sub, note }) {
  return h(
    'div',
    { class: 'card stat', id },
    h('span', { class: 'stat__mark', 'aria-hidden': 'true' }, mark),
    h('p', { class: 'stat__label' }, label),
    h('p', { class: 'stat__value' }, value),
    sub ? h('p', { class: 'stat__sub' }, sub) : null,
    h('details', { class: 'disclosure disclosure--compact stat__details' },
      h('summary', {}, 'What this means'), h('p', { class: 'stat__note' }, note),
    ),
  );
}

function nutritionCard(ex, kcal, weightKg) {
  const rows = [
    ['protein', 'Protein', ex.proteinG, ex.proteinShare, `At least ${formatNumber(REFERENCE.proteinGPerKg, 2)} g per kg (${formatNumber(Math.round(ex.proteinFloorG))} g for you)`],
    ['carbohydrate', 'Carbs', ex.carbohydrateG, ex.carbohydrateShare, '45–60% of energy'],
    ['fat', 'Fat', ex.fatG, ex.fatShare, '20–35% of energy'],
    ['fibre', 'Fibre', ex.fibreG, ex.fibreShare, '25 g a day'],
  ];
  return h(
    'section',
    { class: 'card', id: 'nutrition-example', 'aria-labelledby': 'nutrition-title' },
    h('h2', { id: 'nutrition-title' }, 'A maintenance-day example'),
    h('p', { class: 'muted small' }, `An example for ${formatKcal(kcal)} a day. Bars show each nutrient’s share of energy.`),
    h('dl', { class: 'macro-grid macro-grid--example' }, rows.map(([key, name, grams, share]) =>
      h('div', { class: `macro macro--${key}` },
        h('dt', {}, name),
        h('dd', {}, `${formatNumber(Math.round(grams))} g`,
          h('span', { class: 'macro__share' }, `${formatNumber(Math.round(share * 100))}%`),
          summaryBar(share),
        ),
      ),
    )),
    h('details', { class: 'disclosure' },
      h('summary', {}, 'Reference ranges and assumptions'),
      h('dl', { class: 'stats goal-stats' }, rows.flatMap(([, name, , , ref]) => [h('dt', {}, name), h('dd', {}, ref)])),
      h('p', { class: 'muted small' },
        `Protein uses 15% of energy or ${formatNumber(REFERENCE.proteinGPerKg, 2)} g per kg of body weight (${formatNumber(roundTo(weightKg, 1), 1)} kg), whichever is higher. Fat uses 30% of energy. Carbohydrate makes up the rest. Reference ranges are from the European Food Safety Authority.`,
      ),
    ),
  );
}

function foodCard() {
  return h(
    'div',
    { class: 'reference-section' },
    h('h2', {}, 'Balanced food examples'),
    h('p', {}, 'Based on the Healthy Ireland food pyramid from the Department of Health and the HSE. Serving numbers are the general adult guidance.'),
    h(
      'ul',
      { class: 'pyramid' },
      FOOD_PYRAMID.map((shelf) =>
        h('li', { class: `pyramid__shelf pyramid__shelf--${shelf.id}` }, h('p', { class: 'pyramid__name' }, shelf.shelf), h('p', { class: 'pyramid__servings' }, shelf.servings), h('p', { class: 'pyramid__examples' }, shelf.examples)),
      ),
    ),
    h('h3', {}, 'A day of meals'),
    h(
      'dl',
      { class: 'meal-ideas' },
      MEAL_IDEAS.flatMap(({ meal, idea }) => [h('dt', {}, meal), h('dd', {}, idea)]),
    ),
  );
}
