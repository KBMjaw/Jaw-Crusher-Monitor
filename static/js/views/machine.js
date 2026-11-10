/**
 * Machine / Feeder Control.
 * Keeps AI DETECTION (what the camera sees) visually separate from the
 * VFD COMMAND (what the drive is told). Manual is offered only while EMPTY.
 */

import { settings } from '../core/settings.js';
import { store } from '../core/store.js';
import { DataService } from '../services/dataService.js';
import { clamp } from '../core/control.js';
import { icon } from '../ui/icons.js';
import { $, toast, toneChip } from '../ui/components.js';
import { lineChart } from '../ui/charts.js';
import { setHTML, freqTableHTML, feederTone } from '../ui/widgets.js';
import { FEEDER_STATES, CRUSHER_STATES } from '../config.js';
import { esc, fmtTimeSec, relTime } from '../core/format.js';
import { mockCrusherData, mockFeederData, mockVfdData } from '../services/mockData.js';
import { pinGuard } from '../core/security.js';
import { requestPin } from '../ui/pinDialog.js';
import { registerUnsavedCheck } from '../pwa/update.js';

let pendingHz = null;
let busy = false;
let lastTrendT = 0;
let offUnsaved = null;

async function send(body, okMsg) {
  if (busy) return;
  busy = true;
  store.emit('ui');
  const res = await DataService.setControl(body);
  busy = false;
  if (res.ok) {
    if (okMsg) toast(okMsg, 'success');
  } else {
    toast(res.error, 'error', 4500);
  }
  store.emit('ui');
  return res;
}

function aiPanelHTML(st) {
  const f = FEEDER_STATES[st.feeder.aiState];
  return `
    <div class="panel-head">${icon('camera', { size: 16 })}<span class="eyebrow">AI Detection</span>
      <span style="margin-left:auto">${toneChip('green', 'Running')}</span></div>
    <div class="eyebrow subtle" style="font-size:10.5px">AI state</div>
    <div class="state-word t-${f.tone}">${f.label.toUpperCase()}</div>
    <div style="display:flex;justify-content:space-between;font-size:12.5px;margin:12px 0 5px"><span class="muted">Confidence</span><strong>${st.feeder.confidence}%</strong></div>
    <div class="meter"><span style="width:${st.feeder.confidence}%"></span></div>
    <div class="panel-src">${icon('clock', { size: 13 })}Since ${relTime(st.feeder.detectedAt)} · Camera 01</div>`;
}

function vfdPanelHTML(st) {
  const v = st.vfd;
  const manual = v.mode === 'MANUAL';
  const tone = v.interlock ? 'gray' : manual ? 'amber' : 'blue';
  return `
    <div class="panel-head">${icon('zap', { size: 16 })}<span class="eyebrow">VFD Command</span>
      <span style="margin-left:auto">${toneChip(tone, v.interlock ? 'Interlock' : manual ? 'Manual' : 'Auto')}</span></div>
    <div class="eyebrow subtle" style="font-size:10.5px">Commanded frequency</div>
    <div class="state-word">${v.commandHz} <span style="font-size:17px;color:var(--text-2)">Hz</span>
      ${v.atMax ? '<span class="chip chip-amber" style="vertical-align:middle;margin-left:4px">Maximum</span>' : ''}</div>
    <div style="display:flex;justify-content:space-between;font-size:12.5px;margin:12px 0 5px"><span class="muted">Drive output</span><strong>${Number(v.outputHz).toFixed(1)} Hz</strong></div>
    <div class="meter"><span style="width:${(v.outputHz / 50) * 100}%;background:var(--${tone}-line)"></span></div>
    <div class="panel-src">${icon('cpu', { size: 13 })}ABB ACS580 · ${esc(v.driveStatus)}</div>`;
}

function paramsHTML(st) {
  const c = CRUSHER_STATES[st.crusher.status];
  const v = st.vfd;
  return `
    <div class="kv"><span>Crusher</span><strong class="t-${c.tone}">${c.label}</strong></div>
    <div class="kv"><span>Crusher motor current</span><strong>${Number(st.crusher.motorCurrentA).toFixed(1)} A</strong></div>
    <div class="kv"><span>Feeder AI state</span><strong class="t-${feederTone(st.feeder.aiState)}">${FEEDER_STATES[st.feeder.aiState].label}</strong></div>
    <div class="kv"><span>Control mode</span><strong>${v.mode}${v.requestedMode !== v.mode ? ' (manual not permitted)' : ''}</strong></div>
    <div class="kv"><span>Auto frequency for state</span><strong>${v.autoHz} Hz</strong></div>
    <div class="kv"><span>VFD command / output</span><strong>${v.commandHz} / ${Number(v.outputHz).toFixed(1)} Hz</strong></div>
    <div class="kv"><span>Last update</span><strong class="mono" style="font-size:13px">${st.connection.lastUpdate ? fmtTimeSec(st.connection.lastUpdate) : '—'}</strong></div>`;
}

export default {
  id: 'machine',
  head: () => ({ title: 'Machine Control', subtitle: 'Feeder · AI detection · VFD' }),

  render(root) {
    pendingHz = null;
    offUnsaved = registerUnsavedCheck(() => (pendingHz != null ? `a manual speed of ${pendingHz} Hz not yet applied` : ''));
    lastTrendT = 0;
    const s = settings.all;
    const demo = DataService.demo;
    root.innerHTML = `
      <div class="two-col">
        <div class="stack-y">
          <div class="split">
            <section class="card panel-ai" data-ai aria-label="AI detection"></section>
            <section class="card panel-vfd" data-vfdp aria-label="VFD command"></section>
          </div>
          <div class="flow" aria-label="Control chain">
            Camera ${icon('chevron', { size: 12 })} <b>AI state</b> ${icon('chevron', { size: 12 })} Control logic ${icon('chevron', { size: 12 })} <b>VFD command</b> ${icon('chevron', { size: 12 })} FastAPI ${icon('chevron', { size: 12 })} Modbus RTU ${icon('chevron', { size: 12 })} ACS580
          </div>

          <section class="card" aria-label="Control mode">
            <div class="card-head"><div class="card-title">${icon('sliders', { size: 16 })}Control Mode</div><span data-modechip></span></div>
            <div class="locked-note" data-lock hidden></div>
            <div class="seg" role="group" aria-label="Control mode">
              <button type="button" data-mode="AUTO">${icon('auto', { size: 17 })}AUTO</button>
              <button type="button" data-mode="MANUAL"></button>
            </div>
            <p class="form-note" style="margin-top:10px">Manual control is only available when the feeder is <strong>EMPTY</strong>. AI detection keeps running in manual mode — manual only overrides the VFD frequency.</p>
          </section>

          <section class="card" data-manual aria-label="Manual empty speed">
            <div class="card-head"><div class="card-title">${icon('gauge', { size: 16 })}Manual Empty Speed</div><span data-maxchip></span></div>
            <div class="speed-box">
              <div class="speed-row">
                <button type="button" class="step-btn" data-step="-1" aria-label="Decrease 1 Hz">${icon('minus', { size: 22 })}</button>
                <div class="speed-val"><div class="huge-value" data-speed>${s.manualDefault}<small>Hz</small></div></div>
                <button type="button" class="step-btn" data-step="1" aria-label="Increase 1 Hz">${icon('plus', { size: 22 })}</button>
              </div>
              <input class="range" type="range" step="1" data-range aria-label="Manual empty speed">
              <div class="range-labels"><span data-minlbl></span><span data-maxlbl></span></div>
            </div>
            <div class="pending" data-pending style="margin-top:10px"></div>
            <div style="display:flex;gap:10px">
              <button type="button" class="btn btn-ghost" data-cancel hidden>Cancel</button>
              <button type="button" class="btn btn-primary btn-block" data-apply disabled>Apply speed</button>
            </div>
          </section>
        </div>

        <div class="stack-y">
          <section class="card" aria-label="Automatic frequencies">
            <div class="card-head"><div class="card-title">${icon('layers', { size: 16 })}Automatic Frequencies</div><a class="card-link" href="#/profile?edit=freq">Edit ${icon('chevron', { size: 16 })}</a></div>
            <div data-freq></div>
            <p class="form-note" style="margin-top:12px">AUTO uses the frequency configured for the detected AI state. Manual range: <strong data-range-note></strong>.</p>
          </section>

          <section class="card" aria-label="Live frequency">
            <div class="card-head"><div class="card-title">${icon('pulse', { size: 16 })}Drive Output · Last 10 min</div></div>
            <div data-trend></div>
          </section>

          <section class="card" aria-label="Parameters">
            <div class="card-head"><div class="card-title">${icon('cpu', { size: 16 })}Equipment</div></div>
            <div class="subtle" style="font-size:12.5px;margin-bottom:10px">${esc(mockCrusherData.name)} · ${esc(mockFeederData.name)} · ${esc(mockVfdData.name)}</div>
            <div data-params></div>
          </section>

          ${demo ? `
          <details class="demo">
            <summary>${icon('flask', { size: 18 })}Demo simulator<span class="subtle" style="font-weight:500;margin-left:auto;font-size:12.5px">Prototype only</span></summary>
            <div class="demo-body">
              <p class="form-note" style="margin-bottom:12px">Simulates what the camera AI and crusher will report. Not part of the real system.</p>
              <div class="demo-row"><span class="muted" style="font-size:13px">AI state</span>
                <div class="seg" data-demo-ai>${['EMPTY', 'PARTIAL', 'FULL'].map((k) => `<button type="button" data-v="${k}">${FEEDER_STATES[k].label}</button>`).join('')}</div></div>
              <div class="demo-row"><span class="muted" style="font-size:13px">Crusher</span>
                <div class="seg" data-demo-crusher>${['RUNNING', 'WARNING', 'STOPPED', 'FAULT'].map((k) => `<button type="button" data-v="${k}">${CRUSHER_STATES[k].label}</button>`).join('')}</div></div>
              <div class="demo-row"><span class="muted" style="font-size:13px">Auto-cycle AI state</span>
                <label class="switch"><input type="checkbox" data-demo-cycle ${demo.autoCycle ? 'checked' : ''}><span></span></label></div>
              <div class="demo-row"><span class="muted" style="font-size:13px">Communication</span>
                <button type="button" class="btn btn-ghost btn-sm" data-demo-comm>Raise comm warning</button></div>
            </div>
          </details>` : ''}
        </div>
      </div>`;

    // Mode buttons
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
      const st = store.state;
      const want = b.dataset.mode;
      if (want === st.vfd.requestedMode && want === st.vfd.mode) return;
      if (want === 'MANUAL') {
        const hz = pendingHz ?? st.vfd.manualHz;
        const r = await send({ mode: 'MANUAL', manualHz: hz }, `Manual override enabled · ${hz} Hz`);
        if (r?.ok) pendingHz = null;
      } else {
        await send({ mode: 'AUTO' }, 'Returned to AUTO');
        pendingHz = null;
      }
      store.emit('ui');
    }));

    // Speed adjustments (pending until Apply)
    const setPending = (hz) => {
      const s2 = settings.all;
      const v = clamp(Math.round(hz), s2.manualMin, s2.manualMax);
      pendingHz = v === store.state.vfd.manualHz ? null : v;
      store.emit('ui');
    };
    root.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const base = pendingHz ?? store.state.vfd.manualHz;
      setPending(base + Number(b.dataset.step));
    }));
    $('[data-range]', root).addEventListener('input', (e) => setPending(Number(e.target.value)));
    $('[data-cancel]', root).addEventListener('click', () => { pendingHz = null; store.emit('ui'); });
    $('[data-apply]', root).addEventListener('click', async () => {
      if (pendingHz == null) return;
      const hz = pendingHz;
      // Changing the Manual Empty Speed needs the settings PIN (valid a few minutes).
      if (!pinGuard.recentlyVerified) {
        const ok = await requestPin({ message: `Enter PIN to change Manual Empty Speed to ${hz} Hz`, context: 'Manual Empty Speed' });
        if (!ok) { toast('Speed not changed — PIN required', 'warning'); return; }
      }
      // State may have changed while the PIN dialog was open.
      const v = store.state.vfd;
      if (pendingHz !== hz || v.mode !== 'MANUAL' || !v.manualAllowed) {
        toast('Speed not changed — feeder is no longer EMPTY / in MANUAL', 'warning');
        store.emit('ui');
        return;
      }
      const r = await send({ manualHz: hz }, `Empty speed set to ${hz} Hz`);
      if (r?.ok) pendingHz = null;
      store.emit('ui');
    });

    // Demo controls
    if (demo) {
      root.querySelectorAll('[data-demo-ai] button').forEach((b) => b.addEventListener('click', () => demo.setAiState(b.dataset.v)));
      root.querySelectorAll('[data-demo-crusher] button').forEach((b) => b.addEventListener('click', () => demo.setCrusherStatus(b.dataset.v)));
      $('[data-demo-cycle]', root).addEventListener('change', (e) => {
        demo.setAutoCycle(e.target.checked);
        toast(e.target.checked ? 'AI state auto-cycle on' : 'AI state held — use the buttons to change it', 'info');
      });
      $('[data-demo-comm]', root).addEventListener('click', () => demo.commWarning());
    }
  },

  update(st) {
    const root = document.getElementById('view');
    if (!root || !$('[data-ai]', root)) return;
    const s = settings.all;
    const v = st.vfd;
    const manual = v.mode === 'MANUAL';
    const allowed = v.manualAllowed;
    if (!allowed || !manual) pendingHz = null; // feeder left EMPTY → discard unsent change

    setHTML($('[data-ai]', root), aiPanelHTML(st));
    setHTML($('[data-vfdp]', root), vfdPanelHTML(st));
    setHTML($('[data-freq]', root), freqTableHTML(st, s));
    setHTML($('[data-params]', root), paramsHTML(st));
    setHTML($('[data-range-note]', root), `${s.manualMin}–${s.manualMax} Hz`);

    // Mode segment
    root.querySelectorAll('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === v.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      b.disabled = busy || (b.dataset.mode === 'MANUAL' && !allowed);
      if (b.dataset.mode === 'MANUAL') setHTML(b, `${icon(allowed ? 'hand' : 'lock', { size: 17 })}MANUAL`);
    });
    setHTML($('[data-modechip]', root), toneChip(manual ? 'amber' : 'blue', manual ? 'Manual override' : 'Auto'));
    const lock = $('[data-lock]', root);
    lock.hidden = allowed;
    if (!allowed) {
      setHTML(lock, `${icon('lock', { size: 18 })}<div><strong>Manual control unavailable.</strong> AI detects <strong>${FEEDER_STATES[st.feeder.aiState].label.toUpperCase()}</strong> — the feeder stays in AUTO at ${v.autoHz} Hz. Manual Empty speed appears only when the feeder is EMPTY.</div>`);
    }

    // Manual speed card
    const card = $('[data-manual]', root);
    const editable = manual && allowed && !busy;
    const shown = pendingHz ?? v.manualHz;
    setHTML($('[data-speed]', root), `${shown}<small>Hz</small>`);
    const range = $('[data-range]', root);
    range.min = s.manualMin; range.max = s.manualMax;
    if (document.activeElement !== range || pendingHz == null) range.value = shown;
    range.style.setProperty('--fill', `${((shown - s.manualMin) / Math.max(1, s.manualMax - s.manualMin)) * 100}%`);
    range.disabled = !editable;
    root.querySelector('[data-step="-1"]').disabled = !editable || shown <= s.manualMin;
    root.querySelector('[data-step="1"]').disabled = !editable || shown >= s.manualMax;
    setHTML($('[data-minlbl]', root), `${s.manualMin} Hz min`);
    setHTML($('[data-maxlbl]', root), `${s.manualMax} Hz max`);
    setHTML($('[data-maxchip]', root), shown >= s.manualMax ? '<span class="chip chip-amber">Maximum</span>' : shown <= s.manualMin ? '<span class="chip chip-gray">Minimum</span>' : '');
    card.hidden = !allowed; // manual speed controls exist only while AI = EMPTY
    let note = '';
    if (!allowed) note = '<span class="subtle">Available only when the feeder is EMPTY.</span>';
    else if (!manual) note = '<span class="subtle">Select MANUAL to adjust the Empty speed.</span>';
    else if (pendingHz != null) note = `Pending change: ${v.manualHz} → ${pendingHz} Hz. Tap Apply ${pinGuard.recentlyVerified ? '' : '(PIN required) '}to send to the VFD.`;
    else note = `<span class="t-green">Active: VFD commanded to ${v.commandHz} Hz.</span>`;
    setHTML($('[data-pending]', root), note);
    const apply = $('[data-apply]', root);
    apply.disabled = !editable || pendingHz == null;
    setHTML(apply, `${pinGuard.recentlyVerified ? '' : icon('lock', { size: 16 })}${pendingHz != null ? `Apply ${pendingHz} Hz` : 'Apply speed'}`);
    $('[data-cancel]', root).hidden = pendingHz == null;

    // Trend
    const last = st.trend[st.trend.length - 1]?.t || 0;
    if (last !== lastTrendT) {
      lastTrendT = last;
      setHTML($('[data-trend]', root), lineChart(st.trend, {
        height: 170, min: 0, max: 50,
        bands: [{ y: s.freqEmpty, label: `Empty ${s.freqEmpty}` }],
        xLabel: (t) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      }));
    }

    // Demo highlights
    root.querySelectorAll('[data-demo-ai] button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.feeder.aiState));
    root.querySelectorAll('[data-demo-crusher] button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.crusher.status));
  },

  destroy() { pendingHz = null; offUnsaved?.(); },
};
