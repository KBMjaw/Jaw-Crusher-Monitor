/** Audit Log tab (inside Analytics & Reports). */

import { audit, filterAudit, AUDIT, actionLabel, recordTrust } from '../services/auditService.js';
import { icon } from '../ui/icons.js';
import { $ } from '../ui/components.js';
import { setHTML } from '../ui/widgets.js';
import { APP } from '../config.js';
import { esc, fmtDate, fmtTime, toISODate } from '../core/format.js';

const PAGE = 50;
export const auditFilters = { from: '', to: '', user: '', role: '', action: '', ip: '' };
let shown = PAGE;
let all = [];

const TONE = {
  LOGIN: 'green', LOGOUT: 'gray', LOGIN_FAILED: 'red', PIN_FAILED: 'red', PIN_VERIFIED: 'blue',
  MANUAL_OVERRIDE_ENABLED: 'amber', MANUAL_OVERRIDE_DISABLED: 'blue', EMPTY_SPEED_CHANGED: 'amber',
  FREQUENCY_SETTING_CHANGED: 'amber', MANUAL_RANGE_CHANGED: 'amber',
};
const tone = (a) => TONE[a] || 'gray';

function change(r) {
  if (!r.prev && !r.next) return '';
  return `<span class="audit-change"><span>${esc(r.prev || '—')}</span>${icon('arrowRight', { size: 13 })}<strong>${esc(r.next || '—')}</strong></span>`;
}

function ipCell(r) {
  const t = recordTrust(r);
  return `<span class="mono audit-ip">${esc(r.ip)}</span>${r.ipSimulated ? '<span class="tag-sim" title="Simulated IP address — prototype">Simulated</span>' : ''}${t.verified ? '<span class="tag-ok">Verified</span>' : ''}`;
}

function options(values, current, allLabel) {
  return `<option value="">${allLabel}</option>${values.map((v) => `<option value="${esc(v.value ?? v)}" ${(v.value ?? v) === current ? 'selected' : ''}>${esc(v.label ?? v)}</option>`).join('')}`;
}

export function filteredAudit() {
  return filterAudit(all, auditFilters);
}

export function renderAuditTab(el, { onExport }) {
  const today = toISODate(new Date());
  el.innerHTML = `
    <section class="card">
      <div class="card-head">
        <div class="card-title">${icon('shield', { size: 16 })}Audit Log</div>
        <button class="btn btn-primary btn-sm" data-export>${icon('download', { size: 16 })}Export</button>
      </div>
      <div class="audit-filters">
        <label><span>From</span><input type="date" data-f="from" max="${today}" value="${auditFilters.from}"></label>
        <label><span>To</span><input type="date" data-f="to" max="${today}" value="${auditFilters.to}"></label>
        <label><span>User</span><select class="select" data-f="user"></select></label>
        <label><span>Role</span><select class="select" data-f="role"></select></label>
        <label><span>Action</span><select class="select" data-f="action"></select></label>
        <label><span>IP address</span><input type="search" data-f="ip" placeholder="e.g. 192.168.1" value="${esc(auditFilters.ip)}" inputmode="decimal"></label>
      </div>
      <div class="audit-bar">
        <span class="subtle" data-count></span>
        <button class="btn btn-ghost btn-sm" data-clear>${icon('x', { size: 15 })}Clear filters</button>
      </div>
      ${APP.dataSource === 'mock' ? `<div class="banner soft-gray" style="margin-top:12px;font-size:12.5px">${icon('info', { size: 16 })}<div><b>Unverified prototype records.</b> These entries are created and stored on this device only, and IP addresses marked <b>Simulated</b> are not real. They are not a secure audit trail. When the FastAPI backend is connected, its audit service will provide verified records.</div></div>` : ''}
    </section>
    <section class="card audit-list" data-list aria-live="polite"></section>`;

  const refreshOptions = () => {
    const users = [...new Set(all.map((r) => r.username))].sort();
    const roles = [...new Set(all.map((r) => r.role))].sort();
    const actions = Object.values(AUDIT).filter((a) => all.some((r) => r.action === a.key)).map((a) => ({ value: a.key, label: a.label }));
    setHTML($('[data-f="user"]', el), options(users, auditFilters.user, 'All users'));
    setHTML($('[data-f="role"]', el), options(roles, auditFilters.role, 'All roles'));
    setHTML($('[data-f="action"]', el), options(actions, auditFilters.action, 'All actions'));
  };

  const renderList = () => {
    const list = filteredAudit();
    setHTML($('[data-count]', el), `${list.length} record${list.length === 1 ? '' : 's'}${list.length !== all.length ? ` of ${all.length}` : ''}`);
    const page = list.slice(0, shown);
    if (!page.length) {
      setHTML($('[data-list]', el), all.length
        ? '<p class="subtle" style="text-align:center;padding:24px 0">No audit records match these filters.</p>'
        : `<div class="audit-empty">${icon('shield', { size: 28 })}<strong>No audit records yet</strong><span>Logins, manual control, speed and setting changes made in this app will appear here.</span></div>`);
      return;
    }
    const rows = page.map((r) => `<tr>
      <td><div>${fmtDate(r.ts)}</div><div class="subtle">${fmtTime(r.ts)}</div></td>
      <td><strong>${esc(r.username)}</strong></td>
      <td>${esc(r.role)}</td>
      <td>${ipCell(r)}</td>
      <td><span class="chip chip-${tone(r.action)}">${esc(actionLabel(r.action))}</span></td>
      <td class="audit-details">${esc(r.details)}${change(r)}</td>
    </tr>`).join('');
    const cards = page.map((r) => `<article class="audit-card">
      <div class="audit-card-top"><span class="chip chip-${tone(r.action)}">${esc(actionLabel(r.action))}</span><time>${fmtDate(r.ts)} · ${fmtTime(r.ts)}</time></div>
      ${r.details ? `<div class="audit-card-details">${esc(r.details)}</div>` : ''}
      ${change(r)}
      <div class="audit-card-meta">${icon('user', { size: 13 })}${esc(r.username)} · ${esc(r.role)}<span>${icon('wifi', { size: 13 })}${ipCell(r)}</span></div>
    </article>`).join('');
    setHTML($('[data-list]', el), `
      <div class="table-scroll audit-table"><table class="data-table">
        <thead><tr><th>Date &amp; Time</th><th>User</th><th>Role</th><th>IP Address</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="audit-cards">${cards}</div>
      ${list.length > shown ? `<button class="btn btn-ghost btn-block" data-more style="margin-top:12px">Show more (${list.length - shown} remaining)</button>` : ''}`);
  };

  el.addEventListener('input', (e) => {
    const k = e.target.dataset.f;
    if (!k) return;
    auditFilters[k] = e.target.value;
    shown = PAGE;
    renderList();
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { shown += PAGE; renderList(); }
    if (e.target.closest('[data-clear]')) {
      Object.keys(auditFilters).forEach((k) => { auditFilters[k] = ''; });
      el.querySelectorAll('[data-f]').forEach((i) => { i.value = ''; });
      shown = PAGE;
      refreshOptions();
      renderList();
    }
    if (e.target.closest('[data-export]')) onExport();
  });

  const load = async () => {
    all = await audit.list();
    refreshOptions();
    renderList();
  };
  load();
  return audit.subscribe(load); // live updates while the tab is open
}
