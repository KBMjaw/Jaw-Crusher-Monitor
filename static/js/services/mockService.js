/**
 * Mock implementation of the data service. Simulates what the Raspberry Pi
 * backend will push over WebSocket: AI feeder state, VFD command/output,
 * crusher status and alerts. Implements the same interface as apiService.js.
 */

import { settings } from '../core/settings.js';
import { resolveVfdCommand, clamp } from '../core/control.js';
import { FEEDER_STATES } from '../config.js';
import {
  mockCrusherData, mockFeederData, mockVfdData, mockAlerts, mockAnalytics, mockRecentTrend,
} from './mockData.js';

const CYCLE = { FULL: 'PARTIAL', PARTIAL: 'EMPTY', EMPTY: 'FULL' };
const DWELL = { FULL: [40, 70], PARTIAL: [40, 70], EMPTY: [45, 80] }; // seconds (compressed for demo)
const CONF = { FULL: [90, 97], PARTIAL: [82, 91], EMPTY: [88, 95] };
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

let timer = null;
let handlers = {};
let alertSeq = 0;

const sim = {
  crusherStatus: mockCrusherData.status,
  aiState: mockFeederData.aiState,
  confidence: mockFeederData.confidence,
  detectedAt: Date.now() - 22 * 60000,
  dwellLeft: 60,
  requestedMode: mockVfdData.requestedMode,
  manualHz: mockVfdData.manualHz,
  outputHz: 0,
  motorCurrentA: mockCrusherData.motorCurrentA,
  autoCycle: true,
  lastCommandHz: null,
  trendTick: 0,
};

function emitAlert(severity, type, title, description, source = 'Feeder / VFD', data = null) {
  const alert = {
    id: `live-${Date.now()}-${alertSeq++}`,
    severity, type, title, description, source,
    time: new Date().toISOString(),
    read: false,
    ...(data ? { data } : {}),
  };
  handlers.onAlert?.(alert);
}

function snapshot() {
  const s = settings.all;
  const cmd = resolveVfdCommand({
    aiState: sim.aiState,
    requestedMode: sim.requestedMode,
    manualHz: sim.manualHz,
    crusherStatus: sim.crusherStatus,
  }, s);
  return {
    timestamp: new Date().toISOString(),
    connection: { source: 'mock', online: true },
    crusher: {
      status: sim.crusherStatus,
      motorCurrentA: +sim.motorCurrentA.toFixed(1),
    },
    feeder: {
      aiState: sim.aiState,
      confidence: Math.round(sim.confidence),
      detectedAt: new Date(sim.detectedAt).toISOString(),
      detecting: true,
    },
    vfd: {
      requestedMode: sim.requestedMode,
      ...cmd,
      outputHz: +sim.outputHz.toFixed(1),
      driveStatus: cmd.commandHz > 0 ? 'Running' : 'Stopped',
    },
  };
}

function setAiState(next, { silent = false } = {}) {
  if (next === sim.aiState) return;
  const prev = sim.aiState;
  sim.aiState = next;
  sim.detectedAt = Date.now();
  sim.confidence = rand(...CONF[next]);
  sim.dwellLeft = Math.round(rand(...DWELL[next]));
  if (silent) return;
  emitAlert('info', `FEEDER_${next}`, FEEDER_STATES[next].long,
    `AI detected feeder ${FEEDER_STATES[next].label.toLowerCase()} (confidence ${Math.round(sim.confidence)}%).`);
  if (prev === 'EMPTY' && sim.requestedMode === 'MANUAL') {
    sim.requestedMode = 'AUTO';
    emitAlert('warning', 'MANUAL_OVERRIDE_AUTO_REVERT', 'Manual Override Disabled',
      `Feeder no longer empty (${FEEDER_STATES[next].label}). Control returned to AUTO.`, 'Feeder / VFD',
      { aiState: next, prevHz: sim.manualHz, commandHz: snapshot().vfd.commandHz });
  }
}

function checkCommandChange(snap) {
  const hzNow = snap.vfd.commandHz;
  if (sim.lastCommandHz !== null && hzNow !== sim.lastCommandHz) {
    const why = snap.vfd.interlock
      ? 'feeder stopped — crusher not running'
      : snap.vfd.mode === 'MANUAL'
        ? 'MANUAL · Empty'
        : `AUTO · ${FEEDER_STATES[sim.aiState].label}`;
    emitAlert('info', 'VFD_CHANGE', 'VFD Frequency Changed', `Command changed to ${hzNow} Hz (${why}).`);
  }
  sim.lastCommandHz = hzNow;
}

function tick() {
  // AI state machine (demo cycle: loader fills → partial → empty → refill)
  if (sim.autoCycle && sim.crusherStatus === 'RUNNING') {
    sim.dwellLeft -= 1;
    if (sim.dwellLeft <= 0) setAiState(CYCLE[sim.aiState]);
  }
  const [lo, hi] = CONF[sim.aiState];
  sim.confidence = clamp(sim.confidence + (Math.random() - 0.5) * 1.6, lo, hi);

  const snap = snapshot();
  checkCommandChange(snap);

  // Drive ramps toward command (ACS580 accel/decel ramp)
  const target = snap.vfd.commandHz;
  const step = mockVfdData.rampHzPerSec;
  const diff = target - sim.outputHz;
  sim.outputHz = Math.abs(diff) <= step ? target + (target ? (Math.random() - 0.5) * 0.2 : 0) : sim.outputHz + Math.sign(diff) * step;
  sim.outputHz = Math.max(0, sim.outputHz);

  // Crusher motor current follows feed load
  const loadA = sim.crusherStatus === 'RUNNING' || sim.crusherStatus === 'WARNING'
    ? { FULL: 82, PARTIAL: 71, EMPTY: 54 }[sim.aiState] : 0;
  sim.motorCurrentA += (loadA - sim.motorCurrentA) * 0.15 + (loadA ? (Math.random() - 0.5) * 1.2 : 0);
  sim.motorCurrentA = Math.max(0, sim.motorCurrentA);

  const out = snapshot();
  sim.trendTick = (sim.trendTick + 1) % 5;
  handlers.onLive?.(out, { trendSample: sim.trendTick === 0 });
}

export const mockService = {
  name: 'mock',

  async start(h) {
    handlers = h;
    sim.outputHz = snapshot().vfd.commandHz;
    sim.lastCommandHz = sim.outputHz;
    handlers.onTrendSeed?.(mockRecentTrend(sim.outputHz));
    handlers.onLive?.(snapshot(), { trendSample: false });
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  },

  stop() {
    clearInterval(timer);
    timer = null;
  },

  async getAlerts() {
    return mockAlerts();
  },

  async getAnalytics(range) {
    await new Promise((r) => setTimeout(r, 200));
    return mockAnalytics(range, settings.all);
  },

  /**
   * Operator control request. Mirrors POST /api/v1/feeder/control.
   * Returns { ok, error? }.
   */
  async setControl({ mode, manualHz }) {
    await new Promise((r) => setTimeout(r, 250));
    const s = settings.all;
    if (mode === 'MANUAL' && sim.aiState !== 'EMPTY') {
      return { ok: false, error: 'Manual control is only allowed while the AI detects EMPTY.' };
    }
    if (manualHz != null && mode !== 'MANUAL' && (sim.aiState !== 'EMPTY' || sim.requestedMode !== 'MANUAL')) {
      return { ok: false, error: 'Manual Empty speed can only be changed while the feeder is EMPTY and in MANUAL.' };
    }
    if (manualHz != null) {
      const n = Number(manualHz);
      if (!Number.isFinite(n) || n < s.manualMin || n > s.manualMax) {
        return { ok: false, error: `Manual speed must be between ${s.manualMin} and ${s.manualMax} Hz.` };
      }
    }
    const wasManual = sim.requestedMode === 'MANUAL';
    const prevHz = sim.manualHz;
    if (manualHz != null) sim.manualHz = Number(manualHz);
    if (mode) sim.requestedMode = mode;

    if (!wasManual && sim.requestedMode === 'MANUAL') {
      emitAlert('info', 'MANUAL_OVERRIDE', 'Manual Override Enabled', `Feeder Empty speed set to ${sim.manualHz} Hz.`);
    } else if (wasManual && sim.requestedMode === 'AUTO') {
      emitAlert('info', 'MANUAL_OVERRIDE_OFF', 'Manual Override Disabled', `Control returned to AUTO (${s.freqEmpty} Hz for Empty).`);
    } else if (sim.requestedMode === 'MANUAL' && prevHz !== sim.manualHz) {
      emitAlert('info', 'MANUAL_OVERRIDE', 'Manual Override', `Feeder Empty speed changed to ${sim.manualHz} Hz.`);
    }
    const snap = snapshot();
    sim.lastCommandHz = snap.vfd.commandHz; // already reported by the override alert
    handlers.onLive?.(snap, { trendSample: false });
    return { ok: true };
  },

  /** Re-evaluate after settings change (e.g. frequencies edited). */
  refresh() {
    handlers.onLive?.(snapshot(), { trendSample: false });
  },

  /* ── Demo-only controls (not part of the real API) ── */
  demo: {
    setAiState(state) { setAiState(state); mockService.refresh(); },
    setCrusherStatus(status) {
      if (status === sim.crusherStatus) return;
      sim.crusherStatus = status;
      const map = {
        RUNNING: ['normal', 'Crusher Running', 'Crusher started.'],
        STOPPED: ['warning', 'Crusher Stopped', 'Crusher stopped. Feeder interlocked to 0 Hz.'],
        WARNING: ['warning', 'Crusher Warning', 'Motor current high — monitor crusher load.'],
        FAULT: ['fault', 'Crusher Fault', 'Motor overload trip. Feeder interlocked to 0 Hz.'],
      }[status];
      emitAlert(map[0], `CRUSHER_${status}`, map[1], map[2], 'Jaw Crusher');
      mockService.refresh();
    },
    setAutoCycle(on) { sim.autoCycle = !!on; },
    get autoCycle() { return sim.autoCycle; },
    commWarning() {
      emitAlert('warning', 'COMM_WARNING', 'Communication Warning', 'Camera 01 stream unstable — frames dropped.', 'Camera 01');
    },
  },
};
