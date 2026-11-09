import { $, $$, h, toast, confirmAction } from './dom.js';
import { toLocalDateString } from '../lib/dates.js';

export function initSettings(store) {
  const unitsRadios = $$('input[name="settings-units"]');
  for (const radio of unitsRadios) {
    radio.addEventListener('change', () => {
      try {
        store.setUnits(radio.value);
        toast(radio.value === 'imperial' ? 'Showing feet, inches, stone and pounds.' : 'Showing centimetres and kilograms.');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  $('#export-data').addEventListener('click', () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `letsgetfit-${toLocalDateString()}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Your data file has been downloaded.');
  });

  $('#clear-data').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'Clear all data?',
      body: 'This permanently removes your details, food diary, saved foods, workouts and weight log from this browser. It cannot be undone. Download a copy first if you want to keep it.',
      confirmLabel: 'Clear all data',
    });
    if (!ok) return;
    try {
      store.clearAll();
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    toast('All LetsGetFit data has been removed from this device.');
  });

  function render() {
    for (const radio of unitsRadios) radio.checked = radio.value === store.units;
    $('#storage-status').textContent = store.persistent
      ? 'Status: saving to this browser.'
      : 'Status: this browser is blocking storage, so entries will be lost when you close the page.';
    const counts = [
      ['Your details', store.profile ? 'Saved' : 'Not entered'],
      ['Diary entries', String(store.diary.length)],
      ['Saved foods', String(store.foods.length)],
      ['Workouts', String(store.workouts.length)],
      ['Weight entries', String(store.weights.length)],
    ];
    $('#data-counts').replaceChildren(...counts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    $('#clear-data').disabled = store.readOnly;
  }

  store.subscribe(render);
  render();
  return { render };
}
