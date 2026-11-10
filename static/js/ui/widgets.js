/** Composite widgets shared between views. */

import { icon } from './icons.js';
import { toneChip } from './components.js';
import { FEEDER_STATES, CRUSHER_STATES, SEVERITY } from '../config.js';
import { esc, fmtTime, relTime } from '../core/format.js';

/** Replace innerHTML only when it changed (avoids flicker / lost hover). */
export function setHTML(el, html) {
  if (el && el.__html !== html) {
    el.innerHTML = html;
    el.__html = html;
  }
}

export function feederTone(ai) { return FEEDER_STATES[ai]?.tone || 'gray'; }

/** Configured frequency table with the active state highlighted. */
export function freqTableHTML(st, s) {
  const { feeder, vfd } = st;
  const rows = [
    ['FULL', 'Full', s.freqFull],
    ['PARTIAL', 'Partial', s.freqPartial],
    ['EMPTY', 'Empty', s.freqEmpty],
  ];
  return `<div class="freq-table">${rows.map(([k, label, f]) => {
    const active = feeder.aiState === k;
    const manual = active && vfd.mode === 'MANUAL';
    return `<div class="freq-cell${active ? ' active' : ''}${manual ? ' overridden' : ''}">
      ${manual ? `<span class="tag">MANUAL ${vfd.manualHz} Hz</span>` : ''}
      <div class="eyebrow">${label}</div>
      <div class="v">${f}<small>Hz</small></div>
    </div>`;
  }).join('')}</div>`;
}

/** Dashboard VFD card body: AI state vs VFD command clearly separated. */
export function vfdCardHTML(st, s) {
  const { feeder, vfd } = st;
  const ai = FEEDER_STATES[feeder.aiState];
  const manual = vfd.mode === 'MANUAL';
  let banner = '';
  if (vfd.interlock) {
    banner = `<div class="banner soft-gray" style="margin-top:12px">${icon('power', { size: 18 })}<div><strong>Feeder stopped (interlock)</strong>Crusher is not running — VFD command 0 Hz. AI detection continues.</div></div>`;
  } else if (manual) {
    banner = `<div class="banner soft-amber" style="margin-top:12px">${icon('hand', { size: 18 })}<div><strong>Manual override active${vfd.atMax ? ' · MAXIMUM' : ''}</strong>Empty speed set to ${vfd.commandHz} Hz by operator. AI detection is still running.</div></div>`;
  }
  return `
    <div class="vfd-hero">
      <div>
        <div class="eyebrow">VFD Command</div>
        <div class="huge-value" style="margin-top:6px">${vfd.commandHz}<small>Hz</small></div>
        <div class="subtle" style="font-size:12.5px;margin-top:6px">Drive output ${Number(vfd.outputHz).toFixed(1)} Hz · ${esc(vfd.driveStatus)}</div>
      </div>
      <div class="vfd-meta">
        <span>Control</span><strong class="${manual ? 't-amber' : 't-blue'}">${manual ? 'MANUAL' : 'AUTO'}</strong>
        <span>AI state</span><strong class="t-${ai.tone}">${ai.label.toUpperCase()}</strong>
        <span>Source</span><strong>${vfd.interlock ? 'Interlock' : manual ? 'Operator' : 'AI auto'}</strong>
      </div>
    </div>
    <div style="margin-top:16px">${freqTableHTML(st, s)}</div>
    ${banner}`;
}

export function crusherCardHTML(st) {
  const c = CRUSHER_STATES[st.crusher.status] || CRUSHER_STATES.STOPPED;
  return `
    <div class="row">
      <div class="icon-tile soft-${c.tone}">${icon('cpu', { size: 22 })}</div>
      <div class="eyebrow">Crusher Status</div>
    </div>
    <div class="status-value t-${c.tone}">${c.label.toUpperCase()}</div>
    <div class="status-note">${esc(c.note)}</div>`;
}

export function feederCardHTML(st) {
  const f = FEEDER_STATES[st.feeder.aiState];
  return `
    <div class="row">
      <div class="icon-tile soft-${f.tone}">${icon('layers', { size: 22 })}</div>
      <div class="eyebrow">Feeder · AI Detection</div>
    </div>
    <div class="status-value t-${f.tone}">${f.label.toUpperCase()}</div>
    <div class="status-note">${esc(f.long)} · ${st.feeder.confidence}% confidence</div>`;
}

export function alertRowHTML(a, { compact = false } = {}) {
  const sev = SEVERITY[a.severity] || SEVERITY.info;
  const ic = { fault: 'fault', warning: 'alert', info: 'info', normal: 'checkCircle' }[a.severity] || 'info';
  return `<div class="alert-row" data-id="${esc(a.id)}">
    <div class="icon-tile soft-${sev.tone}">${icon(ic, { size: 18 })}</div>
    <div class="grow">
      <div class="title">${!a.read ? '<span class="unread-dot" aria-hidden="true"></span><span class="sr-only">Unread: </span>' : ''}${esc(a.title)}</div>
      <div class="desc">${esc(a.description)}</div>
      ${compact ? '' : `<div class="subtle" style="font-size:12px;margin-top:3px">${esc(a.source || '')} · ${relTime(a.time)}</div>`}
    </div>
    <div class="meta"><time datetime="${esc(a.time)}">${fmtTime(a.time)}</time>${toneChip(sev.tone, sev.label, { dot: false })}</div>
  </div>`;
}
