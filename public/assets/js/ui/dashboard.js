// Today's snapshot uses the same saved entries and nutrition estimates as the diary.
import { MEALS } from '../lib/food.js';
import { sumNutrients } from '../lib/nutrients.js';
import { formatLocalDate, toLocalDateString } from '../lib/dates.js';
import { $, h, formatNumber } from './dom.js';
import { diaryEnergyReference, diaryMacros } from './food.js';
import { calorieApple } from './chart.js';

function energyLabel({ totals, missing, count }) {
  if (count > 0 && missing.energy === count) return 'Unknown';
  return `${missing.energy ? '≥ ' : ''}${formatNumber(Math.round(totals.energy))} kcal`;
}

export function initDashboard(store, addFood, addExercise) {
  const host = $('#daily-dashboard');
  let exerciseCreditDate = null;
  let renderedDate = null;

  function render() {
    const today = toLocalDateString();
    renderedDate = today;
    const entries = store.diaryFor(today);
    const day = sumNutrients(entries);
    const reference = diaryEnergyReference(store.profile);
    const logged = Math.round(day.totals.energy);
    const workouts = store.workouts.filter((workout) => workout.localDate === today);
    const minutes = workouts.reduce((sum, workout) => sum + (Number.isFinite(workout.durationMin) ? workout.durationMin : 0), 0);
    const exerciseKcal = workouts.reduce((sum, workout) => sum + (Number.isFinite(workout.estimatedActiveKcal) ? Math.max(0, workout.estimatedActiveKcal) : 0), 0);
    const includesExercise = exerciseCreditDate === today;
    const budget = (reference?.kcal ?? 0) + (reference && includesExercise ? exerciseKcal : 0);
    const comparable = budget > 0 && day.missing.energy === 0;
    const remaining = comparable ? budget - logged : 0;
    const adjustment = reference ? reference.kcal - reference.maintenance : 0;

    function toggleExercise(event) {
      exerciseCreditDate = event.target.checked ? today : null;
      render();
      $('#dashboard-exercise-credit')?.focus();
    }

    host.replaceChildren(
      h('p', { class: 'dashboard-date' }, `Today · ${formatLocalDate(today)}`),
      h('section', { class: 'card diary-summary dashboard-nutrition', 'aria-labelledby': 'dashboard-nutrition-title' },
        h('div', { class: 'dashboard-card-head' },
          h('h2', { id: 'dashboard-nutrition-title' }, 'Today’s nutrition'),
          h('a', { href: '#food', class: 'button button--small button--ghost' }, 'Food diary'),
        ),
        h('div', { class: 'diary-summary__main' },
          h('div', { class: 'dashboard-apple' },
            calorieApple(comparable ? logged / budget : 0, remaining < 0),
          ),
          h('div', { class: 'diary-summary__energy' },
            h('p', { class: 'summary-label' }, comparable ? 'Calories logged' : 'Calories logged so far'),
            h('p', { class: 'muted small' }, energyLabel(day)),
            h('p', { class: remaining < 0 ? 'stat__value dashboard-calories-over' : 'stat__value' },
              comparable ? `${formatNumber(Math.abs(remaining))} kcal ${remaining < 0 ? 'over' : 'left'}` : '—',
            ),
            h('p', { class: 'muted small' }, !reference
              ? (store.profile ? 'A calorie estimate is unavailable for this profile.' : 'Complete setup to see your estimated budget.')
              : day.missing.energy > 0 ? 'Some calorie values are missing.' : 'Against today’s estimated budget.'),
          ),
        ),
        reference ? h('dl', { class: 'dashboard-budget' },
          h('div', {}, h('dt', {}, 'Maintenance'), h('dd', {}, `${formatNumber(reference.maintenance)} kcal`)),
          h('div', {}, h('dt', {}, 'Goal budget'), h('dd', {}, `${formatNumber(reference.kcal)} kcal`)),
          h('div', {}, h('dt', {}, adjustment < 0 ? 'Planned deficit' : adjustment > 0 ? 'Planned surplus' : 'Goal adjustment'),
            h('dd', {}, `${adjustment < 0 ? '−' : adjustment > 0 ? '+' : ''}${formatNumber(Math.abs(adjustment))} kcal`)),
          includesExercise && exerciseKcal > 0 ? h('div', {}, h('dt', {}, 'Adjusted budget'), h('dd', {}, `${formatNumber(budget)} kcal`)) : null,
        ) : null,
        h('dl', { class: 'macro-grid', 'aria-label': 'Macronutrients and fibre' }, diaryMacros(day)),
        reference && !store.profile.goal ? h('button', { type: 'button', class: 'button button--small dashboard-set-goal', onclick: () => {
          const details = $('#goal-card details');
          if (details) {
            details.open = true;
            details.querySelector('summary').focus();
          }
        } }, 'Set your weight goal') : null,
      ),
      h('div', { class: 'dashboard-log-grid' },
        h('section', { class: 'card dashboard-activity', 'aria-labelledby': 'dashboard-activity-title' },
          h('h2', { id: 'dashboard-activity-title' }, 'Activity'),
          h('p', { class: 'stat__value' }, `${formatNumber(minutes)} min`),
          h('p', { class: 'muted small' }, 'Logged today'),
          h('button', { type: 'button', class: 'button button--small', onclick: addExercise }, 'Log exercise'),
          h('div', { class: 'dashboard-exercise-credit' },
            h('p', { class: 'muted small' }, exerciseKcal > 0
              ? `About ${formatNumber(exerciseKcal)} kcal estimated from today’s logged exercise.`
              : 'Enable the active calorie estimate when logging exercise to see its energy here.'),
            reference && exerciseKcal > 0 ? h('label', { class: 'checkbox' },
              h('input', { type: 'checkbox', id: 'dashboard-exercise-credit', checked: includesExercise, onchange: toggleExercise, 'aria-describedby': 'dashboard-exercise-hint' }),
              'Add this to today’s budget',
            ) : null,
            reference && exerciseKcal > 0 ? h('p', { class: 'hint', id: 'dashboard-exercise-hint' },
              'Use only if these estimates are for extra exercise. Your usual activity is already included in maintenance. This choice lasts while the app is open.',
            ) : null,
          ),
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && renderedDate !== toLocalDateString()) render();
  });
  return { render };
}
