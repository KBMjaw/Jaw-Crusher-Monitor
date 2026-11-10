/**
 * Demo / mock data. Every value the UI shows while APP.dataSource === 'mock'
 * comes from here or from mockService.js. The shapes match the payloads the
 * FastAPI backend is expected to return (see docs/API.md), so swapping to the
 * real service does not require UI changes.
 */

import { APP } from '../config.js';
import { toISODate, fromISODate } from '../core/format.js';

/* ── Deterministic RNG so a given date always produces the same history ── */
function seeded(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rnd, lo, hi) => lo + rnd() * (hi - lo);
const intBetween = (rnd, lo, hi) => Math.round(between(rnd, lo, hi));

/* ── Live snapshot seeds ── */
export const mockCrusherData = {
  name: 'Jaw Crusher JC-01',
  model: 'Jaw Crusher 900 × 600',
  status: 'RUNNING',
  motorCurrentA: 68,
  ratedTph: 140,
};

export const mockFeederData = {
  name: 'Vibrating Grizzly Feeder VGF-01',
  aiState: 'EMPTY',
  confidence: 92,
  model: 'YOLO feeder-state v1 (demo)',
};

export const mockVfdData = {
  name: 'ABB ACS580 — Feeder Drive',
  requestedMode: 'AUTO',
  manualHz: 47,
  driveStatus: 'Running',
  rampHzPerSec: 2,
};

export const mockCameras = [
  { id: 'cam1', name: 'Camera 01', location: 'Crusher Feeder', ai: true },
  { id: 'cam2', name: 'Camera 02', location: 'Jaw Crusher Mouth', ai: false },
  { id: 'cam3', name: 'Camera 03', location: 'Main Conveyor', ai: false },
];

/* Throughput assumptions per feeder state (t/h) */
const TPH = { FULL: 138, PARTIAL: 104, EMPTY: 22 };

/** Seed alerts for "today", relative to now. */
export function mockAlerts(now = new Date()) {
  const at = (minAgo) => new Date(now.getTime() - minAgo * 60000).toISOString();
  const list = [
    { sev: 'info', type: 'MANUAL_OVERRIDE', title: 'Manual Override Enabled', desc: 'Feeder Empty speed changed to 47 Hz.', t: 18 },
    { sev: 'info', type: 'FEEDER_EMPTY', title: 'Feeder Empty', desc: 'AI detected feeder empty (confidence 93%).', t: 22 },
    { sev: 'info', type: 'MANUAL_OVERRIDE_OFF', title: 'Manual Override Disabled', desc: 'Control returned to AUTO.', t: 64 },
    { sev: 'info', type: 'VFD_CHANGE', title: 'VFD Frequency Changed', desc: 'Frequency changed to 30 Hz (AUTO · Full).', t: 95 },
    { sev: 'info', type: 'FEEDER_FULL', title: 'Feeder Full', desc: 'AI detected feeder full (confidence 95%).', t: 96 },
    { sev: 'warning', type: 'COMM_WARNING', title: 'Communication Warning', desc: 'Camera 01 stream unstable — 3 frames dropped.', t: 140 },
    { sev: 'normal', type: 'CRUSHER_RUNNING', title: 'Crusher Running', desc: 'Crusher started after scheduled break.', t: 185 },
    { sev: 'warning', type: 'CRUSHER_STOPPED', title: 'Crusher Stopped', desc: 'Scheduled tea break stop.', t: 210 },
    { sev: 'fault', type: 'CRUSHER_FAULT', title: 'Crusher Fault', desc: 'Motor overload trip — reset by operator.', t: 290 },
    { sev: 'info', type: 'VFD_CHANGE', title: 'VFD Frequency Changed', desc: 'Frequency changed to 37 Hz (AUTO · Partially Full).', t: 330 },
  ];
  return list.map((a, i) => ({
    id: `seed-${i}`,
    severity: a.sev,
    type: a.type,
    title: a.title,
    description: a.desc,
    time: at(a.t),
    read: a.t > 60,
    source: a.type.startsWith('COMM') ? 'Camera 01' : a.type.startsWith('CRUSHER') ? 'Jaw Crusher' : 'Feeder / VFD',
  }));
}

/* ── Historical day simulation ── */

/**
 * Builds a minute-level timeline of a plant day. Segments:
 *   { start, dur, crusher, ai, mode, hz }   (start/dur in minutes from shift start)
 */
function simulateDay(dateISO, s) {
  const rnd = seeded(`kbm-${dateISO}`);
  const total = (APP.shift.endHour - APP.shift.startHour) * 60;
  const segs = [];

  // Stops: one planned lunch break + 0–2 unplanned stops
  const stops = [{ start: 7 * 60 - 15, dur: 30, crusher: 'STOPPED', reason: 'Lunch break' }];
  const unplanned = intBetween(rnd, 0, 2);
  for (let i = 0; i < unplanned; i++) {
    const fault = rnd() < 0.45;
    stops.push({
      start: intBetween(rnd, 60, total - 60),
      dur: intBetween(rnd, fault ? 12 : 8, fault ? 35 : 22),
      crusher: fault ? 'FAULT' : 'STOPPED',
      reason: fault ? 'Motor overload trip' : 'Loader delay',
    });
  }
  stops.sort((a, b) => a.start - b.start);

  const order = ['FULL', 'PARTIAL', 'EMPTY'];
  let idx = intBetween(rnd, 0, 2);
  let t = 0;
  let stopIdx = 0;
  while (t < total) {
    const stop = stops[stopIdx];
    if (stop && t >= stop.start) {
      segs.push({ start: t, dur: Math.min(stop.dur, total - t), crusher: stop.crusher, ai: 'EMPTY', mode: 'AUTO', hz: 0, reason: stop.reason });
      t += stop.dur;
      stopIdx++;
      continue;
    }
    const ai = order[idx % 3];
    const range = { FULL: [18, 42], PARTIAL: [22, 55], EMPTY: [4, 20] }[ai];
    let dur = intBetween(rnd, range[0], range[1]);
    if (stop && t + dur > stop.start) dur = stop.start - t;
    dur = Math.min(dur, total - t);
    if (dur <= 0) { idx++; continue; }
    let mode = 'AUTO';
    let hzVal = { FULL: s.freqFull, PARTIAL: s.freqPartial, EMPTY: s.freqEmpty }[ai];
    if (ai === 'EMPTY' && rnd() < 0.35) {
      mode = 'MANUAL';
      hzVal = intBetween(rnd, Math.max(s.manualMin, s.freqEmpty + 1), s.manualMax - 1);
    }
    segs.push({ start: t, dur, crusher: 'RUNNING', ai, mode, hz: hzVal });
    t += dur;
    idx++;
  }
  return { segs, total, rnd };
}

function clipSegs(segs, untilMin) {
  const out = [];
  for (const sg of segs) {
    if (sg.start >= untilMin) break;
    out.push({ ...sg, dur: Math.min(sg.dur, untilMin - sg.start) });
  }
  return out;
}

function dayMetrics(dateISO, s, now) {
  const { segs: allSegs, total, rnd } = simulateDay(dateISO, s);
  const isToday = dateISO === toISODate(now);
  let elapsed = total;
  if (isToday) {
    const mins = (now.getHours() - APP.shift.startHour) * 60 + now.getMinutes();
    elapsed = Math.max(0, Math.min(total, mins));
  }
  const segs = clipSegs(allSegs, elapsed);
  const sum = (fn) => segs.reduce((a, sg) => a + (fn(sg) ? sg.dur : 0), 0);

  const running = sum((sg) => sg.crusher === 'RUNNING');
  const down = sum((sg) => sg.crusher !== 'RUNNING');
  const planned = sum((sg) => sg.reason === 'Lunch break');
  const states = {
    EMPTY: sum((sg) => sg.crusher === 'RUNNING' && sg.ai === 'EMPTY'),
    PARTIAL: sum((sg) => sg.crusher === 'RUNNING' && sg.ai === 'PARTIAL'),
    FULL: sum((sg) => sg.crusher === 'RUNNING' && sg.ai === 'FULL'),
  };
  const detections = { EMPTY: 0, PARTIAL: 0, FULL: 0 };
  segs.forEach((sg) => { if (sg.crusher === 'RUNNING') detections[sg.ai]++; });

  const tons = segs.reduce((a, sg) => a + (sg.crusher === 'RUNNING' ? (TPH[sg.ai] * sg.dur) / 60 : 0), 0);

  // Frequency stats (only while running)
  const runSegs = segs.filter((sg) => sg.crusher === 'RUNNING');
  const hzWeighted = runSegs.reduce((a, sg) => a + sg.hz * sg.dur, 0);
  const avgHz = running ? hzWeighted / running : 0;
  const minHz = runSegs.length ? Math.min(...runSegs.map((sg) => sg.hz)) : 0;
  const maxHz = runSegs.length ? Math.max(...runSegs.map((sg) => sg.hz)) : 0;

  // 10-minute trend samples
  const base = fromISODate(dateISO);
  base.setHours(APP.shift.startHour, 0, 0, 0);
  const trend = [];
  for (let m = 0; m < elapsed; m += 10) {
    const sg = segs.find((x) => m >= x.start && m < x.start + x.dur);
    if (!sg) continue;
    const jitter = sg.hz ? (rnd() - 0.5) * 0.6 : 0;
    trend.push({ t: base.getTime() + m * 60000, hz: +(sg.hz + jitter).toFixed(1), ai: sg.ai, mode: sg.mode });
  }

  const at = (min) => new Date(base.getTime() + min * 60000).toISOString();
  const manualPeriods = segs.filter((sg) => sg.mode === 'MANUAL').map((sg) => ({
    start: at(sg.start), end: at(sg.start + sg.dur), durationSec: sg.dur * 60, hz: sg.hz,
  }));
  const stopEvents = segs.filter((sg) => sg.crusher !== 'RUNNING').map((sg) => ({
    start: at(sg.start), end: at(sg.start + sg.dur), durationSec: sg.dur * 60, type: sg.crusher, reason: sg.reason,
  }));

  const faults = stopEvents.filter((e) => e.type === 'FAULT').length;
  const warnings = stopEvents.filter((e) => e.type === 'STOPPED').length + (elapsed > 120 ? intBetween(rnd, 1, 3) : 0);
  const stateChanges = detections.EMPTY + detections.PARTIAL + detections.FULL;

  const plannedProduction = Math.max(1, elapsed - planned);
  const availability = elapsed ? (running / plannedProduction) * 100 : 0;
  const performance = running ? (tons / ((running / 60) * TPH.FULL)) * 100 : 0;
  const quality = elapsed ? between(rnd, 97.2, 99.4) : 0;

  return {
    date: dateISO,
    elapsedSec: elapsed * 60,
    runtimeSec: running * 60,
    downtimeSec: down * 60,
    feederRuntimeSec: Math.round(running * 60 * 0.985),
    vfdRuntimeSec: running * 60,
    outputT: tons,
    states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v * 60])),
    detections,
    vfd: { avgHz, minHz, maxHz, trend, manualPeriods },
    stopEvents,
    alerts: {
      total: stateChanges * 2 + manualPeriods.length * 2 + faults + warnings,
      fault: faults,
      warning: warnings,
      info: stateChanges * 2 + manualPeriods.length * 2,
      manual: manualPeriods.length * 2,
    },
    oee: { availability, performance, quality },
  };
}

/**
 * Analytics for a date range (inclusive). Returns aggregated metrics plus a
 * per-day breakdown.
 */
export function mockAnalytics({ from, to, label }, s, now = new Date()) {
  const days = [];
  const start = fromISODate(from);
  const end = fromISODate(to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d > now) break;
    days.push(dayMetrics(toISODate(d), s, now));
  }
  const add = (fn) => days.reduce((a, d) => a + fn(d), 0);
  const runtimeSec = add((d) => d.runtimeSec);
  const elapsedSec = add((d) => d.elapsedSec);

  const runningDays = days.filter((d) => d.runtimeSec > 0);
  const weightedHz = add((d) => d.vfd.avgHz * d.runtimeSec);
  const oeeAvg = (k) => {
    const w = add((d) => d.elapsedSec);
    return w ? add((d) => d.oee[k] * d.elapsedSec) / w : 0;
  };
  const availability = oeeAvg('availability');
  const performance = oeeAvg('performance');
  const quality = oeeAvg('quality');

  // Trend: 10-min samples for a single day, hourly averages for multi-day ranges
  let trend;
  if (days.length <= 1) {
    trend = days[0]?.vfd.trend ?? [];
  } else {
    trend = [];
    days.forEach((d) => {
      const buckets = {};
      d.vfd.trend.forEach((p) => {
        const h = new Date(p.t); h.setMinutes(0, 0, 0);
        (buckets[h.getTime()] ||= []).push(p.hz);
      });
      Object.entries(buckets).forEach(([t, arr]) => {
        trend.push({ t: Number(t), hz: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) });
      });
    });
  }

  return {
    period: { from, to, label, days: days.length, generatedAt: new Date().toISOString() },
    source: 'Demo data',
    runtimeSec,
    elapsedSec,
    downtimeSec: add((d) => d.downtimeSec),
    feederRuntimeSec: add((d) => d.feederRuntimeSec),
    vfdRuntimeSec: add((d) => d.vfdRuntimeSec),
    outputT: add((d) => d.outputT),
    avgTph: runtimeSec ? add((d) => d.outputT) / (runtimeSec / 3600) : 0,
    states: {
      EMPTY: add((d) => d.states.EMPTY),
      PARTIAL: add((d) => d.states.PARTIAL),
      FULL: add((d) => d.states.FULL),
    },
    detections: {
      EMPTY: add((d) => d.detections.EMPTY),
      PARTIAL: add((d) => d.detections.PARTIAL),
      FULL: add((d) => d.detections.FULL),
    },
    vfd: {
      avgHz: runtimeSec ? weightedHz / runtimeSec : 0,
      minHz: runningDays.length ? Math.min(...runningDays.map((d) => d.vfd.minHz)) : 0,
      maxHz: runningDays.length ? Math.max(...runningDays.map((d) => d.vfd.maxHz)) : 0,
      trend,
      manualPeriods: days.flatMap((d) => d.vfd.manualPeriods),
    },
    stopEvents: days.flatMap((d) => d.stopEvents),
    alerts: {
      total: add((d) => d.alerts.total),
      fault: add((d) => d.alerts.fault),
      warning: add((d) => d.alerts.warning),
      info: add((d) => d.alerts.info),
      manual: add((d) => d.alerts.manual),
    },
    oee: {
      availability,
      performance,
      quality,
      overall: (availability * performance * quality) / 10000,
    },
    days: days.map((d) => ({
      date: d.date,
      runtimeSec: d.runtimeSec,
      downtimeSec: d.downtimeSec,
      outputT: d.outputT,
      avgHz: d.vfd.avgHz,
      oee: (d.oee.availability * d.oee.performance * d.oee.quality) / 10000,
    })),
  };
}

/** Recent live-trend seed (last ~10 minutes, 5 s spacing). */
export function mockRecentTrend(hzNow, now = Date.now()) {
  const out = [];
  for (let i = 119; i >= 0; i--) {
    const t = now - i * 5000;
    const phase = i > 70 ? 30 : i > 30 ? 37 : hzNow;
    out.push({ t, hz: +(phase + (Math.random() - 0.5) * 0.4).toFixed(1) });
  }
  return out;
}
