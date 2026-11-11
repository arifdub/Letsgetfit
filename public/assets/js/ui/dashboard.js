// Today's snapshot uses the same saved entries and nutrition estimates as the diary.
import { MEALS } from '../lib/food.js';
import { NUTRIENTS } from '../lib/nutrients.js';
import { macroProgress, maintenanceExample } from '../lib/nutrition.js';
import { sumNutrients } from '../lib/nutrients.js';
import { formatLocalDate, toLocalDateString } from '../lib/dates.js';
import { $, h, formatNumber } from './dom.js';
import { diaryEnergyReference } from './food.js';
import { appleGauge, summaryBar } from './chart.js';

function energyLabel({ totals, missing, count }) {
  if (count > 0 && missing.energy === count) return 'Unknown';
  return `${missing.energy ? '≥ ' : ''}${formatNumber(Math.round(totals.energy))} kcal`;
}

/** Macro tiles: grams logged, a bar against the day's guide amount, and what is left. */
function macroTiles(day, guide) {
  const progress = guide ? macroProgress(day.totals, guide) : {};
  return NUTRIENTS.filter((n) => n.group === 'core' && n.key !== 'energy').map((n) => {
    const unknown = day.count > 0 && day.missing[n.key] === day.count;
    const grams = Math.round(day.totals[n.key] ?? 0);
    const p = unknown ? null : progress[n.key];
    return h('div', { class: `macro macro--${n.key}${p?.overG ? ' macro--over' : ''}`, dataset: { macro: n.key } },
      h('dt', {}, n.key === 'carbohydrate' ? 'Carbs' : n.label),
      h('dd', {},
        h('span', { class: 'macro__value' }, unknown ? 'Unknown' : `${day.missing[n.key] ? '≥ ' : ''}${formatNumber(grams)} g`),
        p ? summaryBar(p.fraction) : null,
        p ? h('span', { class: 'macro__left' }, `${formatNumber(p.percent)}% · ${p.overG ? `${formatNumber(p.overG)} g over guide` : `${formatNumber(p.leftG)} g left`}`) : null,
        p ? h('span', { class: 'visually-hidden' }, ` of a guide amount of ${formatNumber(p.targetG)} g`) : null,
      ),
    );
  });
}

export function initDashboard(store, addFood, addExercise) {
  const host = $('#daily-dashboard');

  function render() {
    const today = toLocalDateString();
    const entries = store.diaryFor(today);
    const day = sumNutrients(entries);
    const reference = diaryEnergyReference(store.profile);
    const logged = Math.round(day.totals.energy);
    const comparable = reference?.kcal > 0 && day.missing.energy === 0;
    const remaining = comparable ? reference.kcal - logged : 0;
    const over = comparable && remaining < 0;
    const guide = reference?.kcal > 0 && store.profile?.weightKg > 0 ? maintenanceExample(reference.kcal, store.profile.weightKg) : null;
    const minutes = store.workouts
      .filter((workout) => workout.localDate === today)
      .reduce((sum, workout) => sum + (Number.isFinite(workout.durationMin) ? workout.durationMin : 0), 0);

    host.replaceChildren(
      h('p', { class: 'dashboard-date' }, `Today · ${formatLocalDate(today)}`),
      h('section', { class: `card diary-summary dashboard-nutrition${over ? ' dashboard-nutrition--over' : ''}`, 'aria-labelledby': 'dashboard-nutrition-title' },
        h('div', { class: 'dashboard-card-head' },
          h('h2', { id: 'dashboard-nutrition-title' }, 'Today’s nutrition'),
          h('a', { href: '#food', class: 'button button--small button--ghost' }, 'Food diary'),
        ),
        h('div', { class: 'diary-summary__main' },
          h('div', { class: `diary-gauge diary-gauge--apple${over ? ' diary-gauge--over' : ''}`, id: 'dashboard-apple', dataset: { fill: String(comparable ? Math.min(100, Math.round((logged / reference.kcal) * 100)) : 0) } },
            appleGauge(comparable ? logged / reference.kcal : 0, over),
            h('div', { class: 'diary-gauge__label' },
              h('strong', {}, comparable ? formatNumber(Math.abs(remaining)) : '—'),
              h('span', {}, comparable ? (remaining < 0 ? 'kcal over' : 'kcal left') : 'No comparison'),
            ),
          ),
          h('div', { class: 'diary-summary__energy' },
            h('p', { class: 'summary-label' }, 'Logged'),
            h('p', { class: 'stat__value', id: 'dashboard-logged' }, energyLabel(day)),
            h('hr', { class: 'dashboard-rule' }),
            h('p', { class: 'summary-label' }, reference?.goal ? 'Daily budget for your goal' : 'Daily budget (estimate)'),
            reference
              ? h('p', { class: 'stat__value', id: 'dashboard-budget' }, `${formatNumber(reference.kcal)} kcal`)
              : h('p', { class: 'muted small' }, 'Add your profile details below to see your estimated budget.'),
            day.missing.energy > 0 ? h('p', { class: 'muted small' }, 'Some calorie values are missing.') : null,
          ),
        ),
        h('div', { class: 'dashboard-card-head dashboard-macros-head' }, h('h3', {}, 'Macros'), h('span', { class: 'muted small' }, guide ? 'Logged today, against a guide amount' : 'Logged today')),
        h('dl', { class: 'macro-grid', 'aria-label': 'Macronutrients and fibre' }, macroTiles(day, guide)),
      ),
      h('div', { class: 'dashboard-log-grid' },
        h('section', { class: 'card dashboard-activity', 'aria-labelledby': 'dashboard-activity-title' },
          h('h2', { id: 'dashboard-activity-title' }, 'Activity'),
          h('p', { class: 'stat__value' }, `${formatNumber(minutes)} min`),
          h('p', { class: 'muted small' }, 'Logged today'),
          h('button', { type: 'button', class: 'button button--small', onclick: addExercise }, 'Log exercise'),
        ),
        h('section', { class: 'card', 'aria-labelledby': 'dashboard-meals-title' },
          h('h2', { id: 'dashboard-meals-title' }, 'Meals'),
          h('ul', { class: 'dashboard-meals' }, MEALS.map((meal) => {
            const mealDay = sumNutrients(entries.filter((entry) => entry.meal === meal.id));
            return h('li', {},
              h('button', { type: 'button', class: 'dashboard-meal', onclick: () => addFood(meal.id) },
                h('strong', {}, meal.label),
                h('span', {}, mealDay.count ? energyLabel(mealDay) : 'Add food'),
                h('span', { class: 'dashboard-meal-plus', 'aria-hidden': 'true' }, '+'),
              ),
            );
          })),
        ),
      ),
    );
  }

  store.subscribe(render);
  return { render };
}
