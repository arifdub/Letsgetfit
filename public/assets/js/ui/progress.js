// Progress view additions: weight trend (chart + table) and weekly training summaries.

import { weightTrend, trendChange, weeklySummaries, TREND_WINDOW_DAYS } from '../lib/training.js';
import { ACTIVITY_GUIDELINE } from '../lib/exercises.js';
import { formatLocalDate, parseLocalDate } from '../lib/dates.js';
import { KG_PER_POUND } from '../lib/units.js';
import { $, h, formatNumber, formatWeight, emptyState } from './dom.js';
import { renderWeightChart } from './chart.js';

const shortDate = (d) => parseLocalDate(d).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });

function signed(kg, units) {
  const value = units === 'imperial' ? kg / KG_PER_POUND : kg;
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(rounded), 1)} ${units === 'imperial' ? 'lb' : 'kg'}`;
}

export function weekLabel(w) {
  return `${shortDate(w.weekStart)} – ${shortDate(w.weekEnd)}`;
}

export function initProgress(store) {
  const trendCard = $('#trend-card');
  const weeklyCard = $('#weekly-card');

  function renderTrend() {
    const points = weightTrend(store.weights);
    const units = store.units;
    const body = [h('h2', {}, 'Weight trend')];
    if (points.length < 2) {
      body.push(emptyState('Not enough entries yet', 'Add at least two weight entries on different days to see a chart. A few entries a week give the clearest trend.'));
      trendCard.replaceChildren(...body);
      return;
    }
    const change = trendChange(points);
    const latest = points[points.length - 1];
    body.push(
      h(
        'p',
        { id: 'trend-summary' },
        change
          ? `Your ${TREND_WINDOW_DAYS}-day average changed by ${signed(change.changeKg, units)} over the last ${change.days} days. It is ${formatWeight(latest.trendKg, units)} now.`
          : `Your ${TREND_WINDOW_DAYS}-day average is ${formatWeight(latest.trendKg, units)}. A change over time is shown once you have at least 4 entries across 3 weeks or more.`,
      ),
      h('p', { class: 'muted small' }, 'The line is the average of your entries over the previous 7 days, which smooths out day-to-day changes from fluid, food and timing. Single readings are shown as dots.'),
    );
    const chartHost = h('div', { class: 'chart-host', id: 'weight-chart' });
    body.push(chartHost);
    body.push(
      h(
        'details',
        { class: 'disclosure' },
        h('summary', {}, 'Show as a table'),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'table', id: 'trend-table' },
            h('caption', { class: 'visually-hidden' }, 'Weight readings and 7-day average'),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Reading'), h('th', { scope: 'col' }, '7-day average'))),
            h(
              'tbody',
              {},
              [...points].reverse().map((p) => h('tr', {}, h('th', { scope: 'row' }, formatLocalDate(p.localDate)), h('td', {}, formatWeight(p.weightKg, units)), h('td', {}, formatWeight(p.trendKg, units)))),
            ),
          ),
        ),
      ),
    );
    trendCard.replaceChildren(...body);
    renderWeightChart(chartHost, points, units);
  }

  function renderWeekly() {
    const weeks = weeklySummaries(store.workouts, { weeks: 8 });
    const any = weeks.some((w) => w.workouts > 0);
    weeklyCard.replaceChildren(
      h('h2', {}, 'Weekly summary'),
      any
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 'table', id: 'weekly-table' },
              h('caption', { class: 'visually-hidden' }, 'Training per week, most recent first'),
              h(
                'thead',
                {},
                h('tr', {}, h('th', { scope: 'col' }, 'Week'), h('th', { scope: 'col' }, 'Workouts'), h('th', { scope: 'col' }, 'Active minutes'), h('th', { scope: 'col' }, 'Strength days'), h('th', { scope: 'col' }, 'Sets')),
              ),
              h(
                'tbody',
                {},
                weeks.map((w, i) =>
                  h(
                    'tr',
                    { dataset: { week: w.weekStart } },
                    h('th', { scope: 'row' }, i === 0 ? `This week (${weekLabel(w)})` : weekLabel(w)),
                    h('td', {}, String(w.workouts)),
                    h('td', {}, formatNumber(w.minutes)),
                    h('td', {}, String(w.strengthDays)),
                    h('td', {}, String(w.sets)),
                  ),
                ),
              ),
            ),
          )
        : emptyState('No training logged yet', 'Log a workout or a training session on the Workouts page and your weeks will appear here.'),
      h(
        'p',
        { class: 'muted small' },
        `For comparison, the WHO guideline for adults is at least ${ACTIVITY_GUIDELINE.moderateMinutes} minutes of moderate activity a week, plus muscle strengthening on ${ACTIVITY_GUIDELINE.strengthDays} or more days. Active minutes here are the durations you logged. Weeks run Monday to Sunday.`,
      ),
    );
  }

  function render() {
    renderTrend();
    renderWeekly();
  }
  store.subscribe(render);
  window.addEventListener('hashchange', () => {
    // Re-draw so the chart measures its real width once the view is visible.
    if (location.hash === '#progress') renderTrend();
  });
  render();
  return { render };
}
