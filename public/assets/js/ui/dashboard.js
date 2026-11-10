// Today's snapshot uses the same saved entries and nutrition estimates as the diary.
import { MEALS } from '../lib/food.js';
import { sumNutrients } from '../lib/nutrients.js';
import { formatLocalDate, toLocalDateString } from '../lib/dates.js';
import { $, h, formatNumber } from './dom.js';
import { diaryEnergyReference, diaryMacros } from './food.js';
import { summaryRing } from './chart.js';

function energyLabel({ totals, missing, count }) {
  if (count > 0 && missing.energy === count) return 'Unknown';
  return `${missing.energy ? '≥ ' : ''}${formatNumber(Math.round(totals.energy))} kcal`;
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
    const minutes = store.workouts
      .filter((workout) => workout.localDate === today)
      .reduce((sum, workout) => sum + (Number.isFinite(workout.durationMin) ? workout.durationMin : 0), 0);

    host.replaceChildren(
      h('p', { class: 'dashboard-date' }, `Today · ${formatLocalDate(today)}`),
      h('section', { class: 'card diary-summary dashboard-nutrition', 'aria-labelledby': 'dashboard-nutrition-title' },
        h('div', { class: 'dashboard-card-head' },
          h('h2', { id: 'dashboard-nutrition-title' }, 'Today’s nutrition'),
          h('a', { href: '#food', class: 'button button--small button--ghost' }, 'Food diary'),
        ),
        h('div', { class: 'diary-summary__main' },
          h('div', { class: 'diary-gauge' },
            summaryRing(comparable ? logged / reference.kcal : 0, remaining < 0),
            h('div', { class: 'diary-gauge__label' },
              h('strong', {}, comparable ? formatNumber(Math.abs(remaining)) : '—'),
              h('span', {}, comparable ? (remaining < 0 ? 'kcal over' : 'kcal left') : 'No comparison'),
            ),
          ),
          h('div', { class: 'diary-summary__energy' },
            h('p', { class: 'summary-label' }, 'Calories logged'),
            h('p', { class: 'stat__value' }, energyLabel(day)),
            h('p', { class: 'muted small' }, reference
              ? `${formatNumber(reference.kcal)} kcal estimated daily budget`
              : 'Add your profile details below to see your estimated budget.'),
            day.missing.energy > 0 ? h('p', { class: 'muted small' }, 'Some calorie values are missing.') : null,
          ),
        ),
        h('dl', { class: 'macro-grid', 'aria-label': 'Macronutrients and fibre' }, diaryMacros(day)),
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
