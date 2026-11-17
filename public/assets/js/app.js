// LetsGetFit entry point: wires storage to the views and handles hash routing.
// Phase 1 runs entirely in the browser with no server.

import { icon } from './ui/icons.js';
import { Store } from './storage/store.js';
import { initOverview } from './ui/overview.js';
import { initWorkouts, initWeights } from './ui/logs.js';
import { initSettings } from './ui/settings.js';
import { MEALS } from './lib/food.js';
import { initDashboard } from './ui/dashboard.js';
import { initFood } from './ui/food.js';
import { initTraining } from './ui/training.js';
import { initProgress } from './ui/progress.js';
import { initAccount } from './ui/account.js';
import { initAdmin } from './ui/admin.js';
import { captureInstallPrompt, registerServiceWorker, initAppSettings } from './ui/app-settings.js';
import { $, $$, h, toast } from './ui/dom.js';

export const APP_VERSION = '0.6.0';
const ROUTES = ['overview', 'food', 'workouts', 'progress', 'account', 'admin', 'settings'];
let onRoute = () => {};

function showRoute(route, { focus }) {
  for (const view of $$('.view')) view.hidden = view.dataset.view !== route;
  for (const link of $$('.primary-nav a')) {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const title = route.charAt(0).toUpperCase() + route.slice(1);
  document.title = route === 'overview' ? 'LetsGetFit' : `${title} · LetsGetFit`;
  onRoute(route);
  if (focus) ($(`#${route}-title`) ?? $(`#${route}-view-title`))?.focus();
}

function currentRoute() {
  // Old email links (#account/verify?token=…) are no longer used: open the account page.
  if (location.hash.startsWith('#account/')) {
    history.replaceState(null, '', '#account');
    return 'account';
  }
  const hash = location.hash.replace('#', '');
  return ROUTES.includes(hash) ? hash : 'overview';
}

function start() {
  const store = new Store();
  const notice = $('#app-notice');
  const messages = [];
  if (store.notice) messages.push(store.notice);
  if (!store.persistent) messages.push('This browser is blocking storage, so anything you enter will be lost when you close the page.');
  if (messages.length) {
    notice.textContent = messages.join(' ');
    notice.hidden = false;
  }

  $('#app-version').textContent = APP_VERSION;
  initOverview(store);
  const food = initFood(store);
  const training = initTraining(store);
  const workouts = initWorkouts(store, { onEditSession: (entry) => training.editSession(entry) });
  initProgress(store);
  initWeights(store);
  initSettings(store);
  initAppSettings();
  const account = initAccount(store);
  const adminPanel = initAdmin(account);
  function navigate(route) {
    if (location.hash !== `#${route}`) history.pushState(null, '', `#${route}`);
    showRoute(route, { focus: false });
  }
  function addFood(meal, tab, options) {
    navigate('food');
    food.openToday(meal, tab, options);
  }

  function addExercise(options) {
    navigate('workouts');
    void workouts.openQuickAdd(options);
  }

  const dashboard = initDashboard(store, addFood, addExercise);
  const quickAdd = $('#quick-add-dialog');
  const mealPicker = $('#quick-meal');
  mealPicker.replaceChildren(...MEALS.map((meal) => h('option', { value: meal.id }, meal.label)));
  // Shortcuts: round icon buttons for the ways to add food, and tiles for exercise.
  // Each acts straight from the tap, so "Meal scan" can open the camera at once.
  const shortcut = (id, name, label, className, run) => {
    const b = h('button', { type: 'button', class: className, dataset: { shortcut: id } }, h('span', { class: 'shortcut__icon' }, icon(name)), h('span', { class: 'shortcut__label' }, label));
    b.addEventListener('click', () => {
      quickAdd.close('done');
      run();
    });
    return b;
  };
  const defaultMeal = () => {
    const hour = new Date().getHours();
    return hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 21 ? 'dinner' : 'snacks';
  };
  $('#quick-add').addEventListener('click', () => {
    mealPicker.value = defaultMeal();
    const canScan = food.canScan();
    $('#shortcut-food').replaceChildren(
      shortcut('search', 'search', 'Search', 'shortcut', () => addFood(mealPicker.value, 'search')),
      canScan ? shortcut('scan', 'scan', 'Meal scan', 'shortcut shortcut--accent', () => addFood(mealPicker.value, 'scan', { camera: true })) : null,
      canScan ? shortcut('describe', 'describe', 'Describe', 'shortcut', () => addFood(mealPicker.value, 'describe')) : null,
      shortcut('mine', 'list', 'My foods', 'shortcut', () => addFood(mealPicker.value, 'mine')),
    );
    $('#shortcut-more').replaceChildren(
      shortcut('exercise', 'exercise', 'Exercise', 'shortcut-tile', () => addExercise()),
      shortcut('burned', 'flame', 'Calories burned', 'shortcut-tile', () => addExercise({ focus: 'burnedKcal' })),
    );
    quickAdd.showModal();
  });

  onRoute = (route) => {
    if (route === 'overview') dashboard.render();
    if (route === 'admin') adminPanel.show();
  };

  // Links that jump to the methods section on the overview.
  for (const link of $$('[data-scroll="methods"]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (location.hash !== '#overview') history.pushState(null, '', '#overview');
      showRoute('overview', { focus: false });
      const methods = $('#methods');
      if (methods) {
        const disclosure = methods.closest('details');
        if (disclosure) disclosure.open = true;
        methods.scrollIntoView({ block: 'start' });
        $('#methods-title').focus();
      } else {
        toast('Enter your details on the Overview page to see the estimates and how they work.', 'info');
        $('#overview-title').focus();
      }
    });
  }

  window.addEventListener('hashchange', () => {
    showRoute(currentRoute(), { focus: true });
  });
  showRoute(currentRoute(), { focus: false });
  document.documentElement.dataset.ready = 'true';
}

captureInstallPrompt();
registerServiceWorker();

try {
  start();
} catch (error) {
  const notice = document.getElementById('app-notice');
  if (notice) {
    notice.textContent = 'Something went wrong while starting LetsGetFit. Try reloading the page.';
    notice.hidden = false;
  }
  const loading = document.getElementById('overview-loading');
  if (loading) loading.hidden = true;
  throw error;
}
