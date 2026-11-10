/**
 * Demo authentication for the frontend prototype.
 *
 * This is NOT secure: credentials are checked in the browser and a changed
 * password is stored only on this device. Replace `login()` and
 * `changePassword()` with calls to the FastAPI auth endpoints when the
 * backend exists (see services/apiService.js).
 */

import { APP } from '../config.js';
import { local, session } from './storage.js';
import { audit } from '../services/auditService.js';

const SESSION_KEY = 'session';

function demoPassword() {
  return local.get('demoPassword', APP.demoUser.password);
}

export const auth = {
  get user() {
    return session.get(SESSION_KEY) || local.get(SESSION_KEY);
  },

  get rememberedUsername() {
    return local.get('rememberUser', '');
  },

  async login(username, password, remember) {
    await new Promise((r) => setTimeout(r, 450)); // simulate network latency
    const u = String(username || '').trim();
    if (!u || !password) throw new Error('Enter username and password');
    if (u.toLowerCase() !== APP.demoUser.username || password !== demoPassword()) {
      audit.record({ action: 'LOGIN_FAILED', details: 'Incorrect username or password', username: u.slice(0, 40), role: '—' });
      throw new Error('Incorrect username or password');
    }
    const user = { username: u.toLowerCase(), loginAt: Date.now(), sessionId: Math.random().toString(36).slice(2, 10) };
    session.set(SESSION_KEY, user);
    if (remember) {
      local.set(SESSION_KEY, user);
      local.set('rememberUser', u);
    } else {
      local.remove(SESSION_KEY);
      local.remove('rememberUser');
    }
    audit.record({ action: 'LOGIN', details: remember ? 'Login (remember me)' : 'Login' });
    return user;
  },

  logout() {
    if (this.user) audit.record({ action: 'LOGOUT', details: 'User logout' });
    session.remove(SESSION_KEY);
    session.remove('pinOkUntil');
    local.remove(SESSION_KEY);
  },

  /** Returns an object of field → error message; empty object on success. */
  async changePassword({ current, next, confirm }) {
    const errors = {};
    if (!current) errors.current = 'Enter your current password';
    else if (current !== demoPassword()) errors.current = 'Current password is incorrect';
    if (!next) errors.next = 'Enter a new password';
    else if (next.length < 5) errors.next = 'Use at least 5 characters';
    else if (next === current) errors.next = 'New password must be different';
    if (!confirm) errors.confirm = 'Confirm the new password';
    else if (next && confirm !== next) errors.confirm = 'Passwords do not match';
    if (Object.keys(errors).length) return errors;
    local.set('demoPassword', next);
    audit.record({ action: 'PASSWORD_CHANGED', details: 'Password changed (values are never recorded)' });
    return {};
  },
};
