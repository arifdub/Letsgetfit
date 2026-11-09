// CSV export (RFC 4180 quoting) with protection against spreadsheet formula injection:
// text cells starting with = + - @ (or tab/carriage return) are prefixed with an apostrophe.
// Numbers are written as plain numbers. Rows end with CRLF; a UTF-8 BOM helps Excel.

import { sessionStats } from './training.js';
import { NUTRIENTS } from './nutrients.js';

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

export function workoutsCsv(workouts) {
  return toCsv(
    [
      { label: 'date', value: (w) => w.localDate },
      { label: 'type', value: (w) => w.type ?? 'activity' },
      { label: 'name', value: (w) => (w.type === 'session' ? w.title : w.activityLabel ?? w.activityId) },
      { label: 'duration_min', value: (w) => w.durationMin },
      { label: 'effort_rpe_1_10', value: (w) => w.sessionRpe ?? null },
      { label: 'sets', value: (w) => (w.type === 'session' ? sessionStats(w).sets : null) },
      { label: 'volume_kg', value: (w) => (w.type === 'session' ? r2(sessionStats(w).volumeKg) : null) },
      { label: 'estimated_active_kcal', value: (w) => w.estimatedActiveKcal ?? null },
      { label: 'notes', value: (w) => w.notes ?? '' },
      { label: 'id', value: (w) => w.id },
    ],
    [...workouts].sort((a, b) => a.localDate.localeCompare(b.localDate)),
  );
}

export function setsCsv(workouts) {
  const rows = [];
  for (const w of [...workouts].sort((a, b) => a.localDate.localeCompare(b.localDate))) {
    if (w.type !== 'session') continue;
    for (const ex of w.exercises ?? []) {
      ex.sets.forEach((s, i) => rows.push({ w, ex, s, i }));
    }
  }
  return toCsv(
    [
      { label: 'date', value: (r) => r.w.localDate },
      { label: 'session', value: (r) => r.w.title },
      { label: 'exercise', value: (r) => r.ex.name },
      { label: 'set', value: (r) => r.i + 1 },
      { label: 'reps', value: (r) => r.s.reps ?? null },
      { label: 'load_kg', value: (r) => r.s.loadKg ?? null },
      { label: 'duration_sec', value: (r) => r.s.durationSec ?? null },
      { label: 'session_id', value: (r) => r.w.id },
    ],
    rows,
  );
}

export function weightsCsv(weights) {
  return toCsv(
    [
      { label: 'date', value: (w) => w.localDate },
      { label: 'weight_kg', value: (w) => w.weightKg },
      { label: 'notes', value: (w) => w.notes ?? '' },
      { label: 'id', value: (w) => w.id },
    ],
    [...weights].sort((a, b) => a.localDate.localeCompare(b.localDate)),
  );
}

export function diaryCsv(diary) {
  return toCsv(
    [
      { label: 'date', value: (e) => e.localDate },
      { label: 'meal', value: (e) => e.meal },
      { label: 'food', value: (e) => e.name },
      { label: 'brand', value: (e) => e.brand ?? '' },
      { label: 'source', value: (e) => e.source },
      { label: 'source_id', value: (e) => e.sourceId ?? '' },
      { label: 'amount_g', value: (e) => e.servingG },
      ...NUTRIENTS.map((n) => ({ label: `${n.key}_${n.unit.replace('µ', 'u')}`, value: (e) => r2(e.nutrients?.[n.key]) })),
      { label: 'id', value: (e) => e.id },
    ],
    [...diary].sort((a, b) => a.localDate.localeCompare(b.localDate)),
  );
}
