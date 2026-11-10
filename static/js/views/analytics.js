/** Analytics & Reports. */

import { settings } from '../core/settings.js';
import { DataService } from '../services/dataService.js';
import { exportReport } from '../services/reportService.js';
import { audit, filterAudit } from '../services/auditService.js';
import { renderAuditTab, filteredAudit, auditFilters } from './auditLog.js';
import { icon } from '../ui/icons.js';
import { $, modal, toast } from '../ui/components.js';
import { lineChart, stackedBar, ring, barChart } from '../ui/charts.js';
import { setHTML } from '../ui/widgets.js';
import { FEEDER_STATES } from '../config.js';
import {
  fmtDuration, fmtDate, fmtDateShort, fmtTime, toISODate, fromISODate, esc,
} from '../core/format.js';

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'date', label: 'Custom Date' },
  { id: 'daily', label: 'Daily (this month)' },
  { id: 'weekly', label: 'Weekly (last 7 days)' },
  { id: 'range', label: 'Custom Date Range' },
];
const MAX_RANGE_DAYS = 31;

let period = 'today';
let customDate = toISODate(new Date());
let rangeFrom = toISODate(new Date(Date.now() - 6 * 86400000));
let rangeTo = toISODate(new Date());
let data = null;
let reqId = 0;

function resolveRange() {
  const today = new Date();
  const iso = toISODate;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  switch (period) {
    case 'yesterday': { const y = iso(addDays(today, -1)); return { from: y, to: y, label: 'Yesterday' }; }
    case 'date': return { from: customDate, to: customDate, label: 'Custom Date' };
    case 'daily': return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today), label: 'Daily — Month to date' };
    case 'weekly': return { from: iso(addDays(today, -6)), to: iso(today), label: 'Weekly — Last 7 days' };
    case 'range': return { from: rangeFrom, to: rangeTo, label: 'Custom Date Range' };
    default: return { from: iso(today), to: iso(today), label: 'Today' };
  }
}

function validateRange() {
  const today = toISODate(new Date());
  if (period === 'date' && (!customDate || customDate > today)) return 'Choose a date up to today.';
  if (period === 'range') {
    if (!rangeFrom || !rangeTo) return 'Choose both dates.';
    if (rangeFrom > rangeTo) return '“From” must be before “To”.';
    if (rangeTo > today) return 'The range cannot end in the future.';
    const days = (fromISODate(rangeTo) - fromISODate(rangeFrom)) / 86400000 + 1;
    if (days > MAX_RANGE_DAYS) return `Choose at most ${MAX_RANGE_DAYS} days.`;
  }
  return '';
}

async function load(root) {
  const err = validateRange();
  setHTML($('[data-range-err]', root), err ? `<span class="t-red">${esc(err)}</span>` : '');
  if (err) return;
  const id = ++reqId;
  const body = $('[data-body]', root);
  body.classList.add('loading');
  const range = resolveRange();
  const a = await DataService.getAnalytics(range);
  if (id !== reqId || !document.body.contains(body)) return;
  data = a;
  body.classList.remove('loading');
  if (tab === 'reports') renderReports(root, a); else renderData(root, a);
}

function metric(ic, label, value, sub = '') {
  return `<div class="metric"><div class="eyebrow">${icon(ic, { size: 14 })}${label}</div><div class="metric-val">${value}</div>${sub ? `<div class="metric-sub">${sub}</div>` : ''}</div>`;
}

function renderData(root, a) {
  const s = settings.all;
  const p = a.period;
  const today = toISODate(new Date());
  const span = p.from === p.to ? fmtDate(p.from) : `${fmtDate(p.from)} – ${fmtDate(p.to)}`;
  setHTML($('[data-plabel]', root), `${esc(span)}${p.to === today ? ' · up to now' : ''} · ${p.days} day${p.days === 1 ? '' : 's'} · ${esc(a.source || 'Live data')}`);

  const stTotal = a.states.EMPTY + a.states.PARTIAL + a.states.FULL;
  const pct = (v) => (stTotal ? Math.round((v / stTotal) * 100) : 0);
  const manualSec = a.vfd.manualPeriods.reduce((x, m) => x + m.durationSec, 0);
  const multi = p.days > 1;
  const noData = a.elapsedSec === 0;

  setHTML($('[data-body]', root), noData ? `<section class="card"><div class="banner soft-blue">${icon('info', { size: 18 })}<div><strong>No operating data yet</strong>The plant operating window starts at 06:00. Choose another period.</div></div></section>` : `
    <section class="card">
      <div class="card-head"><div class="card-title">${icon('cpu', { size: 16 })}Production & Operation</div></div>
      <div class="grid-6">
        ${metric('clock', 'Crusher runtime', fmtDuration(a.runtimeSec), `${((a.runtimeSec / Math.max(1, a.elapsedSec)) * 100).toFixed(0)}% of operating time`)}
        ${metric('power', 'Downtime', fmtDuration(a.downtimeSec), `${a.stopEvents.length} stop${a.stopEvents.length === 1 ? '' : 's'}`)}
        ${metric('layers', 'Feeder runtime', fmtDuration(a.feederRuntimeSec))}
        ${metric('zap', 'VFD runtime', fmtDuration(a.vfdRuntimeSec))}
        ${metric('truck', 'Throughput', `${Math.round(a.outputT).toLocaleString('en-IN')}<small>t</small>`, 'Estimated')}
        ${metric('gauge', 'Average rate', `${a.avgTph.toFixed(0)}<small>t/h</small>`, 'While running')}
      </div>
    </section>

    <div class="two-col">
      <div class="stack-y">
        <section class="card">
          <div class="card-head"><div class="card-title">${icon('camera', { size: 16 })}Feeder State Duration · AI</div><span class="subtle" style="font-size:12.5px">Total ${fmtDuration(stTotal)}</span></div>
          ${stackedBar([
            { value: a.states.EMPTY, tone: 'amber', label: 'Empty' },
            { value: a.states.PARTIAL, tone: 'blue', label: 'Partially full' },
            { value: a.states.FULL, tone: 'green', label: 'Full' },
          ])}
          <div class="legend">
            ${['EMPTY', 'PARTIAL', 'FULL'].map((k) => `<div class="legend-item"><span class="sw bg-${FEEDER_STATES[k].tone}"></span>${FEEDER_STATES[k].label}
              <strong>${fmtDuration(a.states[k])}</strong><em>${pct(a.states[k])}% · ${a.detections[k]} detections</em></div>`).join('')}
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div class="card-title">${icon('pulse', { size: 16 })}VFD Frequency Trend</div><span class="subtle" style="font-size:12.5px">${multi ? 'Hourly average' : '10-min samples'}</span></div>
          ${lineChart(a.vfd.trend, {
            height: 190, min: 0, max: 50,
            bands: [{ y: s.freqFull, label: `Full ${s.freqFull}` }, { y: s.freqEmpty, label: `Empty ${s.freqEmpty}` }],
            xLabel: (t) => (multi ? fmtDateShort(t) : new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })),
          })}
          <div class="grid-4" style="margin-top:12px">
            ${metric('pulse', 'Average', `${a.vfd.avgHz.toFixed(1)}<small>Hz</small>`)}
            ${metric('minus', 'Minimum', `${a.vfd.minHz.toFixed(0)}<small>Hz</small>`)}
            ${metric('plus', 'Maximum', `${a.vfd.maxHz.toFixed(0)}<small>Hz</small>`)}
            ${metric('hand', 'Manual', `${a.vfd.manualPeriods.length}<small>× · ${fmtDuration(manualSec, { short: true })}</small>`)}
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div class="card-title">${icon('hand', { size: 16 })}Manual Override Periods</div></div>
          ${a.vfd.manualPeriods.length ? `<div class="table-scroll"><table class="data-table">
            <thead><tr>${multi ? '<th>Date</th>' : ''}<th>Start</th><th>End</th><th class="num">Duration</th><th class="num">Speed</th></tr></thead>
            <tbody>${a.vfd.manualPeriods.slice(-40).reverse().map((m) => `<tr>${multi ? `<td>${fmtDateShort(m.start)}</td>` : ''}<td>${fmtTime(m.start)}</td><td>${fmtTime(m.end)}</td><td class="num">${fmtDuration(m.durationSec, { short: true })}</td><td class="num"><strong>${m.hz} Hz</strong></td></tr>`).join('')}</tbody>
          </table></div>${a.vfd.manualPeriods.length > 40 ? '<p class="form-note" style="margin-top:8px">Showing latest 40. Full list in the downloaded report.</p>' : ''}` : '<p class="subtle">No manual overrides in this period.</p>'}
        </section>
      </div>

      <div class="stack-y">
        <section class="card">
          <div class="card-head"><div class="card-title">${icon('gauge', { size: 16 })}OEE</div></div>
          <div class="oee-wrap">
            ${ring(a.oee.overall, { tone: a.oee.overall >= 75 ? 'green' : a.oee.overall >= 60 ? 'amber' : 'red', label: `${a.oee.overall.toFixed(1)}%`, sub: 'Overall' })}
            <div class="oee-parts">
              ${[['Availability', a.oee.availability], ['Performance', a.oee.performance], ['Quality', a.oee.quality]].map(([k, v]) => `
                <div class="oee-part"><span class="muted">${k}</span><strong>${v.toFixed(1)}%</strong><div class="meter"><span style="width:${Math.min(100, v)}%"></span></div></div>`).join('')}
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div class="card-title">${icon('bell', { size: 16 })}Alerts</div><a class="card-link" href="#/alerts">Open ${icon('chevron', { size: 16 })}</a></div>
          <div class="grid-2 keep">
            ${metric('bell', 'Total', a.alerts.total)}
            ${metric('fault', 'Faults', `<span class="t-red">${a.alerts.fault}</span>`)}
            ${metric('alert', 'Warnings', `<span class="t-amber">${a.alerts.warning}</span>`)}
            ${metric('hand', 'Manual events', a.alerts.manual)}
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div class="card-title">${icon('power', { size: 16 })}Stops & Downtime</div></div>
          ${a.stopEvents.length ? a.stopEvents.slice(-8).reverse().map((e) => `
            <div class="kv"><span>${multi ? `${fmtDateShort(e.start)} · ` : ''}${fmtTime(e.start)} · ${esc(e.reason || '')}</span>
            <strong class="${e.type === 'FAULT' ? 't-red' : ''}">${fmtDuration(e.durationSec, { short: true })}</strong></div>`).join('') : '<p class="subtle">No stops in this period.</p>'}
        </section>

        ${multi ? `<section class="card">
          <div class="card-head"><div class="card-title">${icon('truck', { size: 16 })}Daily Production (t)</div></div>
          ${barChart(a.days.slice(-14).map((d) => ({ label: fmtDateShort(d.date).replace(' ', ' '), value: d.outputT })), { unit: 't' })}
        </section>` : ''}
      </div>
    </div>

    ${multi ? `<section class="card">
      <div class="card-head"><div class="card-title">${icon('table', { size: 16 })}Daily Breakdown</div></div>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Date</th><th class="num">Runtime</th><th class="num">Downtime</th><th class="num">Output</th><th class="num">Avg Hz</th><th class="num">OEE</th></tr></thead>
        <tbody>${a.days.slice().reverse().map((d) => `<tr><td>${fmtDate(d.date)}</td><td class="num">${fmtDuration(d.runtimeSec, { short: true })}</td><td class="num">${fmtDuration(d.downtimeSec, { short: true })}</td><td class="num">${Math.round(d.outputT)} t</td><td class="num">${d.avgHz.toFixed(1)}</td><td class="num"><strong>${d.oee.toFixed(1)}%</strong></td></tr>`).join('')}</tbody>
      </table></div>
    </section>` : ''}`);
}

const REPORT_TYPES = [
  { id: 'operational', label: 'Operational Report', desc: 'Runtime, downtime, AI feeder states, VFD, manual overrides, alerts, OEE' },
  { id: 'audit', label: 'Audit Log', desc: 'Who did what, when, from which IP — with previous and new values' },
  { id: 'complete', label: 'Complete Report', desc: 'Operational report plus the audit log for the same period' },
];
const FORMATS = [
  { id: 'pdf', label: 'PDF', desc: 'Formatted report with charts', ic: 'file' },
  { id: 'excel', label: 'Excel', desc: '.xlsx workbook, one sheet per section', ic: 'table' },
  { id: 'csv', label: 'CSV', desc: 'Plain data for other tools', ic: 'file' },
];
let reportType = 'operational';
let reportFormat = 'pdf';

function radioList(name, items, selected) {
  return `<div class="radio-list" role="radiogroup">${items.map((it) => `
    <label class="radio-opt"><input type="radio" name="${name}" value="${it.id}" ${it.id === selected ? 'checked' : ''}>${it.ic ? icon(it.ic, { size: 20 }) : ''}<span><strong>${it.label}</strong><small>${it.desc}</small></span></label>`).join('')}</div>`;
}

function periodSpan(p) {
  return p.from === p.to ? fmtDate(p.from) : `${fmtDate(p.from)} – ${fmtDate(p.to)}`;
}

/** Runs the export. `auditOverride` = already-filtered records from the Audit Log tab. */
async function runExport(type, fmtSel, auditOverride) {
  const all = await audit.list();
  if (type === 'audit' && auditOverride) {
    const f = auditFilters;
    return exportReport(fmtSel, {
      type: 'audit',
      audit: auditOverride,
      period: { label: 'Audit Log (filtered)', from: f.from || '', to: f.to || f.from || '' },
    });
  }
  if (!data) throw new Error('Report data is still loading');
  const p = data.period;
  const records = filterAudit(all, { from: p.from, to: p.to });
  return exportReport(fmtSel, { type, analytics: data, audit: records, period: { label: p.label, from: p.from, to: p.to } });
}

function openDownload({ type = reportType, auditOverride = null } = {}) {
  if (!data && !auditOverride) return;
  const fromAudit = !!auditOverride;
  const sub = fromAudit
    ? `${auditOverride.length} audit record${auditOverride.length === 1 ? '' : 's'} (current filters)`
    : `${esc(data.period.label)} · ${esc(periodSpan(data.period))}`;
  modal({
    title: 'Download Report',
    size: 'sm',
    body: `
      <p class="muted" style="margin-bottom:12px;font-size:14px">${sub}</p>
      ${fromAudit ? '' : `<div class="eyebrow" style="margin-bottom:8px">Report type</div>${radioList('rtype', REPORT_TYPES, type)}<div style="height:14px"></div>`}
      <div class="eyebrow" style="margin-bottom:8px">Select format</div>
      ${radioList('fmt', FORMATS, reportFormat)}`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-dl>${icon('download', { size: 18 })}Download</button>`,
    onMount(el, done) {
      el.querySelector('.modal-foot [data-close]').onclick = done;
      const btn = el.querySelector('[data-dl]');
      btn.onclick = async () => {
        const fmtSel = el.querySelector('input[name="fmt"]:checked').value;
        const t = fromAudit ? 'audit' : el.querySelector('input[name="rtype"]:checked').value;
        reportFormat = fmtSel;
        if (!fromAudit) reportType = t;
        btn.disabled = true;
        btn.textContent = 'Preparing…';
        try {
          await runExport(t, fmtSel, auditOverride);
          toast(`${fmtSel === 'excel' ? 'Excel' : fmtSel.toUpperCase()} report downloaded`, 'success');
          done();
        } catch (e) {
          toast(e.message || 'Report could not be created', 'error');
          btn.disabled = false;
          btn.innerHTML = `${icon('download', { size: 18 })}Download`;
        }
      };
    },
  });
}

/** Reports tab body (uses the selected period). */
async function renderReports(root, a) {
  const p = a.period;
  const records = filterAudit(await audit.list(), { from: p.from, to: p.to });
  setHTML($('[data-plabel]', root), `${esc(periodSpan(p))} · ${p.days} day${p.days === 1 ? '' : 's'} · ${esc(a.source || 'Live data')}`);
  setHTML($('[data-body]', root), `
    <div class="two-col">
      <section class="card">
        <div class="card-head"><div class="card-title">${icon('file', { size: 16 })}Report Builder</div></div>
        <div class="eyebrow" style="margin-bottom:8px">Report type</div>
        <div data-rtype>${radioList('rtype-inline', REPORT_TYPES, reportType)}</div>
        <div class="eyebrow" style="margin:16px 0 8px">Format</div>
        <div data-rfmt>${radioList('fmt-inline', FORMATS, reportFormat)}</div>
        <button class="btn btn-primary btn-block" data-build style="margin-top:16px">${icon('download', { size: 18 })}Download Report</button>
      </section>
      <div class="stack-y">
        <section class="card">
          <div class="card-head"><div class="card-title">${icon('calendar', { size: 16 })}Period Summary</div></div>
          <div class="kv"><span>Period</span><strong>${esc(p.label)}</strong></div>
          <div class="kv"><span>Dates</span><strong>${esc(periodSpan(p))}</strong></div>
          <div class="kv"><span>Crusher runtime</span><strong>${fmtDuration(a.runtimeSec)}</strong></div>
          <div class="kv"><span>Downtime</span><strong>${fmtDuration(a.downtimeSec)}</strong></div>
          <div class="kv"><span>Throughput</span><strong>${Math.round(a.outputT)} t</strong></div>
          <div class="kv"><span>Manual overrides</span><strong>${a.vfd.manualPeriods.length}</strong></div>
          <div class="kv"><span>OEE</span><strong>${a.oee.overall.toFixed(1)}%</strong></div>
          <div class="kv"><span>Audit records</span><strong>${records.length}</strong></div>
        </section>
        <section class="card">
          <div class="card-title" style="margin-bottom:8px">${icon('info', { size: 16 })}Included</div>
          <p class="form-note"><strong>Operational:</strong> report period, crusher status summary, runtime, downtime, feeder AI detection and state duration, VFD frequency and trend, manual override events, stops, alerts, OEE${p.days > 1 ? ', daily breakdown' : ''}.</p>
          <p class="form-note" style="margin-top:6px"><strong>Audit Log:</strong> date, time, user, role, IP address, action, details, previous and new values.</p>
        </section>
      </div>
    </div>`);
  $('[data-rtype]', root).addEventListener('change', (e) => { reportType = e.target.value; });
  $('[data-rfmt]', root).addEventListener('change', (e) => { reportFormat = e.target.value; });
  $('[data-build]', root).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await runExport(reportType, reportFormat);
      toast(`${reportFormat === 'excel' ? 'Excel' : reportFormat.toUpperCase()} report downloaded`, 'success');
    } catch (err) {
      toast(err.message || 'Report could not be created', 'error');
    }
    btn.disabled = false;
  });
}

const TABS = [
  { id: 'analytics', label: 'Analytics', ic: 'chart' },
  { id: 'reports', label: 'Reports', ic: 'file' },
  { id: 'audit', label: 'Audit Log', ic: 'shield' },
];
let tab = 'analytics';
let offAudit = null;

export default {
  id: 'analytics',
  head: () => ({ title: 'Analytics & Reports', subtitle: 'Production, AI feeder, VFD, OEE and audit log' }),

  render(root) {
    const q = /[?&]tab=(\w+)/.exec(location.hash);
    tab = q && TABS.some((t) => t.id === q[1]) ? q[1] : 'analytics';
    root.innerHTML = `
      <div class="stack-y">
        <div class="seg view-tabs" role="tablist" aria-label="Analytics sections">
          ${TABS.map((t) => `<button type="button" role="tab" data-tab="${t.id}" class="${t.id === tab ? 'on' : ''}" aria-selected="${t.id === tab}">${icon(t.ic, { size: 16 })}${t.label}</button>`).join('')}
        </div>
        <div data-tabbody></div>
      </div>`;
    root.querySelector('.view-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b || b.dataset.tab === tab) return;
      tab = b.dataset.tab;
      history.replaceState(null, '', `#/analytics${tab === 'analytics' ? '' : `?tab=${tab}`}`);
      root.querySelectorAll('[data-tab]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      this.renderTab(root);
    });
    this.renderTab(root);
  },

  renderTab(root) {
    offAudit?.();
    offAudit = null;
    const body = $('[data-tabbody]', root);
    if (tab === 'audit') {
      body.className = 'stack-y';
      offAudit = renderAuditTab(body, { onExport: () => openDownload({ type: 'audit', auditOverride: filteredAudit() }) });
      return;
    }
    const today = toISODate(new Date());
    body.className = 'stack-y';
    body.innerHTML = `
      <section class="card">
        <div class="period-bar">
          <label class="sr-only" for="period">Report period</label>
          <select id="period" class="select" data-period>${PERIODS.map((p) => `<option value="${p.id}" ${p.id === period ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
          <div class="dates" data-date hidden><input type="date" data-d1 max="${today}" value="${customDate}" aria-label="Date"></div>
          <div class="dates" data-range hidden>
            <input type="date" data-r1 max="${today}" value="${rangeFrom}" aria-label="From date"><span class="subtle">to</span>
            <input type="date" data-r2 max="${today}" value="${rangeTo}" aria-label="To date">
          </div>
          ${tab === 'analytics' ? `<button class="btn btn-primary btn-sm" data-download style="margin-left:auto">${icon('download', { size: 17 })}Download Report</button>` : ''}
        </div>
        <div class="period-label" data-plabel></div>
        <div class="period-label" data-range-err></div>
      </section>
      <div class="stack-y" data-body><section class="card subtle">Loading…</section></div>`;
    const sync = () => {
      $('[data-date]', body).hidden = period !== 'date';
      $('[data-range]', body).hidden = period !== 'range';
    };
    sync();
    $('[data-period]', body).addEventListener('change', (e) => { period = e.target.value; sync(); load(body); });
    $('[data-d1]', body).addEventListener('change', (e) => { customDate = e.target.value; load(body); });
    $('[data-r1]', body).addEventListener('change', (e) => { rangeFrom = e.target.value; load(body); });
    $('[data-r2]', body).addEventListener('change', (e) => { rangeTo = e.target.value; load(body); });
    $('[data-download]', body)?.addEventListener('click', () => openDownload());
    load(body);
  },

  destroy() { offAudit?.(); offAudit = null; },
};
