/** Safe wrappers around Web Storage (can throw in private mode / blocked storage). */

const PREFIX = 'cm.';

export const local = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false; // quota exceeded or storage blocked
    }
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
  },
};

export const session = {
  get(key, fallback = null) {
    try {
      const raw = sessionStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { sessionStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
  },
};
