// Small DOM helpers. Text is always set with textContent, never innerHTML, so user notes
// cannot inject markup.

import { roundTo, cmToFeetInches, kgToStonePounds, kcalToKj } from '../lib/units.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** h('p', { class: 'x' }, 'text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const numberFormatters = new Map();
export function formatNumber(value, maxDigits = 0) {
  if (!numberFormatters.has(maxDigits)) {
    numberFormatters.set(maxDigits, new Intl.NumberFormat('en-IE', { maximumFractionDigits: maxDigits, minimumFractionDigits: 0 }));
  }
  return numberFormatters.get(maxDigits).format(value);
}

export function formatKcal(kcal) {
  return `${formatNumber(kcal)} kcal`;
}

export function formatKj(kcal) {
  return `${formatNumber(Math.round(kcalToKj(kcal) / 10) * 10)} kJ`;
}

export function formatWeight(kg, units) {
  if (units === 'imperial') {
    const { stone, pounds } = kgToStonePounds(kg);
    return `${stone} st ${pounds} lb`;
  }
  return `${formatNumber(roundTo(kg, 1), 1)} kg`;
}

export function formatHeight(cm, units) {
  if (units === 'imperial') {
    const { feet, inches } = cmToFeetInches(cm);
    return `${feet} ft ${inches} in`;
  }
  return `${formatNumber(roundTo(cm, 1), 1)} cm`;
}

/** Show or hide the metric / imperial input groups inside a container. */
export function applyUnitsVisibility(root, units) {
  for (const el of $$('.units-metric', root)) el.hidden = units !== 'metric';
  for (const el of $$('.units-imperial', root)) el.hidden = units !== 'imperial';
}

/**
 * Display validation errors on a form.
 * @param {HTMLFormElement} form
 * @param {Record<string,string>} errors  field name -> message
 * @param {(field:string)=>string} errorId  maps a field to its error element id
 * @param {(field:string)=>HTMLElement|null} focusTarget  first input for a field
 */
export function showFormErrors(form, errors, { summary, errorId, focusTarget, labels }) {
  clearFormErrors(form, summary);
  const entries = Object.entries(errors);
  if (entries.length === 0) return;
  const list = $('ul', summary);
  for (const [field, message] of entries) {
    const errorEl = document.getElementById(errorId(field));
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
    const wrapper = form.querySelector(`[data-field="${field}"]`);
    wrapper?.classList.add('field--invalid');
    for (const input of wrapper ? $$('input, select', wrapper) : []) input.setAttribute('aria-invalid', 'true');
    const target = focusTarget(field);
    const link = h('a', { href: target?.id ? `#${target.id}` : '#' }, `${labels[field] ?? field}: ${message}`);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      target?.focus();
    });
    list.append(h('li', {}, link));
  }
  summary.hidden = false;
  summary.focus();
}

export function clearFormErrors(form, summary) {
  if (summary) {
    summary.hidden = true;
    $('ul', summary).replaceChildren();
  }
  for (const el of $$('.field-error', form)) {
    el.hidden = true;
    el.textContent = '';
  }
  for (const el of $$('.field--invalid', form)) el.classList.remove('field--invalid');
  for (const el of $$('[aria-invalid]', form)) el.removeAttribute('aria-invalid');
}

let toastTimer;
export function toast(message, kind = 'success') {
  const region = document.getElementById('toast');
  clearTimeout(toastTimer);
  region.replaceChildren(h('div', { class: `toast toast--${kind}` }, message));
  toastTimer = setTimeout(() => region.replaceChildren(), 5000);
}

/** Accessible confirmation using <dialog>; falls back to window.confirm. */
export function confirmAction({ title, body, confirmLabel = 'Delete' }) {
  const dialog = document.getElementById('confirm-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${body}`));
  }
  $('#confirm-title', dialog).textContent = title;
  $('#confirm-body', dialog).textContent = body;
  $('#confirm-ok', dialog).textContent = confirmLabel;
  const opener = document.activeElement;
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        resolve(dialog.returnValue === 'confirm');
      },
      { once: true },
    );
  });
}

export function emptyState(title, body, action) {
  return h('div', { class: 'state state--empty' }, h('p', { class: 'state__title' }, title), h('p', {}, body), action ?? null);
}

/** Read all named form controls into a plain object of strings / booleans. */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
      else if (!(el.name in out)) out[el.name] = '';
    } else if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  }
  return out;
}
