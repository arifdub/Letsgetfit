// Client for /api/admin.php (admins only, except status and setup).

import { call } from './account.js';

const get = (action, query = '') => call(action, { endpoint: 'admin', query });
const post = (action, body = {}) => call(action, { endpoint: 'admin', method: 'POST', body });

export const status = () => get('status');
export const setup = (setupToken) => post('setup', { setupToken });
export const overview = () => get('overview');
export const settings = () => get('settings');
export const saveSettings = (values) => post('settings', { values });
export const users = (q = '') => get('users', q ? `&q=${encodeURIComponent(q)}` : '');
export const updateUser = (id, op, confirm) => post('user', { id, op, confirm });
export const testEmail = () => post('test-email');
export const audit = () => get('audit');
