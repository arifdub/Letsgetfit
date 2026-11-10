// Settings → "App and notifications": install LetsGetFit like an app, and opt in to reminders.
// Notifications are off until the person turns them on on this device; reminder times are kept
// on our server only so it knows when to send them (no health data).

import { getPushConfig, savePush, removePush, pushStatus, testPush } from '../api/push.js';
import { REMINDER_TYPES, buildReminders, choicesFrom, urlBase64ToBytes } from '../lib/reminders.js';
import { $, h, toast, confirmAction } from './dom.js';

let installEvent = null;
let onInstallChange = () => {};

/** Call at start-up: the browser offers installation once, early. */
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    onInstallChange();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    onInstallChange();
  });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  });
}

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

export function initAppSettings() {
  const card = $('#app-card');
  if (!card) return;
  let server = null; // { enabled, publicKey }
  let subscription = null;
  let saved = null; // reminders saved on the server for this device
  let busy = false;

  function installSection() {
    let body;
    if (isStandalone()) {
      body = h('p', { id: 'install-status' }, 'LetsGetFit is installed on this device. Open it from your home screen or app list.');
    } else if (installEvent) {
      const b = h('button', { type: 'button', class: 'button button--primary', id: 'install-app' }, 'Install the app');
      b.addEventListener('click', async () => {
        const event = installEvent;
        installEvent = null;
        try {
          await event.prompt();
          const { outcome } = await event.userChoice;
          if (outcome === 'accepted') toast('LetsGetFit is being added to your device.');
        } catch {
          /* the browser declined to show it */
        }
        render();
      });
      body = [h('p', { id: 'install-status' }, 'Add LetsGetFit to your home screen. It opens in its own window and works offline.'), h('div', { class: 'form__actions' }, b)];
    } else if (isIos()) {
      body = h('p', { id: 'install-status' }, 'On iPhone or iPad: open this page in Safari, tap the Share button, then “Add to Home Screen”.');
    } else {
      body = h('p', { id: 'install-status' }, 'Use your browser menu and choose “Install app” or “Add to Home screen”. It then opens in its own window and works offline.');
    }
    return [h('h3', {}, 'Install the app'), ...[body].flat()];
  }

  function remindersForm(choices) {
    return h(
      'fieldset',
      { class: 'reminders', id: 'reminder-choices' },
      h('legend', {}, 'Reminders'),
      h('p', { class: 'hint' }, 'Choose any reminders you want, at your local time. You can change or stop them at any time.'),
      REMINDER_TYPES.map(({ type, label, hint }) => {
        const c = choices[type];
        const check = h('input', { type: 'checkbox', id: `rem-${type}`, name: `rem-${type}`, checked: c.on });
        const time = h('input', { type: 'time', id: `rem-${type}-time`, class: 'input input--short', value: c.time, 'aria-label': `${label} time`, disabled: !c.on });
        check.addEventListener('change', () => {
          time.disabled = !check.checked;
        });
        return h('div', { class: 'reminder-row', dataset: { type } }, h('label', { class: 'checkbox' }, check, h('span', {}, h('strong', {}, label), h('br'), h('span', { class: 'muted small' }, hint))), time);
      }),
    );
  }

  function readChoices() {
    const out = {};
    for (const { type } of REMINDER_TYPES) {
      out[type] = { on: $(`#rem-${type}`)?.checked ?? false, time: $(`#rem-${type}-time`)?.value ?? '' };
    }
    return out;
  }

  async function subscribeAndSave() {
    const { reminders, error } = buildReminders(readChoices());
    if (error) return toast(error, 'error');
    if (Notification.permission === 'denied') return render('Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.');
    busy = true;
    render();
    try {
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
        busy = false;
        return render('Notifications were not allowed, so nothing was turned on.');
      }
      const reg = await navigator.serviceWorker.ready;
      subscription = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(server.publicKey) }));
      const res = await savePush(subscription.toJSON(), reminders);
      saved = res.reminders ?? reminders;
      toast(res.message);
    } catch (e) {
      toast(e.message || 'Notifications could not be turned on in this browser.', 'error');
    }
    busy = false;
    render();
  }

  async function turnOff() {
    if (!(await confirmAction({ title: 'Turn off notifications?', body: 'This device will stop getting reminders and announcements.', confirmLabel: 'Turn off' }))) return;
    busy = true;
    render();
    try {
      if (subscription) {
        await removePush(subscription.endpoint).catch(() => {});
        await subscription.unsubscribe().catch(() => {});
      }
      subscription = null;
      saved = null;
      toast('Notifications are off on this device.');
    } finally {
      busy = false;
      render();
    }
  }

  function notificationsSection(message) {
    const head = h('h3', {}, 'Notifications');
    if (!server) return [head, h('p', { class: 'muted', role: 'status' }, 'Checking…')];
    if (!server.enabled) return [head, h('p', { id: 'push-status' }, 'Notifications are not available yet.')];
    if (!pushSupported()) {
      return [head, h('p', { id: 'push-status' }, isIos() && !isStandalone()
        ? 'On iPhone and iPad, install the app first (see above), then open it from your home screen to turn on notifications.'
        : 'This browser does not support notifications from websites.')];
    }
    const on = Boolean(subscription && saved !== null);
    const save = h('button', { type: 'button', class: 'button button--primary', id: 'push-save', disabled: busy }, on ? 'Save reminders' : 'Turn on notifications');
    save.addEventListener('click', subscribeAndSave);
    const actions = [save];
    if (on) {
      const test = h('button', { type: 'button', class: 'button', id: 'push-test', disabled: busy }, 'Send a test');
      test.addEventListener('click', async () => {
        try {
          toast((await testPush(subscription.endpoint)).message);
        } catch (e) {
          toast(e.message, 'error');
        }
      });
      const off = h('button', { type: 'button', class: 'button button--ghost', id: 'push-off', disabled: busy }, 'Turn off');
      off.addEventListener('click', turnOff);
      actions.push(test, off);
    }
    return [
      head,
      h('p', { id: 'push-status' }, on ? 'Notifications are on for this device.' : 'Get gentle reminders on this device, and occasional news about LetsGetFit. Off until you turn them on.'),
      message ? h('p', { class: 'notice-inline notice-inline--error', role: 'alert' }, message) : null,
      remindersForm(choicesFrom(saved ?? [])),
      h('div', { class: 'form__actions' }, actions),
      h('p', { class: 'muted small' }, 'We keep this device’s notification address, your reminder times and time zone, so we know when to send them. ', h('a', { href: 'privacy.html' }, 'Privacy notice'), '.'),
    ];
  }

  function render(message) {
    const focusId = document.activeElement?.id;
    card.replaceChildren(
      h('h2', { id: 'app-title' }, 'App and notifications'),
      ...installSection(),
      ...notificationsSection(message).filter(Boolean),
    );
    if (focusId) $(`#${focusId}`)?.focus();
  }

  onInstallChange = () => render();
  render();
  getPushConfig().then(async (config) => {
    server = config;
    if (config.enabled && pushSupported()) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        subscription = (await reg?.pushManager.getSubscription()) ?? null;
        if (subscription) {
          const status = await pushStatus(subscription.endpoint);
          saved = status.subscribed ? status.reminders ?? [] : null;
        }
      } catch {
        subscription = null;
      }
    }
    render();
  });
}
