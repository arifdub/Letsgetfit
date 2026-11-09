// Weight trend chart: daily readings (dots, series 2) and the 7-day average (line, series 1).
// Colours come from CSS tokens validated for both themes (see docs/ARCHITECTURE.md).
// Interaction: pointer crosshair + tooltip; keyboard arrows move between days. A table view is
// provided next to the chart by the caller.

import { h, formatWeight } from './dom.js';
import { formatLocalDate, parseLocalDate } from '../lib/dates.js';
import { KG_PER_POUND } from '../lib/units.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

function niceTicks(min, max, count = 4) {
  const span = Math.max(max - min, 0.5);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

const shortDate = (d) => parseLocalDate(d).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });

/**
 * @param {HTMLElement} container
 * @param {Array<{localDate, weightKg, trendKg}>} points  ascending by date
 * @param {'metric'|'imperial'} units
 */
export function renderWeightChart(container, points, units) {
  const toUnit = (kg) => (units === 'imperial' ? kg / KG_PER_POUND : kg);
  const unitLabel = units === 'imperial' ? 'lb' : 'kg';
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const tooltip = h('div', { class: 'chart-tooltip', role: 'presentation', hidden: true });
  const frame = h('div', { class: 'chart-frame' });
  container.replaceChildren(
    h(
      'div',
      { class: 'chart-legend', 'aria-hidden': 'true' },
      h('span', { class: 'legend-item' }, h('span', { class: 'legend-swatch legend-swatch--dot' }), 'Daily reading'),
      h('span', { class: 'legend-item' }, h('span', { class: 'legend-swatch legend-swatch--line' }), '7-day average'),
      h('span', { class: 'legend-unit' }, `Weight in ${unitLabel}`),
    ),
    frame,
    live,
  );
  frame.append(tooltip);

  let focusIndex = points.length - 1;

  function draw() {
    const width = Math.max(280, Math.round(frame.clientWidth || 600));
    const height = Math.round(Math.min(280, Math.max(200, width * 0.5)));
    const pad = { top: 12, right: 16, bottom: 28, left: 44 };
    const t0 = parseLocalDate(points[0].localDate).getTime();
    const t1 = parseLocalDate(points[points.length - 1].localDate).getTime();
    const values = points.flatMap((p) => [toUnit(p.weightKg), toUnit(p.trendKg)]);
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const x = (d) => pad.left + (t1 === t0 ? (width - pad.left - pad.right) / 2 : ((parseLocalDate(d).getTime() - t0) / (t1 - t0)) * (width - pad.left - pad.right));
    const y = (v) => pad.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (height - pad.top - pad.bottom);

    const root = svg('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      class: 'chart',
      tabindex: 0,
      role: 'img',
      'aria-label': `Weight chart from ${formatLocalDate(points[0].localDate)} to ${formatLocalDate(points[points.length - 1].localDate)}, ${points.length} readings. Use the left and right arrow keys to read each day. The same data is in the table below.`,
    });
    // Grid and y labels (recessive).
    for (const v of ticks) {
      root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v), class: 'chart-grid' }));
      const label = svg('text', { x: pad.left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'chart-axis' });
      label.textContent = `${v}`;
      root.append(label);
    }
    // x labels: first, middle, last.
    const idx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    idx.forEach((i, n) => {
      const label = svg('text', { x: x(points[i].localDate), y: height - 8, 'text-anchor': n === 0 ? 'start' : n === idx.length - 1 ? 'end' : 'middle', class: 'chart-axis' });
      label.textContent = shortDate(points[i].localDate);
      root.append(label);
    });
    // Trend line.
    if (points.length > 1) {
      root.append(svg('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${x(p.localDate).toFixed(1)},${y(toUnit(p.trendKg)).toFixed(1)}`).join(' '), class: 'chart-trend' }));
    }
    // Readings.
    for (const p of points) root.append(svg('circle', { cx: x(p.localDate), cy: y(toUnit(p.weightKg)), r: 4, class: 'chart-dot' }));
    // Hover layer.
    const cross = svg('line', { y1: pad.top, y2: height - pad.bottom, class: 'chart-cross', visibility: 'hidden' });
    const ring = svg('circle', { r: 6, class: 'chart-focus', visibility: 'hidden' });
    root.append(cross, ring);
    const hit = svg('rect', { x: pad.left - 8, y: 0, width: width - pad.left - pad.right + 16, height, fill: 'transparent' });
    root.append(hit);

    function show(i, announce) {
      const p = points[i];
      const cx = x(p.localDate);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      ring.setAttribute('cx', cx);
      ring.setAttribute('cy', y(toUnit(p.weightKg)));
      ring.setAttribute('visibility', 'visible');
      tooltip.replaceChildren(
        h('strong', {}, formatLocalDate(p.localDate)),
        h('span', {}, `Reading: ${formatWeight(p.weightKg, units)}`),
        h('span', {}, `7-day average: ${formatWeight(p.trendKg, units)}`),
      );
      tooltip.hidden = false;
      const left = Math.min(Math.max(cx - 80, 0), width - 170);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = '4px';
      if (announce) live.textContent = `${formatLocalDate(p.localDate)}: reading ${formatWeight(p.weightKg, units)}, 7-day average ${formatWeight(p.trendKg, units)}.`;
    }
    function hide() {
      cross.setAttribute('visibility', 'hidden');
      ring.setAttribute('visibility', 'hidden');
      tooltip.hidden = true;
    }
    function nearest(clientX) {
      const box = root.getBoundingClientRect();
      const px = ((clientX - box.left) / box.width) * width;
      let best = 0;
      for (let i = 1; i < points.length; i += 1) if (Math.abs(x(points[i].localDate) - px) < Math.abs(x(points[best].localDate) - px)) best = i;
      return best;
    }
    hit.addEventListener('pointermove', (e) => show(nearest(e.clientX), false));
    hit.addEventListener('pointerdown', (e) => show(nearest(e.clientX), false));
    hit.addEventListener('pointerleave', hide);
    root.addEventListener('focus', () => show(focusIndex, true));
    root.addEventListener('blur', hide);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        if (e.key === 'ArrowLeft') focusIndex = Math.max(0, focusIndex - 1);
        if (e.key === 'ArrowRight') focusIndex = Math.min(points.length - 1, focusIndex + 1);
        if (e.key === 'Home') focusIndex = 0;
        if (e.key === 'End') focusIndex = points.length - 1;
        show(focusIndex, true);
      } else if (e.key === 'Escape') hide();
    });
    frame.replaceChildren(root, tooltip);
  }

  draw();
  if (typeof ResizeObserver === 'function') {
    let last = frame.clientWidth;
    const ro = new ResizeObserver(() => {
      if (!frame.isConnected) {
        ro.disconnect();
        return;
      }
      if (Math.abs(frame.clientWidth - last) > 8) {
        last = frame.clientWidth;
        draw();
      }
    });
    ro.observe(frame);
  }
}
