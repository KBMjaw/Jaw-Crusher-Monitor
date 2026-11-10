/** Operator-configurable settings, persisted on this device. */

import { DEFAULT_SETTINGS, APP } from '../config.js';
import { local } from './storage.js';

const listeners = new Set();
let current = { ...DEFAULT_SETTINGS, ...local.get('settings', {}) };

export const settings = {
  get all() { return current; },
  get(key) { return current[key]; },

  update(partial) {
    const prev = current;
    current = { ...current, ...partial };
    const ok = local.set('settings', current);
    listeners.forEach((fn) => fn(current, partial, prev));
    return ok;
  },

  reset(keys) {
    const partial = {};
    keys.forEach((k) => { partial[k] = DEFAULT_SETTINGS[k]; });
    return this.update(partial);
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/**
 * Validates feeder frequency settings. Returns an object of field → message.
 */
export function validateFrequencies(v) {
  const errors = {};
  const { min, max } = APP.vfdLimits;
  const fields = ['freqFull', 'freqPartial', 'freqEmpty', 'manualMin', 'manualMax'];
  fields.forEach((f) => {
    const raw = String(v[f] ?? '').trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) errors[f] = 'Enter a number';
    else if (n < min || n > max) errors[f] = `Must be ${min}–${max} Hz`;
  });
  if (!errors.manualMin && !errors.manualMax && Number(v.manualMin) >= Number(v.manualMax)) {
    errors.manualMax = 'Maximum must be greater than minimum';
  }
  return errors;
}
