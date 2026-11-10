/**
 * Audit log service — WHO did WHAT, WHEN, FROM WHERE, and WHAT CHANGED.
 *
 * PROTOTYPE (APP.dataSource === 'mock'):
 *   Records are written in this browser's localStorage and the IP address is
 *   SIMULATED. This is a demo log, not a trustworthy audit trail — anyone with
 *   access to the device can alter it.
 *
 * PRODUCTION (APP.dataSource === 'api'):
 *   The FastAPI Audit Service is the authoritative source. The backend takes
 *   user, role, session, client IP and timestamp from the authenticated request
 *   and stores the record in its database. The PWA only sends the action
 *   (POST /api/v1/audit) and displays what GET /api/v1/audit returns.
 */

import { APP } from '../config.js';
import { local, session } from '../core/storage.js';
import { settings } from '../core/settings.js';

/** Action catalog. `key` is stored; `label` is displayed. */
export const AUDIT = {
  LOGIN: { key: 'LOGIN', label: 'Successful Login', group: 'Access' },
  LOGIN_FAILED: { key: 'LOGIN_FAILED', label: 'Failed Login', group: 'Access' },
  LOGOUT: { key: 'LOGOUT', label: 'User Logout', group: 'Access' },
  MANUAL_OVERRIDE_ENABLED: { key: 'MANUAL_OVERRIDE_ENABLED', label: 'Manual Override Enabled', group: 'Feeder control' },
  MANUAL_OVERRIDE_DISABLED: { key: 'MANUAL_OVERRIDE_DISABLED', label: 'Manual Override Disabled', group: 'Feeder control' },
  EMPTY_SPEED_CHANGED: { key: 'EMPTY_SPEED_CHANGED', label: 'Manual Empty Speed Changed', group: 'Feeder control' },
  FREQUENCY_SETTING_CHANGED: { key: 'FREQUENCY_SETTING_CHANGED', label: 'Frequency Setting Changed', group: 'Configuration' },
  MANUAL_RANGE_CHANGED: { key: 'MANUAL_RANGE_CHANGED', label: 'Manual Empty Range Changed', group: 'Configuration' },
  PIN_VERIFIED: { key: 'PIN_VERIFIED', label: 'Settings PIN Verified', group: 'Configuration' },
  PIN_FAILED: { key: 'PIN_FAILED', label: 'Settings PIN Incorrect', group: 'Configuration' },
  PROFILE_UPDATED: { key: 'PROFILE_UPDATED', label: 'Profile Updated', group: 'Account' },
  PROFILE_PHOTO_CHANGED: { key: 'PROFILE_PHOTO_CHANGED', label: 'Profile Photo Changed', group: 'Account' },
  PASSWORD_CHANGED: { key: 'PASSWORD_CHANGED', label: 'Password Changed', group: 'Account' },
  COMPANY_DETAILS_UPDATED: { key: 'COMPANY_DETAILS_UPDATED', label: 'Company Details Updated', group: 'Branding' },
  COMPANY_LOGO_CHANGED: { key: 'COMPANY_LOGO_CHANGED', label: 'Company Logo Changed', group: 'Branding' },
  NOTIFICATION_SETTING_CHANGED: { key: 'NOTIFICATION_SETTING_CHANGED', label: 'Notification Setting Changed', group: 'Settings' },
  SETTINGS_CHANGED: { key: 'SETTINGS_CHANGED', label: 'Settings Changed', group: 'Settings' },
};
export const actionLabel = (key) => AUDIT[key]?.label || key;

const STORE_KEY = 'audit';
const MAX_RECORDS = 2000;
const listeners = new Set();

/* ── Client context (mock) ───────────────────────────────────────────
 * A browser cannot reliably know its own IP address. For the demo, each
 * device gets one simulated LAN address. The backend will replace this
 * with the real client IP from the request.
 */
const DEMO_IPS = ['192.168.1.105', '192.168.1.112', '192.168.1.118', '192.168.1.124'];
function demoDeviceIp() {
  let ip = local.get('demoDeviceIp');
  if (!ip) {
    ip = DEMO_IPS[Math.floor(Math.random() * DEMO_IPS.length)];
    local.set('demoDeviceIp', ip);
  }
  return ip;
}

export function clientContext() {
  const user = session.get('session') || local.get('session');
  return {
    username: user?.username || 'unknown',
    role: settings.get('profileRole') || 'Administrator',
    ip: demoDeviceIp(),
    sessionId: user?.sessionId || null,
    ipSimulated: true,
  };
}

/**
 * Fresh installs start with an EMPTY log — only real actions in this app
 * create records. Earlier prototype builds stored example entries
 * (source 'demo-seed'); they are removed once on load.
 */
function load() {
  const stored = local.get(STORE_KEY);
  if (!Array.isArray(stored)) return [];
  const real = stored
    .filter((r) => r && r.source !== 'demo-seed')
    // records from earlier builds lack the trust fields
    // Device records are never "verified" (also protects against edited storage).
    .map((r) => ({ ...r, ipSimulated: 'ipSimulated' in r ? !!r.ipSimulated : r.username !== 'system', verified: false }));
  local.set(STORE_KEY, real);
  return real;
}

/** How trustworthy a record is — shown in the UI and in exports. */
export function recordTrust(r) {
  if (r.verified) return { verified: true, label: 'Verified (server)', ip: r.ip };
  return {
    verified: false,
    label: 'Unverified (device record)',
    ip: r.ipSimulated ? `${r.ip} (simulated)` : r.ip,
  };
}

let records = null;

export const audit = {
  /**
   * Record an action. Only `action`, `details`, `prev`, `next` come from the
   * caller; identity, IP and time come from the session context.
   */
  record({ action, details = '', prev = '', next = '', username, role }) {
    if (action && typeof action === 'object') action = action.key; // accept AUDIT.X or 'X'
    const ctx = clientContext();
    const rec = {
      id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      ts: new Date().toISOString(),
      username: username || ctx.username,
      role: role || ctx.role,
      ip: username === 'system' ? 'system' : ctx.ip,
      ipSimulated: username !== 'system' && APP.dataSource === 'mock',
      verified: false, // only the backend audit service produces verified records
      sessionId: ctx.sessionId,
      action: AUDIT[action]?.key || action,
      details: String(details),
      prev: prev == null ? '' : String(prev),
      next: next == null ? '' : String(next),
      source: APP.dataSource === 'mock' ? 'device-demo' : 'pending-server',
    };
    if (APP.dataSource === 'api') {
      // Backend fills in the authoritative user / IP / timestamp.
      fetch(`${APP.apiBase}/api/v1/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: rec.action, details: rec.details, prev: rec.prev, next: rec.next }),
      }).catch(() => {});
    }
    records = [rec, ...(records || load())].slice(0, MAX_RECORDS);
    local.set(STORE_KEY, records);
    listeners.forEach((fn) => fn(rec));
    return rec;
  },

  /** All records, newest first. Mirrors GET /api/v1/audit. */
  async list() {
    if (APP.dataSource === 'api') {
      const res = await fetch(`${APP.apiBase}/api/v1/audit?limit=${MAX_RECORDS}`);
      // Records from the backend audit service are the authoritative ones.
      return (await res.json()).map((r) => ({ ...r, verified: true, ipSimulated: false }));
    }
    records = records || load();
    return records;
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Filter helper shared by the Audit Log view and report export. */
export function filterAudit(list, f = {}) {
  const ip = (f.ip || '').trim();
  return list.filter((r) => {
    const day = toLocalISO(r.ts);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.user && r.username !== f.user) return false;
    if (f.role && r.role !== f.role) return false;
    if (f.action && r.action !== f.action) return false;
    if (ip && !r.ip.includes(ip)) return false;
    return true;
  });
}

function toLocalISO(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── Settings change → audit records (single place, with previous values) ── */

const hz = (v) => `${v} Hz`;
const onOff = (v) => (v ? 'On' : 'Off');
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

export function installSettingsAudit() {
  settings.subscribe((cur, changed, prev) => {
    const diff = (k) => k in changed && prev[k] !== cur[k];
    const freqNames = { freqFull: 'Full', freqPartial: 'Partially Full', freqEmpty: 'Empty' };
    Object.entries(freqNames).forEach(([k, name]) => {
      if (diff(k)) audit.record({ action: 'FREQUENCY_SETTING_CHANGED', details: `Changed ${name} Frequency`, prev: hz(prev[k]), next: hz(cur[k]) });
    });
    if (diff('manualMin') || diff('manualMax')) {
      audit.record({
        action: 'MANUAL_RANGE_CHANGED',
        details: 'Changed Manual Empty Range',
        prev: `${prev.manualMin}–${prev.manualMax} Hz`,
        next: `${cur.manualMin}–${cur.manualMax} Hz`,
      });
    }
    if (diff('profileName')) audit.record({ action: 'PROFILE_UPDATED', details: 'Profile name changed', prev: prev.profileName, next: cur.profileName });
    if (diff('profileRole')) audit.record({ action: 'PROFILE_UPDATED', details: 'Role changed', prev: prev.profileRole, next: cur.profileRole, role: prev.profileRole });
    if (diff('profilePhoto')) audit.record({ action: 'PROFILE_PHOTO_CHANGED', details: 'Profile photo', prev: prev.profilePhoto ? 'Photo set' : 'None', next: cur.profilePhoto ? 'New photo' : 'Removed' });
    if (diff('companyName')) audit.record({ action: 'COMPANY_DETAILS_UPDATED', details: 'Company name changed', prev: prev.companyName, next: cur.companyName });
    if (diff('plantName')) audit.record({ action: 'COMPANY_DETAILS_UPDATED', details: 'Plant / Site changed', prev: prev.plantName, next: cur.plantName });
    if (diff('companyLogo')) audit.record({ action: 'COMPANY_LOGO_CHANGED', details: 'Company logo', prev: prev.companyLogo ? 'Custom logo' : 'Default logo', next: cur.companyLogo ? 'New logo uploaded' : 'Default logo restored' });
    if (diff('notifications')) audit.record({ action: 'NOTIFICATION_SETTING_CHANGED', details: 'Push notifications', prev: onOff(prev.notifications), next: onOff(cur.notifications) });
    if (diff('theme')) audit.record({ action: 'SETTINGS_CHANGED', details: 'Theme changed', prev: cap(prev.theme), next: cap(cur.theme) });
    if (diff('supportPhone')) audit.record({ action: 'SETTINGS_CHANGED', details: 'Support phone changed', prev: prev.supportPhone, next: cur.supportPhone });
    if (diff('supportEmail')) audit.record({ action: 'SETTINGS_CHANGED', details: 'Support email changed', prev: prev.supportEmail, next: cur.supportEmail });
  });
}
