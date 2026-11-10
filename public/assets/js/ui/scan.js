// "Scan photo" in the add-food panel: choose or take a photo, consent, analyse, review and
// correct every item and amount, then confirm before anything is saved.

import { scanMeal, sendScanFeedback } from '../api/scan.js';
import { searchFoods, getScanProviders } from '../api/foods.js';
import { feedbackCounts } from '../lib/scan-feedback.js';
import { NUTRIENTS, scaleNutrients, sumNutrients } from '../lib/nutrients.js';
import { buildDiaryEntry, MEALS } from '../lib/food.js';
import { createId } from '../storage/store.js';
import { h, formatNumber, toast } from './dom.js';

const MAX_SIDE = 1600;

/** Re-encode in the browser: applies orientation, shrinks, and drops all photo metadata. */
export async function preparePhoto(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Choose a photo (JPEG, PNG or WebP).');
  if (file.size > 25_000_000) throw new Error('That photo is too large.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This photo format could not be read. Try a JPEG, or take the photo again.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('This photo could not be prepared. Try another one.');
  return blob;
}

const mealLabel = (id) => MEALS.find((m) => m.id === id)?.label.toLowerCase() ?? id;

const providerName = (label) => (label === 'Claude (Anthropic)' ? 'Anthropic (Claude)' : label || 'the AI service');

/** "OpenAI", "Anthropic (Claude)", or both when the site alternates between them. */
export function providerText(list) {
  if (!list.length) return 'an AI service';
  if (list.length === 1) return providerName(list[0]);
  return `${list.map(providerName).join(' or ')} (the site uses both, to compare them)`;
}

export function scanPanel({ store, meal, localDate, saveToLibrary, onSaved, onManual }) {
  let providers = [];
  getScanProviders().then((list) => {
    providers = list;
  });
  const root = h('div', { class: 'scan', id: 'scan-panel' });
  let photo = null; // prepared JPEG blob
  let previewUrl = null;
  let requestId = null;
  let controller = null;
  let result = null;
  let rows = []; // { name, grams, low, high, candidates, chosen (index or -1), removed }

  /** Replace the panel's content, skipping optional parts that are null. */
  function show(...nodes) {
    root.replaceChildren(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
  }

  function cleanup() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  /* ---------- Step 1: pick ---------- */
  function renderPick(message) {
    const take = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'scan-camera', class: 'visually-hidden' });
    const pick = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', id: 'scan-file', class: 'visually-hidden' });
    for (const input of [take, pick]) input.addEventListener('change', () => choose(input.files?.[0]));
    show(
      h('p', {}, 'Take or choose a photo of your meal. The app suggests the foods and amounts, and you check and correct them before anything is saved.'),
      message ? h('p', { class: 'notice-inline notice-inline--error', id: 'scan-error', role: 'alert' }, message) : null,
      h(
        'div',
        { class: 'form__actions' },
        h('label', { for: 'scan-camera', class: 'button button--primary' }, 'Take a photo'),
        take,
        h('label', { for: 'scan-file', class: 'button' }, 'Choose a photo'),
        pick,
      ),
      manualLink(),
    );
  }

  async function choose(file) {
    if (!file) return;
    try {
      photo = await preparePhoto(file);
    } catch (error) {
      renderPick(error.message);
      return;
    }
    cleanup();
    previewUrl = URL.createObjectURL(photo);
    requestId = createId(); // one ID per photo: a retry or double tap never charges twice
    renderConsent();
  }

  /* ---------- Step 2: consent ---------- */
  function renderConsent(message) {
    const analyse = h('button', { type: 'button', class: 'button button--primary', id: 'scan-analyse' }, 'Send photo and analyse');
    analyse.addEventListener('click', () => analyseNow(analyse));
    const other = h('button', { type: 'button', class: 'button button--ghost' }, 'Choose another photo');
    other.addEventListener('click', () => renderPick());
    show(
      h('img', { src: previewUrl, alt: 'Your meal photo', class: 'scan-preview' }),
      message ? h('p', { class: 'notice-inline notice-inline--error', id: 'scan-error', role: 'alert' }, message) : null,
      h(
        'div',
        { class: 'notice-inline', id: 'scan-consent' },
        h('p', {}, h('strong', {}, 'Before you send this photo')),
        h(
          'ul',
          { class: 'bullets small' },
          h('li', { id: 'scan-provider-text' }, `It goes to our server, which removes location and camera details, and then to ${providerText(providers)}, which suggests the foods and amounts.`),
          h('li', {}, `We do not keep the photo. ${providers.length > 1 ? 'Both companies say they do' : `${providerName(providers[0])} says it does`} not use API data to train ${providers.length > 1 ? 'their models' : 'its models'}, and may keep it for a limited time to check for abuse.`),
          h('li', {}, 'Suggestions can be wrong. A photo cannot show allergens, exact amounts or hidden ingredients.'),
        ),
        h('p', { class: 'small' }, 'Do not send photos of people or anything private. ', h('a', { href: 'privacy.html' }, 'Privacy notice'), '.'),
      ),
      h('div', { class: 'form__actions' }, analyse, other),
      manualLink(),
    );
    analyse.focus();
  }

  async function analyseNow(button) {
    if (controller) return; // already sending
    button.disabled = true;
    controller = new AbortController();
    const cancel = h('button', { type: 'button', class: 'button button--ghost', id: 'scan-cancel' }, 'Cancel');
    cancel.addEventListener('click', () => controller?.abort());
    show(
      h('img', { src: previewUrl, alt: 'Your meal photo', class: 'scan-preview' }),
      h('p', { class: 'state state--loading', role: 'status', id: 'scan-loading' }, 'Analysing your photo. This can take up to 30 seconds…'),
      h('div', { class: 'form__actions' }, cancel),
    );
    try {
      result = await scanMeal(photo, { requestId, signal: controller.signal });
    } catch (error) {
      controller = null;
      if (error.code === 'cancelled') renderConsent();
      else renderConsent(error.message);
      return;
    }
    controller = null;
    rows = result.items.map((item) => ({ name: item.name, grams: item.gramsEstimate, suggestedGrams: item.gramsEstimate, suggested: true, low: item.gramsLow, high: item.gramsHigh, confidence: item.confidence, candidates: item.candidates, chosen: item.candidates.length ? 0 : -1, removed: false }));
    renderReview();
  }

  /* ---------- Step 3: review and confirm ---------- */
  function renderReview(errorMessage) {
    if (!result.isFood || result.imageQuality === 'unusable') {
      const again = h('button', { type: 'button', class: 'button' }, 'Try another photo');
      again.addEventListener('click', () => renderPick());
      show(
        h('p', { class: 'notice-inline', id: 'scan-nothing', role: 'status' }, result.isFood ? 'The photo is too unclear to identify the food.' : 'No food or drink was found in this photo.'),
        h('div', { class: 'form__actions' }, again),
        manualLink(),
      );
      return;
    }
    const list = h(
      'ol',
      { class: 'scan-items', 'aria-label': 'Foods found in the photo' },
      rows.map((row, i) => (row.removed ? null : itemRow(row, i))),
    );
    const totalsHost = h('div', { id: 'scan-totals', 'aria-live': 'polite' });
    const confirm = h('input', { type: 'checkbox', id: 'scan-confirm' });
    const save = h('button', { type: 'button', class: 'button button--primary', id: 'scan-save' }, `Add to ${mealLabel(meal)}`);
    save.addEventListener('click', () => saveAll(confirm, save));
    show(
      h('img', { src: previewUrl, alt: 'Your meal photo', class: 'scan-preview scan-preview--small' }),
      result.imageQuality === 'poor' ? h('p', { class: 'notice-inline' }, 'The photo is not very clear, so check each item carefully.') : null,
      h('p', { class: 'small muted', id: 'scan-disclaimer' }, result.disclaimer),
      errorMessage ? h('p', { class: 'notice-inline notice-inline--error', id: 'scan-error', role: 'alert', tabindex: '-1' }, errorMessage) : null,
      list,
      addItemForm(),
      result.questions.length
        ? h(
            'div',
            { class: 'notice-inline', id: 'scan-questions' },
            h('p', {}, h('strong', {}, 'Things a photo cannot show')),
            h('ul', { class: 'bullets small' }, result.questions.map((q) => h('li', {}, q))),
            h('p', { class: 'small' }, 'If any apply, add them as an extra item above, for example 1 teaspoon (5 g) of oil.'),
          )
        : null,
      totalsHost,
      h('label', { class: 'checkbox checkbox--top', for: 'scan-confirm' }, confirm, h('span', {}, 'I have checked the foods and amounts.')),
      h('div', { class: 'form__actions' }, save),
      manualLink(),
    );
    renderTotals(totalsHost);
    if (errorMessage) root.querySelector('#scan-error')?.focus();
  }

  function itemRow(row, i) {
    const select = h(
      'select',
      { class: 'input', id: `scan-match-${i}`, 'aria-label': `Food database match for ${row.name}` },
      row.candidates.map((c, ci) => h('option', { value: String(ci), selected: ci === row.chosen }, `${c.name}${c.per100g.energy !== null ? ` · ${formatNumber(Math.round(c.per100g.energy))} kcal/100 g` : ''}`)),
      h('option', { value: '-1', selected: row.chosen === -1 }, row.candidates.length ? 'None of these' : 'No match found'),
    );
    select.addEventListener('change', () => {
      row.chosen = Number(select.value);
      renderTotals(root.querySelector('#scan-totals'));
    });
    const grams = h('input', { id: `scan-grams-${i}`, class: 'input input--short', inputmode: 'decimal', autocomplete: 'off', value: String(row.grams), 'aria-describedby': `scan-range-${i}` });
    grams.addEventListener('input', () => {
      row.grams = Number(grams.value.replace(',', '.'));
      renderTotals(root.querySelector('#scan-totals'));
    });
    const remove = h('button', { type: 'button', class: 'button button--small button--danger-ghost', 'aria-label': `Remove ${row.name}` }, 'Remove');
    remove.addEventListener('click', () => {
      row.removed = true;
      renderReview();
    });
    return h(
      'li',
      { class: 'scan-item', dataset: { index: String(i) } },
      h('p', { class: 'entry__title' }, row.name, h('span', { class: 'badge' }, `${row.confidence} confidence`)),
      h('label', { for: `scan-match-${i}` }, 'Food database match'),
      select,
      h(
        'div',
        { class: 'inline-inputs' },
        h('label', { for: `scan-grams-${i}` }, 'Amount'),
        grams,
        h('span', { class: 'unit' }, 'g'),
      ),
      h('p', { class: 'hint', id: `scan-range-${i}` }, `Estimated ${formatNumber(row.low)}–${formatNumber(row.high)} g. Weigh it if you can.`),
      remove,
    );
  }

  function addItemForm() {
    const input = h('input', { id: 'scan-add-q', class: 'input', type: 'search', placeholder: 'For example: olive oil', autocomplete: 'off' });
    const button = h('button', { type: 'button', class: 'button button--small' }, 'Find');
    const out = h('div', { id: 'scan-add-results', role: 'status' });
    button.addEventListener('click', async () => {
      const q = input.value.trim();
      if (q.length < 2) return;
      out.textContent = 'Searching…';
      try {
        const { results } = await searchFoods(q, { type: 'all' });
        out.replaceChildren(
          results.length
            ? h(
                'ul',
                { class: 'food-list' },
                results.slice(0, 5).map((food) => {
                  const b = h('button', { type: 'button', class: 'food-option' }, h('span', { class: 'food-option__name' }, food.name), food.brand ? h('span', { class: 'food-option__brand' }, food.brand) : null);
                  b.addEventListener('click', () => {
                    rows.push({ name: food.name, grams: food.servingOptions[0]?.grams ?? 10, suggested: false, low: 1, high: 2000, confidence: 'added by you', candidates: [food], chosen: 0, removed: false });
                    renderReview();
                    root.querySelector(`#scan-grams-${rows.length - 1}`)?.focus();
                  });
                  return h('li', {}, b);
                }),
              )
            : h('p', {}, 'No foods found.'),
        );
      } catch (error) {
        out.textContent = error.message;
      }
    });
    return h('details', { class: 'disclosure' }, h('summary', {}, 'Add a missing item (such as oil, butter or a sauce)'), h('div', { class: 'search-row' }, h('label', { for: 'scan-add-q', class: 'visually-hidden' }, 'Food to add'), input, button), out);
  }

  function confirmedRows() {
    return rows.filter((r) => !r.removed && r.chosen >= 0 && Number.isFinite(r.grams) && r.grams >= 1 && r.grams <= 5000);
  }

  function renderTotals(host) {
    if (!host) return;
    const entries = confirmedRows().map((r) => ({ nutrients: scaleNutrients(r.candidates[r.chosen].per100g, r.grams) }));
    const { totals, missing, count } = sumNutrients(entries);
    if (!count) {
      host.replaceChildren(h('p', { class: 'muted' }, 'Choose a match for at least one item to see the totals.'));
      return;
    }
    const core = NUTRIENTS.filter((n) => n.group === 'core');
    host.replaceChildren(
      h('h3', {}, 'For this meal (from the food database)'),
      h(
        'dl',
        { class: 'stats' },
        core.flatMap((n) => [
          h('dt', {}, n.label),
          h('dd', { dataset: { nutrient: n.key } }, missing[n.key] === count ? 'Unknown' : `${missing[n.key] ? 'at least ' : ''}${formatNumber(totals[n.key], n.decimals)} ${n.unit}`),
        ]),
      ),
    );
  }

  function saveAll(confirm, button) {
    const active = rows.filter((r) => !r.removed);
    if (active.some((r) => r.chosen < 0)) {
      renderReview('Choose a food database match for every item, or remove items with no match.');
      return;
    }
    if (active.some((r) => !Number.isFinite(r.grams) || r.grams < 1 || r.grams > 5000)) {
      renderReview('Enter an amount between 1 and 5,000 g for every item.');
      return;
    }
    if (!active.length) {
      renderReview('There is nothing to add. Add an item, or close this panel.');
      return;
    }
    if (!confirm.checked) {
      renderReview('Tick the box to confirm you have checked the foods and amounts.');
      return;
    }
    button.disabled = true;
    try {
      for (const r of active) {
        const food = saveToLibrary(r.candidates[r.chosen]);
        store.addDiaryEntry({ ...buildDiaryEntry(food, { localDate, meal, servingG: Math.round(r.grams * 10) / 10 }), entryMethod: 'photo-scan' });
      }
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'error');
      return;
    }
    if (requestId) sendScanFeedback(requestId, feedbackCounts(rows));
    cleanup();
    toast(`${active.length} ${active.length === 1 ? 'item' : 'items'} added to ${mealLabel(meal)}.`);
    onSaved?.();
  }

  function manualLink() {
    const b = h('button', { type: 'button', class: 'button button--small button--ghost', id: 'scan-manual' }, 'Add the food yourself instead');
    b.addEventListener('click', () => {
      controller?.abort();
      cleanup();
      onManual?.();
    });
    return h('div', { class: 'form__actions' }, b);
  }

  renderPick();
  return root;
}
