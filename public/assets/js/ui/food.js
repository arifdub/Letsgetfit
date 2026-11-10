// Food diary view: day picker, daily totals, meals, and the add/edit panel
// (search, my foods, new food, then amount).

import { NUTRIENTS, scaleNutrients, sumNutrients, knownCount } from '../lib/nutrients.js';
import {
  MEALS,
  PREPARATIONS,
  SOURCES,
  validateCustomFood,
  validateDiaryEntry,
  buildDiaryEntry,
  rescaleEntry,
  findDuplicate,
} from '../lib/food.js';
import { toLocalDateString, parseLocalDate, formatLocalDate, isValidLocalDate } from '../lib/dates.js';
import { getActivityLevel, mifflinStJeor, maintenanceEnergy, roundEnergyForDisplay } from '../lib/energy.js';
import { checkEligibility } from '../lib/validate.js';
import { planGoal } from '../lib/goals.js';
import { checkSearchAvailable, checkScanAvailable, searchFoods } from '../api/foods.js';
import { summaryBar, summaryRing } from './chart.js';
import { scanPanel } from './scan.js';
import { $, h, formatNumber, toast, confirmAction, emptyState, readForm, showFormErrors, clearFormErrors } from './dom.js';

const mealLabel = (id) => MEALS.find((m) => m.id === id)?.label ?? id;

function addDays(localDate, days) {
  const d = parseLocalDate(localDate);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

function fmtNutrient(n, value) {
  if (value === null || value === undefined) return 'Unknown';
  return `${formatNumber(value, n.decimals)} ${n.unit}`;
}

function kcalText(value) {
  return value === null || value === undefined ? 'kcal unknown' : `${formatNumber(Math.round(value))} kcal`;
}

function badges(food) {
  const items = [];
  items.push(food.kind === 'branded' ? 'Branded' : 'Generic');
  if (food.preparation === 'raw' || food.preparation === 'cooked') items.push(PREPARATIONS[food.preparation]);
  if (food.source === 'custom') items.push('Your food');
  else if (food.dataType) items.push(food.dataType);
  return h('span', { class: 'badges' }, items.map((t) => h('span', { class: 'badge' }, t)));
}

export function diaryEnergyReference(p) {
  if (!p || !checkEligibility(p).eligible || !getActivityLevel(p.activityLevel)) return null;
  if (p.goal && p.goal.type !== 'maintain') return { kcal: planGoal(p, p.goal).allowedKcal, goal: true };
  const ree = mifflinStJeor({ weightKg: p.weightKg, heightCm: p.heightCm, ageYears: p.ageYears, sex: p.sex });
  return { kcal: roundEnergyForDisplay(maintenanceEnergy(ree, p.activityLevel)), goal: false };
}

export function diaryMacros({ totals, missing, count }) {
  return NUTRIENTS.filter((n) => n.group === 'core' && n.key !== 'energy').map((n) =>
    h('div', { class: `macro macro--${n.key}` },
      h('dt', {}, n.key === 'carbohydrate' ? 'Carbs' : n.label),
      h('dd', {}, count > 0 && missing[n.key] === count ? 'Unknown' : `${missing[n.key] ? '≥ ' : ''}${fmtNutrient(n, totals[n.key])}`),
    ),
  );
}

export function initFood(store) {
  const view = $('#view-food');
  const dateInput = $('#food-date');
  const panel = $('#food-panel');
  let currentDate = toLocalDateString();
  let state = null; // panel state
  let lastTrigger = null;
  let nutrientsOpen = false;
  let searchController = null;
  let lastSearch = { query: '', type: 'all', results: null, error: null };
  let searchAvailable = null;

  let scanAvailable = false;
  checkSearchAvailable().then((available) => {
    searchAvailable = available;
    if (state?.step === 'choose' && state.tab === 'search') renderPanel();
  });
  checkScanAvailable().then((available) => {
    scanAvailable = available;
    if (state?.step === 'choose') renderPanel();
  });

  /* ---------------- Date bar ---------------- */

  function setDate(value) {
    if (!isValidLocalDate(value)) return;
    const today = toLocalDateString();
    currentDate = value > today ? today : value;
    render();
  }
  $('#food-prev').addEventListener('click', () => setDate(addDays(currentDate, -1)));
  $('#food-next').addEventListener('click', () => setDate(addDays(currentDate, 1)));
  $('#food-today').addEventListener('click', () => setDate(toLocalDateString()));
  dateInput.addEventListener('change', () => setDate(dateInput.value));

  /* ---------------- Day view ---------------- */

  function renderTotals(entries, day) {
    const container = $('#food-totals');
    if (entries.length === 0) {
      container.replaceChildren(emptyState('Nothing logged for this day', 'Choose a meal below to add food.'));
      return;
    }
    const { totals, missing, count } = day;
    const incompleteAny = NUTRIENTS.some((n) => missing[n.key] > 0);
    const rows = NUTRIENTS.map((n) => {
      const allMissing = missing[n.key] === count;
      const value = allMissing ? null : totals[n.key];
      let status = '';
      if (allMissing) status = 'No data';
      else if (missing[n.key] > 0) status = `${missing[n.key]} of ${count} unknown`;
      return h(
        'tr',
        { dataset: { nutrient: n.key }, class: missing[n.key] > 0 ? 'is-incomplete' : '' },
        h('th', { scope: 'row' }, n.label),
        h('td', {}, value === null ? 'Unknown' : `${missing[n.key] > 0 ? 'at least ' : ''}${fmtNutrient(n, value)}`),
        h('td', { class: 'muted' }, status),
      );
    });
    const maintenance = diaryEnergyReference(store.profile);
    const energyMissing = missing.energy;
    const logged = Math.round(totals.energy);
    const comparison = energyMissing === 0 && maintenance?.kcal > 0;
    const difference = comparison ? maintenance.kcal - logged : 0;
    const energy = h(
      'p',
      { class: 'stat__value', id: 'day-energy' },
      energyMissing === count ? 'Energy unknown' : `${energyMissing ? 'At least ' : ''}${formatNumber(logged)} kcal`,
    );
    container.replaceChildren(
      h(
        'section',
        { class: 'card diary-summary', id: 'day-totals', 'aria-labelledby': 'day-totals-title' },
        h('h2', { id: 'day-totals-title' }, 'Daily nutrition'),
        h('div', { class: 'diary-summary__main' },
          comparison ? h('div', { class: 'diary-gauge' },
            summaryRing(logged / maintenance.kcal, difference < 0),
            h('span', { class: 'diary-gauge__label', 'aria-hidden': 'true' },
              h('strong', {}, formatNumber(Math.abs(difference))),
              h('span', {}, difference < 0 ? 'kcal over' : 'kcal left'),
            ),
          ) : null,
          h('div', { class: 'diary-summary__energy' },
            h('p', { class: 'summary-label' }, 'Energy logged'),
            energy,
            comparison ? h('p', { class: 'visually-hidden' }, `${formatNumber(Math.abs(difference))} kcal ${difference < 0 ? 'over your estimate' : 'left to your estimate'}`) : null,
            maintenance ? h('p', { class: 'muted small', id: 'day-reference' },
              maintenance.goal
                ? `Your daily energy for your goal is about ${formatNumber(maintenance.kcal)} kcal.`
                : `Your maintenance estimate is about ${formatNumber(maintenance.kcal)} kcal a day.`,
            ) : null,
          ),
        ),
        h('dl', { class: 'macro-grid', 'aria-label': 'Macronutrients and fibre' }, diaryMacros(day)),
        incompleteAny
          ? h('p', { class: 'muted small', id: 'totals-incomplete' }, 'Some nutrient values are unknown. Totals marked ≥ include only known values.')
          : null,
        h(
          'details',
          { class: 'disclosure', open: nutrientsOpen, ontoggle: (event) => { nutrientsOpen = event.currentTarget.open; } },
          h('summary', {}, 'All nutrients'),
          h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 'table', id: 'nutrient-table' },
              h('caption', { class: 'visually-hidden' }, `Nutrient totals for ${formatLocalDate(currentDate)}`),
              h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Nutrient'), h('th', { scope: 'col' }, 'Total'), h('th', { scope: 'col' }, 'Missing'))),
              h('tbody', {}, rows),
            ),
          ),
        ),
      ),
    );
  }

  function renderMeals(entries, day) {
    $('#food-meals').replaceChildren(
      ...MEALS.map((meal) => {
        const list = entries.filter((e) => e.meal === meal.id);
        const mealKcal = sumNutrients(list);
        const showShare = list.length > 0 && day.missing.energy === 0 && day.totals.energy > 0;
        const addButton = h('button', {
          type: 'button', class: 'button button--small meal__add', dataset: { addMeal: meal.id },
          'aria-label': `Add to ${meal.label.toLowerCase()}`,
        }, h('span', { 'aria-hidden': 'true' }, '+'), ' Add');
        addButton.addEventListener('click', () => openPanel({ step: 'choose', meal: meal.id, tab: searchAvailable === false ? 'mine' : 'search' }, addButton));
        return h(
          'section',
          { class: 'card meal', dataset: { meal: meal.id }, 'aria-labelledby': `meal-${meal.id}` },
          h(
            'div',
            { class: 'meal__head' },
            h('h2', { id: `meal-${meal.id}` }, meal.label),
            h('div', { class: 'meal__actions' },
              list.length ? h('span', { class: 'muted small' },
                mealKcal.missing.energy === list.length ? 'Energy unknown'
                  : `${mealKcal.missing.energy ? 'At least ' : ''}${kcalText(mealKcal.totals.energy)}`,
              ) : null,
              addButton,
            ),
          ),
          showShare ? h('div', { class: 'meal-share' },
            summaryBar(mealKcal.totals.energy / day.totals.energy),
            h('span', {}, `${formatNumber(mealKcal.totals.energy / day.totals.energy * 100)}% of day`),
          ) : null,
          list.length
            ? h(
                'ul',
                { class: 'entries entries--compact' },
                list.map((entry) => {
                  const label = `${entry.name}, ${formatNumber(entry.servingG, 1)} g`;
                  const edit = h('button', { type: 'button', class: 'button button--small', 'aria-label': `Edit ${label}` }, 'Edit');
                  edit.addEventListener('click', () => openPanel({ step: 'amount', mode: 'edit', entry, meal: entry.meal }, edit));
                  const del = h('button', { type: 'button', class: 'button button--small button--danger-ghost', 'aria-label': `Delete ${label}` }, 'Delete');
                  del.addEventListener('click', () => removeEntry(entry));
                  return h(
                    'li',
                    { class: 'entry', dataset: { id: entry.id } },
                    h(
                      'div',
                      { class: 'entry__body' },
                      h('p', { class: 'entry__title' }, entry.name, entry.brand ? h('span', { class: 'muted' }, ` · ${entry.brand}`) : null),
                      h('p', { class: 'entry__meta' }, `${formatNumber(entry.servingG, 1)} ${entry.basis === '100ml' ? 'ml' : 'g'} · ${kcalText(entry.nutrients?.energy)}`),
                      knownCount(entry.per100g) < NUTRIENTS.length ? h('p', { class: 'entry__meta muted' }, `${knownCount(entry.per100g)} of ${NUTRIENTS.length} nutrients known`) : null,
                    ),
                    h('div', { class: 'entry__actions' }, edit, del),
                  );
                }),
              )
            : null,
        );
      }),
    );
  }

  function render() {
    const today = toLocalDateString();
    dateInput.max = today;
    dateInput.value = currentDate;
    $('#food-next').disabled = currentDate >= today;
    $('#food-today').hidden = currentDate === today;
    $('#food-date-label').textContent = currentDate === today ? `Today, ${formatLocalDate(currentDate)}` : formatLocalDate(currentDate);
    const entries = store.diaryFor(currentDate);
    const day = sumNutrients(entries);
    renderTotals(entries, day);
    renderMeals(entries, day);
  }

  async function removeEntry(entry) {
    const ok = await confirmAction({ title: 'Delete this food?', body: `${entry.name} (${formatNumber(entry.servingG, 1)} g) will be removed from ${mealLabel(entry.meal).toLowerCase()} on ${formatLocalDate(entry.localDate)}.` });
    if (!ok) return;
    try {
      store.deleteDiaryEntry(entry.id);
      toast('Food removed.');
      $('#food-title').focus();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  /* ---------------- Panel ---------------- */

  function openPanel(next, trigger) {
    searchController?.abort();
    state = next;
    lastTrigger = trigger ?? null;
    renderPanel();
    panel.hidden = false;
    panel.scrollIntoView({ block: 'start' });
    $('#food-panel-title').focus();
  }

  function closePanel() {
    searchController?.abort();
    state = null;
    panel.hidden = true;
    panel.replaceChildren();
    if (lastTrigger?.isConnected) lastTrigger.focus();
    else $('#food-title').focus();
  }

  function panelHeader(title) {
    const close = h('button', { type: 'button', class: 'button button--small button--ghost', id: 'food-panel-close' }, 'Close');
    close.addEventListener('click', closePanel);
    return h('div', { class: 'food-panel__head' }, h('h2', { id: 'food-panel-title', tabindex: '-1' }, title), close);
  }

  function renderPanel() {
    if (!state) return;
    if (state.step === 'amount') renderAmount();
    else if (state.step === 'custom') renderCustomForm();
    else renderChoose();
  }

  function tabs() {
    const items = [
      ['search', 'Search'],
      ...(scanAvailable ? [['scan', 'Scan photo']] : []),
      ['mine', 'My foods'],
      ['new', 'New food'],
    ];
    return h(
      'div',
      { class: 'segmented tabs', role: 'group', 'aria-label': 'Ways to add food' },
      items.map(([id, label]) => {
        const b = h('button', { type: 'button', class: 'tab', 'aria-pressed': String(state.tab === id), dataset: { tab: id } }, label);
        b.addEventListener('click', () => {
          if (id === 'new') {
            state = { ...state, step: 'custom', editFoodId: null };
          } else {
            state = { ...state, tab: id };
          }
          renderPanel();
          panel.querySelector(`[data-tab="${id}"]`)?.focus();
        });
        return b;
      }),
    );
  }

  function foodButton(food) {
    const energy = food.per100g?.energy;
    const choose = h(
      'button',
      { type: 'button', class: 'food-option', dataset: { sourceId: food.sourceId ?? '', foodId: food.id ?? '' } },
      h('span', { class: 'food-option__name' }, food.name),
      food.brand ? h('span', { class: 'food-option__brand' }, food.brand) : null,
      badges(food),
      h(
        'span',
        { class: 'food-option__meta' },
        `${energy === null || energy === undefined ? 'Energy unknown' : `${formatNumber(Math.round(energy))} kcal`} per 100 ${food.basis === '100ml' ? 'ml' : 'g'} · ${knownCount(food.per100g)} of ${NUTRIENTS.length} nutrients known`,
      ),
    );
    choose.addEventListener('click', () => {
      state = { ...state, step: 'amount', mode: 'add', food };
      renderPanel();
      $('#food-panel-title').focus();
    });
    return choose;
  }

  function renderChoose() {
    const body = [];
    if (state.tab === 'scan' && scanAvailable) {
      body.push(
        scanPanel({
          store,
          meal: state.meal,
          localDate: currentDate,
          saveToLibrary,
          onSaved: () => {
            closePanel();
            render();
          },
          onManual: () => {
            state = { ...state, tab: searchAvailable === false ? 'mine' : 'search' };
            renderPanel();
            $('#food-panel-title').focus();
          },
        }),
      );
    } else if (state.tab === 'search') {
      if (searchAvailable === false) {
        body.push(
          h(
            'div',
            { class: 'notice-inline', id: 'search-unavailable' },
            h('p', {}, 'Food search is not available right now.'),
            h('p', {}, 'You can still add foods yourself with “New food”, or pick one from “My foods”.'),
          ),
        );
      } else {
        const form = h(
          'form',
          { class: 'search-form', role: 'search', novalidate: true },
          h('label', { for: 'food-search-q' }, 'Search foods'),
          h(
            'div',
            { class: 'search-row' },
            h('input', { id: 'food-search-q', name: 'q', type: 'search', class: 'input', autocomplete: 'off', minlength: '2', maxlength: '100', value: lastSearch.query, placeholder: 'For example: porridge oats' }),
            h(
              'select',
              { name: 'type', class: 'input search-type', 'aria-label': 'Type of food' },
              h('option', { value: 'all', selected: lastSearch.type === 'all' }, 'All foods'),
              h('option', { value: 'generic', selected: lastSearch.type === 'generic' }, 'Generic'),
              h('option', { value: 'branded', selected: lastSearch.type === 'branded' }, 'Branded'),
            ),
            h('button', { type: 'submit', class: 'button button--primary' }, 'Search'),
          ),
        );
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const { q, type } = readForm(form);
          runSearch(q.trim(), type);
        });
        body.push(form, h('div', { id: 'search-status', role: 'status', 'aria-live': 'polite' }), h('div', { id: 'search-results' }));
      }
    } else {
      const foods = store.foods;
      body.push(
        foods.length
          ? h(
              'ul',
              { class: 'food-list', 'aria-label': 'My foods' },
              foods.map((food) => {
                const actions = [];
                if (food.source === 'custom') {
                  const edit = h('button', { type: 'button', class: 'button button--small', 'aria-label': `Edit ${food.name}` }, 'Edit');
                  edit.addEventListener('click', () => {
                    state = { ...state, step: 'custom', editFoodId: food.id };
                    renderPanel();
                  });
                  actions.push(edit);
                }
                const del = h('button', { type: 'button', class: 'button button--small button--danger-ghost', 'aria-label': `Remove ${food.name} from My foods` }, 'Remove');
                del.addEventListener('click', async () => {
                  const ok = await confirmAction({ title: 'Remove from My foods?', body: `${food.name} will be removed from your list. Diary entries that used it are kept.`, confirmLabel: 'Remove' });
                  if (!ok) return;
                  store.deleteFood(food.id);
                  toast('Food removed from My foods.');
                  renderPanel();
                  $('#food-panel-title').focus();
                });
                actions.push(del);
                return h('li', { class: 'food-list__item' }, foodButton(food), h('div', { class: 'entry__actions' }, actions));
              }),
            )
          : emptyState('No saved foods yet', 'Foods you add from search or create yourself appear here for quick reuse.'),
      );
    }
    panel.replaceChildren(panelHeader(`Add to ${mealLabel(state.meal).toLowerCase()}`), tabs(), ...body);
    if (state.tab === 'search' && lastSearch.results) renderSearchResults();
  }

  async function runSearch(query, type) {
    const status = $('#search-status');
    if (query.length < 2) {
      status.textContent = 'Enter at least 2 characters.';
      return;
    }
    searchController?.abort();
    searchController = new AbortController();
    lastSearch = { query, type, results: null, error: null };
    status.textContent = 'Searching…';
    status.className = 'state state--loading';
    $('#search-results').replaceChildren();
    try {
      const { results } = await searchFoods(query, { type, signal: searchController.signal });
      lastSearch.results = results;
    } catch (error) {
      if (error.code === 'cancelled') return;
      lastSearch.error = error.message;
      lastSearch.results = [];
    }
    if (state?.step === 'choose' && state.tab === 'search') renderSearchResults();
  }

  function renderSearchResults() {
    const status = $('#search-status');
    const container = $('#search-results');
    if (!status || !container) return;
    status.className = '';
    if (lastSearch.error) {
      status.replaceChildren(h('div', { class: 'notice-inline notice-inline--error', id: 'search-error' }, h('p', {}, lastSearch.error), manualButton()));
      container.replaceChildren();
      return;
    }
    const results = lastSearch.results ?? [];
    if (results.length === 0) {
      status.replaceChildren(h('p', {}, `No foods found for “${lastSearch.query}”. Try a simpler word, or add it yourself.`), manualButton());
      container.replaceChildren();
      return;
    }
    status.textContent = `${results.length} ${results.length === 1 ? 'food' : 'foods'} found.`;
    container.replaceChildren(h('ul', { class: 'food-list', 'aria-label': 'Search results' }, results.map((food) => h('li', { class: 'food-list__item' }, foodButton(food)))));
  }

  function manualButton() {
    const b = h('button', { type: 'button', class: 'button button--small' }, 'Add a food yourself');
    b.addEventListener('click', () => {
      state = { ...state, step: 'custom', editFoodId: null, prefillName: lastSearch.query };
      renderPanel();
      $('#food-panel-title').focus();
    });
    return b;
  }

  /* ----- New / edit custom food ----- */

  function renderCustomForm() {
    const editing = state.editFoodId ? store.foods.find((f) => f.id === state.editFoodId) : null;
    const v = (key) => {
      const val = editing?.per100g?.[key];
      return val === null || val === undefined ? '' : String(val);
    };
    const form = h('form', { class: 'form', id: 'custom-food-form', novalidate: true });
    const summary = h('div', { class: 'error-summary', role: 'alert', tabindex: '-1', hidden: true }, h('h3', {}, 'Please check the following'), h('ul'));
    const field = (name, label, input, hint) =>
      h('div', { class: 'field', dataset: { field: name } }, h('label', { for: `cf-${name}` }, label), hint ? h('p', { class: 'hint', id: `cf-${name}-hint` }, hint) : null, input, h('p', { class: 'field-error', id: `cf-${name}-error`, hidden: true }));
    const nutrientInputs = NUTRIENTS.map((n) =>
      h(
        'div',
        { class: 'field field--nutrient', dataset: { field: `n_${n.key}` } },
        h('label', { for: `cf-n_${n.key}` }, n.label, ' ', h('span', { class: 'unit' }, n.unit)),
        h('input', { id: `cf-n_${n.key}`, name: `n_${n.key}`, type: 'text', inputmode: 'decimal', class: 'input input--short', autocomplete: 'off', value: v(n.key), 'aria-describedby': `cf-n_${n.key}-error` }),
        h('p', { class: 'field-error', id: `cf-n_${n.key}-error`, hidden: true }),
      ),
    );
    const duplicateBox = h('div', { id: 'duplicate-notice', hidden: true });
    form.append(
      summary,
      field('name', 'Food name', h('input', { id: 'cf-name', name: 'name', type: 'text', class: 'input', maxlength: '80', autocomplete: 'off', value: editing?.name ?? state.prefillName ?? '', 'aria-describedby': 'cf-name-error' })),
      h(
        'div',
        { class: 'grid-2' },
        field(
          'kind',
          'Type',
          h('select', { id: 'cf-kind', name: 'kind', class: 'input' }, h('option', { value: 'generic', selected: editing?.kind !== 'branded' }, 'Generic food'), h('option', { value: 'branded', selected: editing?.kind === 'branded' }, 'Branded product')),
        ),
        field('brand', 'Brand (for branded products)', h('input', { id: 'cf-brand', name: 'brand', type: 'text', class: 'input', maxlength: '60', autocomplete: 'off', value: editing?.brand ?? '', 'aria-describedby': 'cf-brand-error' })),
      ),
      field(
        'preparation',
        'Raw or cooked',
        h(
          'select',
          { id: 'cf-preparation', name: 'preparation', class: 'input' },
          Object.entries(PREPARATIONS).map(([id, label]) => h('option', { value: id, selected: (editing?.preparation ?? 'unspecified') === id }, label)),
        ),
        'Raw and cooked versions of the same food have different values per 100 g, because cooking changes the water content.',
      ),
      h(
        'fieldset',
        { class: 'field' },
        h('legend', {}, 'Nutrients per 100 g'),
        h('p', { class: 'hint' }, 'Copy these from the label’s “per 100 g” column. Leave a box empty if you do not know it: it will show as unknown, not zero.'),
        h('div', { class: 'nutrient-grid' }, nutrientInputs),
      ),
      field(
        'servingG',
        'Usual serving (optional)',
        h('input', { id: 'cf-servingG', name: 'servingG', type: 'text', inputmode: 'decimal', class: 'input input--short', autocomplete: 'off', value: editing?.servingOptions?.[0]?.grams ?? '', 'aria-describedby': 'cf-servingG-error' }),
        'In grams. Used to fill in the amount for you.',
      ),
      duplicateBox,
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary' }, editing ? 'Save changes' : 'Save and choose amount'), cancelToChoose()),
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = validateCustomFood(readForm(form));
      const labels = Object.fromEntries([['name', 'Food name'], ['brand', 'Brand'], ['servingG', 'Usual serving'], ...NUTRIENTS.map((n) => [`n_${n.key}`, n.label])]);
      if (!result.ok) {
        showFormErrors(form, result.errors, { summary, labels, errorId: (f) => `cf-${f}-error`, focusTarget: (f) => form.querySelector(`#cf-${f}`) });
        return;
      }
      clearFormErrors(form, summary);
      const duplicate = findDuplicate(store.foods, result.value, { ignoreId: editing?.id });
      if (duplicate && !state.allowDuplicateOf) {
        showDuplicate(duplicateBox, duplicate, result.value, editing);
        return;
      }
      try {
        if (editing) {
          store.updateFood(editing.id, result.value);
          toast('Food updated. Diary entries already logged keep their original values.');
          state = { ...state, step: 'choose', tab: 'mine', editFoodId: null };
          renderPanel();
          $('#food-panel-title').focus();
          return;
        }
        const saved = store.addFood({ ...result.value, lastUsedAt: new Date().toISOString() });
        state = { ...state, step: 'amount', mode: 'add', food: saved };
        renderPanel();
        $('#food-panel-title').focus();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    panel.replaceChildren(panelHeader(editing ? `Edit ${editing.name}` : 'New food'), tabs(), form);
  }

  function showDuplicate(box, duplicate, value, editing) {
    const useExisting = h('button', { type: 'button', class: 'button button--small button--primary' }, 'Use the saved food');
    useExisting.addEventListener('click', () => {
      state = { ...state, step: 'amount', mode: 'add', food: duplicate };
      renderPanel();
      $('#food-panel-title').focus();
    });
    const replace = h('button', { type: 'button', class: 'button button--small' }, 'Update the saved food with these values');
    replace.addEventListener('click', () => {
      const updated = store.updateFood(duplicate.id, value);
      if (editing && editing.id !== duplicate.id) store.deleteFood(editing.id);
      toast('Saved food updated. Diary entries already logged keep their original values.');
      state = { ...state, step: editing ? 'choose' : 'amount', tab: 'mine', mode: 'add', food: updated, editFoodId: null };
      renderPanel();
      $('#food-panel-title').focus();
    });
    box.hidden = false;
    box.className = 'notice-inline';
    box.replaceChildren(h('p', {}, `You already have “${duplicate.name}”${duplicate.brand ? ` (${duplicate.brand})` : ''} in My foods.`), h('div', { class: 'form__actions' }, useExisting, replace));
    useExisting.focus();
  }

  function cancelToChoose() {
    const b = h('button', { type: 'button', class: 'button button--ghost' }, 'Back');
    b.addEventListener('click', () => {
      state = { ...state, step: 'choose', tab: state.tab === 'new' ? 'mine' : state.tab ?? 'search', editFoodId: null };
      renderPanel();
      $('#food-panel-title').focus();
    });
    return b;
  }

  /* ----- Amount step (add or edit an entry) ----- */

  function renderAmount() {
    const editing = state.mode === 'edit';
    const source = editing ? state.entry : state.food;
    const unit = source.basis === '100ml' ? 'ml' : 'g';
    const defaultG = editing ? source.servingG : source.servingOptions?.[0]?.grams ?? 100;
    const form = h('form', { class: 'form', id: 'amount-form', novalidate: true });
    const summary = h('div', { class: 'error-summary', role: 'alert', tabindex: '-1', hidden: true }, h('h3', {}, 'Please check the following'), h('ul'));
    const grams = h('input', { id: 'amount-g', name: 'servingG', type: 'text', inputmode: 'decimal', class: 'input input--short', autocomplete: 'off', value: String(defaultG), 'aria-describedby': 'amount-servingG-error amount-hint' });
    const preview = h('dl', { class: 'stats preview', id: 'amount-preview', 'aria-live': 'polite' });
    const servingButtons = (source.servingOptions ?? []).map((s) => {
      const b = h('button', { type: 'button', class: 'button button--small' }, `${s.label} (${formatNumber(s.grams, 1)} ${unit})`);
      b.addEventListener('click', () => {
        grams.value = String(s.grams);
        updatePreview();
      });
      return b;
    });
    const quick = [50, 100, 150, 200].map((g) => {
      const b = h('button', { type: 'button', class: 'button button--small button--ghost' }, `${g} ${unit}`);
      b.addEventListener('click', () => {
        grams.value = String(g);
        updatePreview();
      });
      return b;
    });

    function updatePreview() {
      const g = Number(String(grams.value).replace(',', '.'));
      const values = Number.isFinite(g) && g > 0 ? scaleNutrients(source.per100g, g) : null;
      preview.replaceChildren(
        ...NUTRIENTS.filter((n) => n.group === 'core').flatMap((n) => [h('dt', {}, n.label), h('dd', {}, values ? fmtNutrient(n, values[n.key]) : '–')]),
      );
    }
    grams.addEventListener('input', updatePreview);
    updatePreview();

    form.append(
      summary,
      h(
        'div',
        { class: 'chosen-food' },
        h('p', { class: 'entry__title' }, source.name),
        source.brand ? h('p', { class: 'muted' }, source.brand) : null,
        badges(source),
        h('p', { class: 'muted small' }, `Source: ${SOURCES[source.source] ?? source.source}${source.sourceId ? ` (ID ${source.sourceId})` : ''}`),
        source.basis === '100ml' ? h('p', { class: 'notice-inline small' }, 'This product’s values are per 100 ml. Amounts are treated as millilitres (about the same as grams for most drinks).') : null,
      ),
      h(
        'div',
        { class: 'field', dataset: { field: 'servingG' } },
        h('label', { for: 'amount-g' }, `Amount `, h('span', { class: 'unit' }, unit === 'ml' ? 'millilitres' : 'grams')),
        h('p', { class: 'hint', id: 'amount-hint' }, 'Weigh it, or use the usual serving if one is shown.'),
        grams,
        h('p', { class: 'field-error', id: 'amount-servingG-error', hidden: true }),
        servingButtons.length || quick.length ? h('div', { class: 'quick-amounts' }, servingButtons, quick) : null,
      ),
      h(
        'div',
        { class: 'grid-2' },
        h(
          'div',
          { class: 'field', dataset: { field: 'meal' } },
          h('label', { for: 'amount-meal' }, 'Meal'),
          h('select', { id: 'amount-meal', name: 'meal', class: 'input' }, MEALS.map((m) => h('option', { value: m.id, selected: m.id === state.meal }, m.label))),
          h('p', { class: 'field-error', id: 'amount-meal-error', hidden: true }),
        ),
        h(
          'div',
          { class: 'field', dataset: { field: 'localDate' } },
          h('label', { for: 'amount-date' }, 'Date'),
          h('input', { id: 'amount-date', name: 'localDate', type: 'date', class: 'input', value: editing ? source.localDate : currentDate, max: toLocalDateString() }),
          h('p', { class: 'field-error', id: 'amount-localDate-error', hidden: true }),
        ),
      ),
      h('h3', {}, 'For this amount'),
      preview,
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary', id: 'amount-save' }, editing ? 'Save changes' : 'Add to diary'), editing ? closeButton() : cancelToChoose()),
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = validateDiaryEntry(readForm(form));
      if (!result.ok) {
        showFormErrors(form, result.errors, { summary, labels: { servingG: 'Amount', meal: 'Meal', localDate: 'Date' }, errorId: (f) => `amount-${f}-error`, focusTarget: (f) => form.querySelector(f === 'servingG' ? '#amount-g' : f === 'meal' ? '#amount-meal' : '#amount-date') });
        return;
      }
      try {
        if (editing) {
          const next = rescaleEntry(source, result.value.servingG);
          store.updateDiaryEntry(source.id, { ...next, meal: result.value.meal, localDate: result.value.localDate });
          toast('Diary entry updated.');
        } else {
          const food = saveToLibrary(source);
          store.addDiaryEntry(buildDiaryEntry(food, result.value));
          toast(`${food.name} added to ${mealLabel(result.value.meal).toLowerCase()}.`);
        }
      } catch (error) {
        toast(error.message, 'error');
        return;
      }
      currentDate = result.value.localDate;
      closePanel();
      render();
    });

    panel.replaceChildren(panelHeader(editing ? 'Edit diary entry' : 'How much?'), form);
  }

  function closeButton() {
    const b = h('button', { type: 'button', class: 'button button--ghost' }, 'Cancel');
    b.addEventListener('click', closePanel);
    return b;
  }

  /** Add or refresh the food in My foods, de-duplicating by source ID or name. */
  function saveToLibrary(food) {
    const now = new Date().toISOString();
    if (food.id && store.foods.some((f) => f.id === food.id)) return store.updateFood(food.id, { lastUsedAt: now });
    const { id, createdAt, updatedAt, ...value } = food;
    void id;
    void createdAt;
    void updatedAt;
    const existing = findDuplicate(store.foods, value);
    if (existing) return store.updateFood(existing.id, { ...value, lastUsedAt: now });
    return store.addFood({ ...value, lastUsedAt: now });
  }

  // Keep the day view current when data changes elsewhere (for example "Clear all data").
  store.subscribe(() => {
    if (!view.hidden) render();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#food') render();
  });
  render();
  return {
    openToday(meal) {
      setDate(toLocalDateString());
      const trigger = $(`[data-add-meal="${meal}"]`);
      openPanel({ step: 'choose', meal, tab: searchAvailable === false ? 'mine' : 'search' }, trigger);
    },
  };
}
