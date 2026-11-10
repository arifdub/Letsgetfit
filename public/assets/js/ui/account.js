// The user panel (#account): optional account, email-code sign-in, password, sync and data
// controls. Only offered when the server reports accounts are enabled. Anonymous, on-device use
// never depends on any of this.

import * as api from '../api/account.js';
import { applyRemote, pendingChanges, previewImport, COLLECTION_LABELS } from '../lib/sync.js';
import { $, h, toast, formatNumber, confirmAction } from './dom.js';

const CONSENT_TEXT =
  'I agree that LetsGetFit stores the health and fitness information I choose to sync (such as my details, weight, food diary and workouts) in my account, so I can use it on other devices. I can download or delete it at any time.';

export function formField(id, label, attrs, hint) {
  return h(
    'div',
    { class: 'field', dataset: { field: attrs.name } },
    h('label', { for: id }, label),
    hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
    h('input', { id, class: 'input', 'aria-describedby': `${id}-error${hint ? ` ${id}-hint` : ''}`, ...attrs }),
    h('p', { class: 'field-error', id: `${id}-error`, hidden: true }),
  );
}

export function showError(form, error, fieldIds = {}) {
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

export function setStatus(form, message, kind = 'info') {
  const status = form.querySelector('.form-status');
  status.className = `form-status notice-inline${kind === 'error' ? ' notice-inline--error' : ''}`;
  status.textContent = message;
  status.focus();
}

export function statusBox() {
  return h('p', { class: 'form-status', role: 'status', tabindex: '-1' });
}

export function busy(form, on) {
  for (const b of form.querySelectorAll('button')) b.disabled = on;
}

export function initAccount(store, { onSynced, onState } = {}) {
  const panel = $('#account-panel');
  const navItem = $('#nav-account');
  const settingsLink = $('#settings-account');
  let state = { enabled: false, user: null, signupsOpen: true, privacyContact: null, loaded: false };
  // Logged-out steps: 'email' → 'code' (→ 'consent' for a new account), or 'password'.
  let step = 'email';
  let pendingEmail = '';
  let pendingCode = '';
  let preview = null;
  let syncing = false;

  async function refresh() {
    state = { ...(await api.getAccountState()), loaded: true };
    navItem.hidden = !state.enabled;
    if (settingsLink) settingsLink.hidden = !state.enabled;
    onState?.(state);
    // Never sync one person's device data into another person's account.
    if (store.sync.linked && state.user && state.user.email !== store.sync.email) {
      store.setSync({ linked: false, cursor: null, lastPushAt: null });
    }
    render();
    if (state.user && store.sync.linked) syncNow({ quiet: true });
  }

  /* ---------------- Logged out: email code or password ---------------- */

  function emailForm() {
    const form = h(
      'form',
      { class: 'form', id: 'code-email-form', novalidate: true },
      statusBox(),
      formField('acc-email', 'Email', { name: 'email', type: 'email', autocomplete: 'email', required: true, value: pendingEmail }, 'We email you a 6-digit code. No password needed. New here? The same code creates your account.'),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary' }, 'Email me a code')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(form, true);
      try {
        const res = await api.requestCode(form.elements.email.value);
        pendingEmail = form.elements.email.value.trim();
        step = 'code';
        render(res.message);
        $('#acc-code')?.focus();
      } catch (error) {
        showError(form, error, { email: 'acc-email' });
      } finally {
        busy(form, false);
      }
    });
    const usePassword = h('button', { type: 'button', class: 'button button--ghost', id: 'use-password' }, 'Log in with a password instead');
    usePassword.addEventListener('click', () => {
      step = 'password';
      render();
      $('#acc-login-email')?.focus();
    });
    return [form, h('p', { class: 'small' }, usePassword)];
  }

  function consentField() {
    return h(
      'div',
      { class: 'field', dataset: { field: 'healthConsent' } },
      h('label', { class: 'checkbox checkbox--top' }, h('input', { type: 'checkbox', name: 'healthConsent', id: 'acc-consent', 'aria-describedby': 'acc-consent-error' }), h('span', {}, CONSENT_TEXT)),
      h('p', { class: 'field-error', id: 'acc-consent-error', hidden: true }),
      h('p', { class: 'hint' }, 'Read the ', h('a', { href: 'privacy.html' }, 'privacy notice'), ' for what is stored, why, and for how long.'),
    );
  }

  function codeForm(message) {
    const isNew = step === 'consent';
    const form = h(
      'form',
      { class: 'form', id: 'code-verify-form', novalidate: true },
      statusBox(),
      h('p', {}, isNew ? 'There is no account for ' : 'Enter the code we sent to ', h('strong', {}, pendingEmail), isNew ? ' yet. To create one, agree to the following:' : '.'),
      isNew
        ? null
        : formField('acc-code', '6-digit code', { name: 'code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]*', maxlength: '7', required: true, value: pendingCode }, 'It expires after 10 minutes. Check your spam folder if it has not arrived.'),
      isNew ? consentField() : null,
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary' }, isNew ? 'Create my account' : 'Log in')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(form, true);
      const code = isNew ? pendingCode : form.elements.code.value;
      try {
        const res = await api.verifyCode(pendingEmail, code, isNew ? form.elements.healthConsent.checked : false);
        step = 'email';
        pendingCode = '';
        toast(res.created ? 'Your account is ready. Turn on sync below to copy this device’s data.' : 'You are logged in.');
        await refresh();
        $('#account-title')?.focus();
      } catch (error) {
        if (error.code === 'consent_required') {
          if (!isNew) {
            pendingCode = code;
            step = 'consent';
            render();
            $('#acc-consent')?.focus();
          } else showError(form, error, { healthConsent: 'acc-consent' });
        } else if (error.code === 'invalid_code' && isNew) {
          step = 'code';
          pendingCode = '';
          render(error.message);
        } else showError(form, error, { code: 'acc-code' });
      } finally {
        busy(form, false);
      }
    });
    const again = h('button', { type: 'button', class: 'button button--ghost', id: 'code-start-over' }, 'Use a different email or send a new code');
    again.addEventListener('click', () => {
      step = 'email';
      pendingCode = '';
      render();
      $('#acc-email')?.focus();
    });
    if (message) queueMicrotask(() => setStatus(form, message));
    return [form, h('p', { class: 'small' }, again)];
  }

  function passwordForm() {
    const form = h(
      'form',
      { class: 'form', id: 'login-form', novalidate: true },
      statusBox(),
      formField('acc-login-email', 'Email', { name: 'email', type: 'email', autocomplete: 'username', required: true, value: pendingEmail }),
      formField('acc-login-password', 'Password', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary' }, 'Log in')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(form, true);
      try {
        await api.login(form.elements.email.value, form.elements.password.value);
        step = 'email';
        toast('You are logged in.');
        await refresh();
        $('#account-title')?.focus();
      } catch (error) {
        showError(form, error);
      } finally {
        busy(form, false);
      }
    });
    const useCode = h('button', { type: 'button', class: 'button button--ghost', id: 'use-code' }, 'Forgotten it, or no password? Email me a code');
    useCode.addEventListener('click', () => {
      pendingEmail = form.elements.email.value.trim();
      step = 'email';
      render();
      $('#acc-email')?.focus();
    });
    return [form, h('p', { class: 'small' }, useCode)];
  }

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

  /* ---------------- Logged in: profile, password, data ---------------- */

  const when = (iso) => (iso ? new Date(`${String(iso).replace(' ', 'T')}Z`).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');

  function profileSection() {
    const u = state.user;
    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'acc-profile-title' },
      h('h2', { id: 'acc-profile-title' }, 'Your account'),
      h(
        'dl',
        { class: 'stats', id: 'account-email' },
        h('dt', {}, 'Email'),
        h('dd', {}, u.email),
        h('dt', {}, 'Account type'),
        h('dd', {}, u.role === 'admin' ? 'Admin' : 'Member'),
        h('dt', {}, 'Logs in with'),
        h('dd', { id: 'acc-login-method' }, u.hasPassword ? 'Password or email code' : 'Email code'),
        h('dt', {}, 'Joined'),
        h('dd', {}, when(u.createdAt)),
      ),
      u.role === 'admin' ? h('p', {}, h('a', { href: '#admin', class: 'button', id: 'open-admin' }, 'Open the admin panel')) : null,
    );
  }

  function passwordSection() {
    const u = state.user;
    const needsCurrent = u.hasPassword && !u.canSetPasswordWithoutCurrent;
    const form = h(
      'form',
      { class: 'form', id: 'set-password-form', novalidate: true },
      statusBox(),
      h('p', { class: 'muted' }, u.hasPassword ? 'Change your password, or remove it and log in with email codes only.' : 'Add a password to log in without waiting for a code. You can still use codes at any time.'),
      needsCurrent ? formField('acc-current-password', 'Current password', { name: 'currentPassword', type: 'password', autocomplete: 'current-password', required: true }, 'Forgotten it? Log out, log in with an email code, and come back here within 15 minutes.') : null,
      formField('acc-new-password', u.hasPassword ? 'New password' : 'Password', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: '12' }, 'At least 12 characters. A few unrelated words work well.'),
      h(
        'div',
        { class: 'form__actions' },
        h('button', { type: 'submit', class: 'button button--primary' }, u.hasPassword ? 'Change password' : 'Save password'),
        u.hasPassword ? h('button', { type: 'button', class: 'button button--ghost', id: 'remove-password' }, 'Remove password') : null,
      ),
    );
    const fields = { password: 'acc-new-password', currentPassword: 'acc-current-password' };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(form, true);
      try {
        const res = await api.setPassword(form.elements.password.value, form.elements.currentPassword?.value ?? '');
        toast(res.message);
        await refresh();
        $('#acc-password-title')?.focus();
      } catch (error) {
        showError(form, error, fields);
      } finally {
        busy(form, false);
      }
    });
    form.querySelector('#remove-password')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Remove your password?', body: 'You will log in with a code sent to your email instead. Other devices will be logged out.', confirmLabel: 'Remove password' }))) return;
      busy(form, true);
      try {
        const res = await api.removePassword(form.elements.currentPassword?.value ?? '');
        toast(res.message);
        await refresh();
      } catch (error) {
        showError(form, error, fields);
      } finally {
        busy(form, false);
      }
    });
    const everywhere = h('button', { type: 'button', class: 'button', id: 'logout-everywhere' }, 'Log out on every device');
    everywhere.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Log out everywhere?', body: 'Every device, including this one, will be logged out of your account. Data saved on each device stays there.', confirmLabel: 'Log out everywhere' }))) return;
      try {
        const res = await api.logoutEverywhere();
        unlink();
        toast(res.message);
        await refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'acc-password-title' },
      h('h2', { id: 'acc-password-title', tabindex: '-1' }, 'Login and security'),
      form,
      h('h3', {}, 'Devices'),
      h('p', { class: 'muted' }, 'Lost a phone, or used a shared computer? Log out everywhere at once.'),
      h('div', { class: 'form__actions' }, everywhere),
    );
  }

  function unlink() {
    store.setSync({ linked: false, cursor: null, lastPushAt: null });
    store.clearTombstones(null);
    preview = null;
  }

  function dataSection() {
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
      unlink();
      toast('Logged out. Your data stays on this device.');
      await refresh();
    });
    const u = state.user;
    const deleteForm = h(
      'form',
      { class: 'form', id: 'delete-account-form', novalidate: true },
      statusBox(),
      h('p', {}, 'This permanently deletes your account and everything stored in it. Data on this device is not changed.'),
      u.hasPassword
        ? formField('acc-delete-password', 'Your password', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })
        : h('p', { class: 'muted' }, 'If you logged in more than 15 minutes ago, log out and log in with a new code first.'),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--danger' }, 'Delete my account')),
    );
    deleteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!(await confirmAction({ title: 'Delete your account?', body: 'Your account and all data stored in it will be deleted for good. Data on this device stays.', confirmLabel: 'Delete account' }))) return;
      busy(deleteForm, true);
      try {
        const res = await api.deleteAccount(deleteForm.elements.password?.value ?? '');
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
    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'acc-data-title' },
      h('h2', { id: 'acc-data-title' }, 'Your data'),
      h('p', { class: 'muted' }, 'Download everything stored in your account, or delete it. ', state.privacyContact ? ['Questions about your data: ', h('a', { href: `mailto:${state.privacyContact}` }, state.privacyContact), '.'] : null),
      h('div', { class: 'form__actions' }, exportButton, logoutButton),
      h('details', { class: 'disclosure' }, h('summary', {}, 'Delete account'), deleteForm),
    );
  }

  /* ---------------- Render ---------------- */

  function render(message) {
    if (!state.loaded) return;
    if (!state.enabled) {
      panel.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'state__title' }, 'Accounts are not available'), h('p', {}, 'You do not need an account: everything works and is saved on this device.')));
      return;
    }
    const intro = h('p', { class: 'muted' }, 'You do not need an account. With one, you can keep your logs on more than one device. Data is copied to our server only from devices where you turn on sync. ', h('a', { href: 'privacy.html' }, 'Privacy notice'), '.');
    if (!state.user) {
      let body;
      if (step === 'code' || step === 'consent') body = codeForm(message);
      else if (step === 'password') body = passwordForm();
      else body = emailForm();
      panel.replaceChildren(
        h(
          'section',
          { class: 'card', id: 'account-card', 'aria-labelledby': 'account-title' },
          h('h2', { id: 'account-title', tabindex: '-1' }, step === 'password' ? 'Log in with a password' : 'Join or log in'),
          intro,
          state.signupsOpen ? null : h('p', { class: 'notice-inline' }, 'New accounts are paused at the moment. Existing members can still log in.'),
          ...body,
        ),
      );
      return;
    }
    panel.replaceChildren(
      profileSection(),
      h('section', { class: 'card', id: 'account-card', 'aria-labelledby': 'account-title' }, h('h2', { id: 'account-title', tabindex: '-1' }, 'Sync this device'), intro, store.sync.linked ? linkedSection() : previewSection()),
      passwordSection(),
      dataSection(),
    );
  }

  panel.replaceChildren(h('div', { class: 'state state--loading', role: 'status' }, 'Checking your account…'));
  const ready = refresh();
  return { ready, refresh, syncNow, get state() { return state; } };
}
