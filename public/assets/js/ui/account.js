// Optional account and sync (Settings). Only shown when the server reports accounts are enabled.
// Anonymous, on-device use never depends on any of this.

import * as api from '../api/account.js';
import { applyRemote, pendingChanges, previewImport, COLLECTION_LABELS } from '../lib/sync.js';
import { $, h, toast, formatNumber } from './dom.js';

const CONSENT_TEXT =
  'I agree that LetsGetFit stores the health and fitness information I choose to sync (such as my details, weight, food diary and workouts) in my account, so I can use it on other devices. I can download or delete it at any time.';

function formField(id, label, attrs, hint) {
  return h(
    'div',
    { class: 'field', dataset: { field: attrs.name } },
    h('label', { for: id }, label),
    hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
    h('input', { id, class: 'input', 'aria-describedby': `${id}-error${hint ? ` ${id}-hint` : ''}`, ...attrs }),
    h('p', { class: 'field-error', id: `${id}-error`, hidden: true }),
  );
}

function showError(form, error, fieldIds = {}) {
  for (const el of form.querySelectorAll('.field-error')) {
    el.hidden = true;
    el.textContent = '';
  }
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  const status = form.querySelector('.form-status');
  const id = error.field ? fieldIds[error.field] : null;
  if (id) {
    const input = document.getElementById(id);
    const err = document.getElementById(`${id}-error`);
    input?.setAttribute('aria-invalid', 'true');
    if (err) {
      err.textContent = error.message;
      err.hidden = false;
    }
    input?.focus();
    status.textContent = '';
  } else {
    status.className = 'form-status notice-inline notice-inline--error';
    status.textContent = error.message;
    status.focus();
  }
}

function setStatus(form, message, kind = 'info') {
  const status = form.querySelector('.form-status');
  status.className = `form-status notice-inline${kind === 'error' ? ' notice-inline--error' : ''}`;
  status.textContent = message;
  status.focus();
}

function statusBox() {
  return h('p', { class: 'form-status', role: 'status', tabindex: '-1' });
}

function busy(form, on) {
  for (const b of form.querySelectorAll('button')) b.disabled = on;
}

export function initAccount(store, { onSynced } = {}) {
  const card = $('#account-card');
  let state = { enabled: false, user: null };
  let view = 'login';
  let pendingLink = null;
  let preview = null;
  let syncing = false;

  async function refresh() {
    state = await api.getAccountState();
    card.hidden = !state.enabled;
    if (!state.enabled) return;
    // Never sync one person's device data into another person's account.
    if (store.sync.linked && (!state.user || state.user.email !== store.sync.email)) {
      if (state.user) store.setSync({ linked: false, cursor: null, lastPushAt: null });
    }
    render();
    if (state.user && store.sync.linked) syncNow({ quiet: true });
  }

  /* ---------------- Logged out ---------------- */

  function tabs() {
    const items = [
      ['login', 'Log in'],
      ['register', 'Create account'],
      ['forgot', 'Forgot password'],
    ];
    return h(
      'div',
      { class: 'segmented tabs', role: 'group', 'aria-label': 'Account options' },
      items.map(([id, label]) => {
        const b = h('button', { type: 'button', class: 'tab', 'aria-pressed': String(view === id), dataset: { accountTab: id } }, label);
        b.addEventListener('click', () => {
          view = id;
          render();
          card.querySelector(`[data-account-tab="${id}"]`)?.focus();
        });
        return b;
      }),
    );
  }

  function loginForm() {
    const form = h(
      'form',
      { class: 'form', id: 'login-form', novalidate: true },
      statusBox(),
      formField('acc-login-email', 'Email', { name: 'email', type: 'email', autocomplete: 'username', required: true }),
      formField('acc-login-password', 'Password', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary' }, 'Log in')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(form, true);
      try {
        await api.login(form.elements.email.value, form.elements.password.value);
        toast('You are logged in.');
        await refresh();
        $('#account-title')?.focus();
      } catch (error) {
        if (error.code === 'email_not_verified') {
          showError(form, error);
          const resend = h('button', { type: 'button', class: 'button button--small', id: 'resend-verification' }, 'Send a new confirmation link');
          resend.addEventListener('click', async () => {
            await api.resendVerification(form.elements.email.value).catch(() => {});
            setStatus(form, 'If that address has an unconfirmed account, we have sent a new link.');
          });
          form.querySelector('.form-status').append(' ', resend);
        } else showError(form, error);
      } finally {
        busy(form, false);
      }
    });
    return form;
  }

  function registerForm() {
    const form = h(
      'form',
      { class: 'form', id: 'register-form', novalidate: true },
      statusBox(),
      formField('acc-reg-email', 'Email', { name: 'email', type: 'email', autocomplete: 'email', required: true }),
      formField('acc-reg-password', 'Password', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: '12' }, 'At least 12 characters. A few unrelated words work well.'),
      h(
        'div',
        { class: 'field', dataset: { field: 'healthConsent' } },
        h('label', { class: 'checkbox checkbox--top' }, h('input', { type: 'checkbox', name: 'healthConsent', id: 'acc-reg-consent', 'aria-describedby': 'acc-reg-consent-error' }), h('span', {}, CONSENT_TEXT)),
        h('p', { class: 'field-error', id: 'acc-reg-consent-error', hidden: true }),
        h('p', { class: 'hint' }, 'Read the ', h('a', { href: 'privacy.html' }, 'privacy notice'), ' for what is stored, why, and for how long.'),
      ),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary' }, 'Create account')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(form, true);
      try {
        const res = await api.register(form.elements.email.value, form.elements.password.value, form.elements.healthConsent.checked);
        form.reset();
        setStatus(form, res.message);
      } catch (error) {
        showError(form, error, { email: 'acc-reg-email', password: 'acc-reg-password', healthConsent: 'acc-reg-consent' });
      } finally {
        busy(form, false);
      }
    });
    return form;
  }

  function forgotForm() {
    const form = h(
      'form',
      { class: 'form', id: 'forgot-form', novalidate: true },
      statusBox(),
      formField('acc-forgot-email', 'Email', { name: 'email', type: 'email', autocomplete: 'email', required: true }),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary' }, 'Email me a reset link')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(form, true);
      try {
        const res = await api.requestReset(form.elements.email.value);
        setStatus(form, res.message);
      } catch (error) {
        showError(form, error);
      } finally {
        busy(form, false);
      }
    });
    return form;
  }

  function resetForm(token) {
    const form = h(
      'form',
      { class: 'form', id: 'reset-form', novalidate: true },
      statusBox(),
      formField('acc-reset-password', 'New password', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: '12' }, 'At least 12 characters.'),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary' }, 'Save new password')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(form, true);
      try {
        const res = await api.resetPassword(token, form.elements.password.value);
        pendingLink = null;
        view = 'login';
        render();
        toast(res.message);
      } catch (error) {
        showError(form, error, { password: 'acc-reset-password' });
      } finally {
        busy(form, false);
      }
    });
    return form;
  }

  /* ---------------- Logged in ---------------- */

  function linkedSection() {
    const s = store.sync;
    const syncButton = h('button', { type: 'button', class: 'button button--primary', id: 'sync-now' }, 'Sync now');
    syncButton.addEventListener('click', () => syncNow({ quiet: false }));
    return h(
      'div',
      { class: 'notice-inline', id: 'sync-status' },
      h('p', {}, h('strong', {}, 'Sync is on for this device.')),
      h('p', { id: 'sync-last' }, s.lastSyncAt ? `Last synced ${new Date(s.lastSyncAt).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Not synced yet.'),
      h('div', { class: 'form__actions' }, syncButton),
    );
  }

  function previewSection() {
    if (!preview) {
      const start = h('button', { type: 'button', class: 'button button--primary', id: 'start-import' }, 'Review and turn on sync');
      start.addEventListener('click', loadPreview);
      return h(
        'div',
        { id: 'import-intro' },
        h('p', {}, 'Sync is off on this device. To use your account here, review what will be copied first. Nothing changes until you confirm.'),
        h('div', { class: 'form__actions' }, start),
      );
    }
    const list = (counts) => {
      const entries = Object.entries(counts);
      return entries.length ? h('ul', { class: 'bullets' }, entries.map(([c, n]) => h('li', {}, `${COLLECTION_LABELS[c] ?? c}: ${formatNumber(n)}`))) : h('p', { class: 'muted' }, 'Nothing.');
    };
    const confirm = h('button', { type: 'button', class: 'button button--primary', id: 'confirm-import' }, 'Copy and turn on sync');
    confirm.addEventListener('click', confirmImport);
    const cancel = h('button', { type: 'button', class: 'button button--ghost' }, 'Cancel');
    cancel.addEventListener('click', () => {
      preview = null;
      render();
    });
    const sum = preview.result.summary;
    return h(
      'div',
      { id: 'import-preview', class: 'notice-inline' },
      h('h3', { tabindex: '-1', id: 'import-preview-title' }, 'Before you turn on sync'),
      h('p', {}, h('strong', {}, 'Copied from this device to your account:')),
      list(sum.upload),
      h('p', {}, h('strong', {}, 'Copied from your account to this device:')),
      list(sum.download),
      h('p', { id: 'import-duplicates' }, `${formatNumber(sum.duplicates)} ${sum.duplicates === 1 ? 'entry looks' : 'entries look'} like ${sum.duplicates === 1 ? 'a duplicate' : 'duplicates'} of what is already in your account and will be skipped. ${formatNumber(sum.alreadyThere)} already match. ${formatNumber(sum.conflicts)} ${sum.conflicts === 1 ? 'entry differs' : 'entries differ'}; the most recently changed version is kept.`),
      h('div', { class: 'form__actions' }, confirm, cancel),
    );
  }

  async function loadPreview() {
    try {
      const remote = await api.pullAll(null);
      preview = { remote, result: previewImport(store.data, remote.records) };
      render();
      $('#import-preview-title')?.focus();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function confirmImport() {
    if (!preview) return;
    const { remote, result } = preview;
    const button = $('#confirm-import');
    if (button) button.disabled = true;
    try {
      // Apply account items that are new here or newer than this device's copy.
      const incoming = [...result.toDownload, ...result.conflicts.filter((c) => c.winner === 'account').map((c) => remote.records.find((r) => r.collection === c.record.collection && r.id === c.record.id))];
      const merged = applyRemote(store.data, incoming.filter(Boolean));
      const pushStartedAt = new Date().toISOString();
      store.applySynced(merged.data, { clearTombstones: true, sync: { linked: false } });
      const outgoing = [...result.toUpload, ...result.conflicts.filter((c) => c.winner === 'device').map((c) => c.record)];
      const totals = await api.pushAll(outgoing);
      store.setSync({ linked: true, email: state.user.email, cursor: remote.cursor, lastPushAt: pushStartedAt, lastSyncAt: new Date().toISOString() });
      preview = null;
      render();
      onSynced?.();
      toast(`Sync is on. ${formatNumber(totals.accepted)} copied to your account, ${formatNumber(merged.applied)} copied to this device.`);
    } catch (error) {
      if (button) button.disabled = false;
      toast(error.message, 'error');
    }
  }

  async function syncNow({ quiet }) {
    if (syncing || !store.sync.linked) return;
    syncing = true;
    const button = $('#sync-now');
    if (button) button.disabled = true;
    try {
      const remote = await api.pullAll(store.sync.cursor);
      const merged = applyRemote(store.data, remote.records);
      const pushStartedAt = new Date().toISOString();
      const changes = pendingChanges({ ...merged.data, tombstones: store.tombstones }, store.sync.lastPushAt);
      store.applySynced(merged.data, { sync: { cursor: remote.cursor } });
      await api.pushAll(changes);
      const pushed = new Set(changes.filter((c) => c.deleted).map((c) => `${c.collection}|${c.id}`));
      store.setSync({ lastPushAt: pushStartedAt, lastSyncAt: new Date().toISOString() });
      store.clearTombstones(pushed);
      if (merged.applied) onSynced?.();
      if (!quiet) toast(`Synced. ${formatNumber(changes.length)} sent, ${formatNumber(merged.applied)} received.`);
    } catch (error) {
      if (error.code === 'not_logged_in') {
        state.user = null;
        render();
      }
      if (!quiet) toast(error.message, 'error');
    } finally {
      syncing = false;
      render();
    }
  }

  function accountActions() {
    const exportButton = h('button', { type: 'button', class: 'button', id: 'account-export' }, 'Download account data (JSON)');
    exportButton.addEventListener('click', async () => {
      try {
        const data = await api.exportAccount();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: 'letsgetfit-account.json' });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Your account data has been downloaded.');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    const logoutButton = h('button', { type: 'button', class: 'button button--ghost', id: 'account-logout' }, 'Log out');
    logoutButton.addEventListener('click', async () => {
      try {
        await api.logout();
      } catch {
        /* still log out locally */
      }
      store.setSync({ linked: false, cursor: null, lastPushAt: null });
      store.clearTombstones(null);
      preview = null;
      toast('Logged out. Your data stays on this device.');
      await refresh();
    });
    const deleteForm = h(
      'form',
      { class: 'form', id: 'delete-account-form', novalidate: true },
      statusBox(),
      h('p', {}, 'This permanently deletes your account and everything stored in it. Data on this device is not changed.'),
      formField('acc-delete-password', 'Your password', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--danger' }, 'Delete my account')),
    );
    deleteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(deleteForm, true);
      try {
        const res = await api.deleteAccount(deleteForm.elements.password.value);
        store.setSync({ linked: false, email: null, cursor: null, lastPushAt: null, lastSyncAt: null });
        store.clearTombstones(null);
        toast(res.message);
        await refresh();
      } catch (error) {
        showError(deleteForm, error, { password: 'acc-delete-password' });
      } finally {
        busy(deleteForm, false);
      }
    });
    return [
      h('div', { class: 'form__actions' }, exportButton, logoutButton),
      h('details', { class: 'disclosure' }, h('summary', {}, 'Delete account'), deleteForm),
    ];
  }

  /* ---------------- Render ---------------- */

  function render() {
    if (!state.enabled) return;
    const head = [
      h('h2', { id: 'account-title', tabindex: '-1' }, 'Account and sync (optional)'),
      h('p', { class: 'muted small' }, 'You do not need an account. With one, you can keep your logs on more than one device. Data is copied to our server only from devices where you turn on sync. ', h('a', { href: 'privacy.html' }, 'Privacy notice'), '.'),
    ];
    let body;
    if (pendingLink?.type === 'reset') {
      body = [h('h3', {}, 'Choose a new password'), resetForm(pendingLink.token)];
    } else if (!state.user) {
      body = [tabs(), view === 'register' ? registerForm() : view === 'forgot' ? forgotForm() : loginForm()];
    } else {
      body = [
        h('p', { id: 'account-email' }, 'Logged in as ', h('strong', {}, state.user.email), '.'),
        store.sync.linked ? linkedSection() : previewSection(),
        ...accountActions(),
      ];
    }
    card.replaceChildren(...head, ...body);
  }

  /** Handles #account/verify?token=… and #account/reset?token=… links from emails. */
  async function handleLink(hash) {
    const match = /^#account\/(verify|reset)\?token=([A-Za-z0-9_-]{20,100})$/.exec(hash);
    // Remove the token from the address bar and history straight away.
    history.replaceState(null, '', '#settings');
    if (!match) return;
    await ready;
    if (!state.enabled) return;
    const [, type, token] = match;
    if (type === 'verify') {
      try {
        const res = await api.verifyEmail(token);
        view = 'login';
        render();
        toast(res.message);
      } catch (error) {
        toast(error.message, 'error');
      }
    } else {
      pendingLink = { type: 'reset', token };
      render();
      $('#acc-reset-password')?.focus();
    }
    card.scrollIntoView({ block: 'start' });
  }

  const ready = refresh();
  return { handleLink, refresh, syncNow };
}
