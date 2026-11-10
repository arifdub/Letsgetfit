// LetsGetFit entry point: wires storage to the views and handles hash routing.
// Phase 1 runs entirely in the browser with no server.

import { Store } from './storage/store.js';
import { initOverview } from './ui/overview.js';
import { initWorkouts, initWeights } from './ui/logs.js';
import { initSettings } from './ui/settings.js';
import { initFood } from './ui/food.js';
import { initTraining } from './ui/training.js';
import { initProgress } from './ui/progress.js';
import { initAccount } from './ui/account.js';
import { initAdmin } from './ui/admin.js';
import { captureInstallPrompt, registerServiceWorker, initAppSettings } from './ui/app-settings.js';
import { $, $$, toast } from './ui/dom.js';

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
  initFood(store);
  const training = initTraining(store);
  initWorkouts(store, { onEditSession: (entry) => training.editSession(entry) });
  initProgress(store);
  initWeights(store);
  initSettings(store);
  initAppSettings();
  const account = initAccount(store);
  const adminPanel = initAdmin(account);
  onRoute = (route) => {
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
