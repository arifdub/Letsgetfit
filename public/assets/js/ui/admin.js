// The admin panel (#admin): database setup, site settings and API keys, member accounts, a test
// email and the audit log. The server checks the admin role on every request; this view only
// decides what to show. Admins see account details and counts, never anyone's health records.

import * as admin from '../api/admin.js';
import { $, h, toast, formatNumber, confirmAction } from './dom.js';
import { formField, showError, setStatus, statusBox, busy } from './account.js';

const SETTING_INFO = {
  openai_api_key: { label: 'OpenAI API key', hint: 'Turns on Food → Scan photo. Starts with sk-. Leave empty to keep the current key.' },
  fdc_api_key: { label: 'USDA FoodData Central API key', hint: 'Free from api.data.gov. Without one, food search uses the shared DEMO_KEY with low limits.' },
  openai_model: { label: 'OpenAI model', hint: 'A vision model with structured outputs, such as gpt-4o-mini.' },
  scan_enabled: { label: 'Allow photo scanning', hint: 'Pause scanning without removing the key.' },
  scan_daily_limit: { label: 'Scans per day (whole site)', hint: 'Caps OpenAI spending over a rolling 24 hours.' },
  scan_per_visitor_per_day: { label: 'Scans per visitor per day', hint: '' },
  signups_open: { label: 'Allow new accounts', hint: 'When off, existing members can still log in. The admin email can always join.' },
  privacy_contact_email: { label: 'Privacy contact email', hint: 'Shown to members on their account page.' },
};
const SOURCE_TEXT = { admin: 'Set on this page', github: 'From the GitHub secret', none: 'Not set', default: '' };
const when = (iso) => (iso ? new Date(`${String(iso).replace(' ', 'T')}Z`).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

export function initAdmin(account) {
  const panel = $('#admin-panel');
  let loading = false;

  function message(title, body, ...extra) {
    return h('section', { class: 'card' }, h('p', { class: 'state__title' }, title), h('p', {}, body), ...extra);
  }

  async function show() {
    if (loading) return;
    loading = true;
    panel.replaceChildren(h('div', { class: 'state state--loading', role: 'status' }, 'Loading the admin panel…'));
    try {
      await account.ready;
      let status;
      try {
        status = await admin.status();
      } catch (error) {
        panel.replaceChildren(message('The admin panel is not available', error.message));
        return;
      }
      if (status.enabled === false) {
        panel.replaceChildren(message('Accounts are switched off', status.message ?? 'Turn accounts on first. See docs/DATABASE.md in the repository.'));
        return;
      }
      if (status.needsSetup) {
        panel.replaceChildren(setupCard(status));
        return;
      }
      const user = account.state.user;
      if (!user || user.role !== 'admin') {
        panel.replaceChildren(
          message(
            user ? 'This account is not an admin' : 'Log in as an admin',
            user ? 'Only admins can use this page.' : 'Log in with the admin email address (the ADMIN_EMAIL secret). A code is sent to it; that account becomes the admin.',
            h('p', {}, h('a', { href: '#account', class: 'button button--primary' }, user ? 'Back to your account' : 'Go to log in')),
          ),
        );
        return;
      }
      const [ov, st] = await Promise.all([admin.overview(), admin.settings()]);
      panel.replaceChildren(overviewCard(ov), settingsCard(st), usersCard(user.email), toolsCard(), auditCard());
      loadUsers('');
    } catch (error) {
      panel.replaceChildren(message('Something went wrong', error.message));
    } finally {
      loading = false;
    }
  }

  /* ---------------- Setup ---------------- */

  function setupCard(status) {
    const form = h(
      'form',
      { class: 'form', id: 'admin-setup-form', novalidate: true },
      statusBox(),
      h('p', {}, 'The database is connected but its tables have not been created yet. Pending: ', h('strong', {}, status.pending.join(', ')), '.'),
      status.setupTokenConfigured
        ? formField('admin-setup-token', 'Setup token', { name: 'setupToken', type: 'password', autocomplete: 'off', required: true }, 'The value of the ADMIN_SETUP_TOKEN secret you saved in GitHub.')
        : h('p', { class: 'notice-inline notice-inline--error' }, 'Add an ADMIN_SETUP_TOKEN secret (at least 24 random characters) in GitHub, then deploy again.'),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary', disabled: !status.setupTokenConfigured }, 'Set up the database')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(form, true);
      try {
        const res = await admin.setup(form.elements.setupToken?.value ?? '');
        toast(res.message);
        await account.refresh();
        loading = false;
        await show();
      } catch (error) {
        showError(form, error, { setupToken: 'admin-setup-token' });
        busy(form, false);
      }
    });
    return h('section', { class: 'card', 'aria-labelledby': 'admin-setup-title' }, h('h2', { id: 'admin-setup-title' }, 'Set up the database'), form);
  }

  /* ---------------- Overview ---------------- */

  function overviewCard(ov) {
    const u = ov.users;
    const f = ov.features;
    const row = (label, value) => [h('dt', {}, label), h('dd', {}, value)];
    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'admin-overview-title' },
      h('h2', { id: 'admin-overview-title' }, 'Overview'),
      h(
        'dl',
        { class: 'stats', id: 'admin-stats' },
        row('Members', formatNumber(u.total)),
        row('New in 7 days', formatNumber(u.new7Days)),
        row('Active in 30 days', formatNumber(u.active30Days)),
        row('Admins', formatNumber(u.admins)),
        row('Disabled', formatNumber(u.disabled)),
        row('Using a password', formatNumber(u.withPassword)),
        row('Synced records', formatNumber(ov.records)),
      ),
      h('h3', {}, 'Features'),
      h(
        'dl',
        { class: 'stats', id: 'admin-features' },
        row('New accounts', f.signupsOpen ? 'Open' : 'Paused'),
        row('Food search', f.foodSearch === 'configured' ? 'Own API key' : 'Shared DEMO_KEY (low limits)'),
        row('Photo scan', { enabled: 'On', paused: 'Paused', 'no-key': 'Off (no OpenAI key)' }[f.aiScan] ?? f.aiScan),
        row('Email', f.mail),
      ),
    );
  }

  /* ---------------- Settings ---------------- */

  function settingsCard(st) {
    const inputs = [];
    for (const [name, field] of Object.entries(st.fields)) {
      const info = SETTING_INFO[name] ?? { label: name, hint: '' };
      const id = `admin-set-${name}`;
      if (field.type === 'bool') {
        inputs.push(
          h(
            'div',
            { class: 'field', dataset: { field: name } },
            h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', id, name, checked: field.value === true, 'aria-describedby': `${id}-hint ${id}-error` }), h('span', {}, info.label)),
            h('p', { class: 'hint', id: `${id}-hint` }, info.hint),
            h('p', { class: 'field-error', id: `${id}-error`, hidden: true }),
          ),
        );
        continue;
      }
      let hint = info.hint;
      if (field.secret) hint = `${SOURCE_TEXT[field.source]}${field.stored?.hint ? ` (ends ${field.stored.hint})` : ''}. ${info.hint}`;
      const attrs =
        field.type === 'int'
          ? { name, type: 'number', inputmode: 'numeric', min: field.min, max: field.max, value: field.value }
          : field.secret
            ? { name, type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: field.stored ? 'Saved: type a new key to replace it' : '' }
            : { name, type: name.includes('email') ? 'email' : 'text', value: field.value ?? '', spellcheck: 'false' };
      const wrapper = formField(id, info.label, attrs, hint);
      if (field.secret && field.source === 'admin') {
        const clear = h('button', { type: 'button', class: 'button button--small button--ghost', dataset: { clearSetting: name } }, 'Remove the key saved here');
        clear.addEventListener('click', () => save({ [name]: '' }, `${info.label} removed from this page.`));
        wrapper.append(clear);
      }
      inputs.push(wrapper);
    }
    const form = h(
      'form',
      { class: 'form', id: 'admin-settings-form', novalidate: true },
      statusBox(),
      st.secretsStorable ? null : h('p', { class: 'notice-inline notice-inline--error' }, 'API keys cannot be saved here until the APP_HASH_SECRET secret is set in GitHub. Other settings work.'),
      ...inputs,
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button button--primary' }, 'Save settings')),
    );
    const fieldIds = Object.fromEntries(Object.keys(st.fields).map((n) => [n, `admin-set-${n}`]));

    async function save(values, done) {
      busy(form, true);
      try {
        const res = await admin.saveSettings(values);
        toast(done ?? res.message);
        const fresh = await admin.settings();
        form.closest('section').replaceWith(settingsCard(fresh));
        $('#admin-settings-title')?.focus();
      } catch (error) {
        if (error.code === 'invalid_settings') {
          busy(form, false);
          const first = Object.keys(error.fields ?? {})[0];
          showError(form, { ...error, field: first ?? null, message: (error.fields ?? {})[first] ?? error.message }, fieldIds);
        } else {
          showError(form, error, fieldIds);
          busy(form, false);
        }
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const [name, field] of Object.entries(st.fields)) {
        const el = form.elements[name];
        if (field.type === 'bool') {
          if (el.checked !== field.value) values[name] = el.checked;
        } else if (field.secret) {
          if (el.value.trim() !== '') values[name] = el.value.trim();
        } else if (field.type === 'int') {
          if (Number(el.value) !== field.value) values[name] = el.value === '' ? '' : Number(el.value);
        } else if (el.value.trim() !== (field.value ?? '')) values[name] = el.value.trim();
      }
      if (!Object.keys(values).length) {
        setStatus(form, 'Nothing has changed.');
        return;
      }
      save(values);
    });

    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'admin-settings-title' },
      h('h2', { id: 'admin-settings-title', tabindex: '-1' }, 'Settings and API keys'),
      h('p', { class: 'muted' }, 'Values saved here apply straight away and take priority over the GitHub secrets. Keys are stored encrypted and never shown again in full.'),
      form,
    );
  }

  /* ---------------- Members ---------------- */

  let selfEmail = '';
  function usersCard(email) {
    selfEmail = email;
    const search = h(
      'form',
      { class: 'form form--inline', id: 'admin-user-search', role: 'search' },
      formField('admin-user-q', 'Search by email', { name: 'q', type: 'search', autocomplete: 'off' }),
      h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'button' }, 'Search')),
    );
    search.addEventListener('submit', (e) => {
      e.preventDefault();
      loadUsers(search.elements.q.value);
    });
    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'admin-users-title' },
      h('h2', { id: 'admin-users-title' }, 'Members'),
      h('p', { class: 'muted' }, 'Admins can disable, log out or delete an account, and choose other admins. Health and fitness records are never shown here.'),
      search,
      h('div', { id: 'admin-user-list', 'aria-live': 'polite' }),
    );
  }

  async function loadUsers(q) {
    const list = $('#admin-user-list');
    if (!list) return;
    list.replaceChildren(h('div', { class: 'state state--loading', role: 'status' }, 'Loading members…'));
    try {
      const { users } = await admin.users(q);
      if (!users.length) {
        list.replaceChildren(h('div', { class: 'state state--empty' }, h('p', { class: 'state__title' }, q ? 'No members match' : 'No members yet'), h('p', {}, q ? 'Try part of the email address.' : 'People who join appear here.')));
        return;
      }
      list.replaceChildren(h('ul', { class: 'entries', role: 'list' }, users.map(userItem)));
    } catch (error) {
      list.replaceChildren(h('p', { class: 'notice-inline notice-inline--error' }, error.message));
    }
  }

  function userItem(u) {
    const isSelf = u.email === selfEmail;
    const actions = [];
    const add = (op, label, cls = 'button button--small') => {
      const b = h('button', { type: 'button', class: cls, dataset: { userOp: op } }, label);
      b.addEventListener('click', () => userAction(u, op));
      actions.push(b);
    };
    if (!isSelf) add(u.disabled ? 'enable' : 'disable', u.disabled ? 'Enable' : 'Disable');
    if (!isSelf) add(u.role === 'admin' ? 'remove-admin' : 'make-admin', u.role === 'admin' ? 'Remove admin' : 'Make admin');
    add('logout', 'Log out everywhere');
    if (!isSelf) add('delete', 'Delete', 'button button--small button--danger');
    return h(
      'li',
      { class: 'entry', dataset: { userEmail: u.email } },
      h(
        'div',
        { class: 'entry__body' },
        h('p', { class: 'entry__title' }, u.email, isSelf ? ' (you)' : ''),
        h('div', { class: 'badges' }, u.role === 'admin' ? h('span', { class: 'badge' }, 'Admin') : null, u.disabled ? h('span', { class: 'badge' }, 'Disabled') : null, u.hasPassword ? h('span', { class: 'badge' }, 'Password') : h('span', { class: 'badge' }, 'Codes only')),
        h('p', { class: 'entry__meta' }, `Joined ${when(u.createdAt)} · last login ${when(u.lastLoginAt)} · ${formatNumber(u.recordCount)} synced records`),
      ),
      h('div', { class: 'entry__actions entry__actions--wrap' }, actions),
    );
  }

  async function userAction(u, op) {
    let confirm;
    if (op === 'delete') {
      const ok = await confirmAction({ title: `Delete ${u.email}?`, body: 'The account and everything synced to it will be deleted for good. Data on the member’s own devices is not affected.', confirmLabel: 'Delete account' });
      if (!ok) return;
      confirm = u.email;
    } else if (op === 'disable') {
      const ok = await confirmAction({ title: `Disable ${u.email}?`, body: 'They will be logged out and cannot log in until you enable the account again. Their data is kept.', confirmLabel: 'Disable' });
      if (!ok) return;
    }
    try {
      const res = await admin.updateUser(u.id, op, confirm);
      toast(res.message);
      await loadUsers($('#admin-user-q')?.value ?? '');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  /* ---------------- Tools and audit ---------------- */

  function toolsCard() {
    const button = h('button', { type: 'button', class: 'button', id: 'admin-test-email' }, 'Send me a test email');
    const status = h('p', { class: 'form-status', role: 'status', tabindex: '-1' });
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const res = await admin.testEmail();
        status.className = 'form-status notice-inline';
        status.textContent = res.message;
      } catch (error) {
        status.className = 'form-status notice-inline notice-inline--error';
        status.textContent = error.message;
      } finally {
        button.disabled = false;
        status.focus();
      }
    });
    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'admin-email-title' },
      h('h2', { id: 'admin-email-title' }, 'Email'),
      h('p', { class: 'muted' }, 'Login codes are sent by email, so check sending works after you change the SMTP secrets.'),
      status,
      h('div', { class: 'form__actions' }, button),
    );
  }

  function auditCard() {
    const list = h('div', { id: 'admin-audit-list' });
    const details = h('details', { class: 'disclosure' }, h('summary', {}, 'Show recent activity'), list);
    details.addEventListener('toggle', async () => {
      if (!details.open) return;
      list.replaceChildren(h('div', { class: 'state state--loading', role: 'status' }, 'Loading…'));
      try {
        const { entries } = await admin.audit();
        list.replaceChildren(
          entries.length
            ? h('ul', { class: 'bullets' }, entries.map((e) => h('li', {}, `${when(e.created_at)}: ${e.action}${e.detail && e.action.startsWith('settings') ? ` (${e.detail})` : ''}${e.actor_email ? ` by ${e.actor_email}` : ''}`)))
            : h('p', { class: 'muted' }, 'Nothing yet.'),
        );
      } catch (error) {
        list.replaceChildren(h('p', { class: 'notice-inline notice-inline--error' }, error.message));
      }
    });
    return h('section', { class: 'card', 'aria-labelledby': 'admin-audit-title' }, h('h2', { id: 'admin-audit-title' }, 'Activity log'), h('p', { class: 'muted' }, 'Account and admin changes from the last year. Setting values and personal data are never logged.'), details);
  }

  return { show };
}
