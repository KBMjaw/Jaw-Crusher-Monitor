/**
 * Minimal reactive store. The UI reads from `store.state` and subscribes to
 * changes; services write to it through `store.patch()`.
 */

const listeners = new Set();

export const store = {
  state: {
    connection: { source: 'mock', online: true, lastUpdate: null },
    crusher: { status: 'RUNNING', motorCurrentA: 0, runtimeTodaySec: 0 },
    feeder: { aiState: 'EMPTY', confidence: 0, detectedAt: null, detecting: true },
    vfd: {
      requestedMode: 'AUTO', // what the operator selected
      manualHz: 47, // operator manual setpoint (Empty only)
      mode: 'AUTO', // effective mode after safety rules
      commandHz: 0, // frequency commanded to the drive
      outputHz: 0, // frequency reported by the drive
      autoHz: 0,
      manualAllowed: false,
      atMax: false,
      driveStatus: 'Running',
    },
    today: null, // analytics summary for today
    alerts: [],
    trend: [], // recent {t, hz} samples for the live chart
    demo: { autoCycle: true },
  },

  patch(path, value) {
    const parts = path.split('.');
    let obj = this.state;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    const key = parts[parts.length - 1];
    obj[key] = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ...obj[key], ...value }
      : value;
    this.emit(path);
  },

  emit(path = '*') {
    listeners.forEach((fn) => {
      try { fn(this.state, path); } catch (e) { console.error(e); }
    });
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
