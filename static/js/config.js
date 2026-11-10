/**
 * Application configuration.
 *
 * APP holds build-time constants. DEFAULT_SETTINGS holds values the operator
 * can change from Profile › Settings; they are persisted per device by
 * core/settings.js. Nothing in the UI should hard-code these values.
 */

export const APP = {
  name: 'Crusher Monitor',
  version: '1.2.1',
  build: '2026.10',

  /**
   * Data source.
   *  'mock' → services/mockService.js (demo data, no hardware)
   *  'api'  → services/apiService.js  (FastAPI REST + WebSocket on the Raspberry Pi)
   */
  dataSource: 'api',
  apiBase: '', // relative — uses the same host the page was opened from
  wsPath: '/ws/camera',

  /** Plant operating window used by analytics (24h clock). */
  shift: { startHour: 6, endHour: 22 },

  /** Hard limits of the feeder drive. Settings are validated against these. */
  vfdLimits: { min: 0, max: 50 },

  /** Demo credentials for the frontend prototype (no real security). */
  demoUser: { username: 'admin', password: 'admin123' },

  /**
   * Empty-speed settings PIN (prototype). Only a hash is kept in the code and
   * the PIN is never shown in the UI. Not secure: the backend must verify the
   * PIN (or a role permission) before accepting setting changes.
   */
  settingsPinHash: '5ee3dcc5',
  pinMaxAttempts: 5,
  pinLockoutSec: 60,
  pinFailWindowSec: 600, // wrong PINs older than this no longer count towards lockout
  /**
   * Shared PIN window: after a correct PIN, Manual Empty Speed (Machine) and
   * Empty settings (Feeder Frequency Settings) don't ask again for this long.
   */
  pinGraceSec: 300,

  /** VAPID public key for Web Push. Set when the backend push service exists. */
  vapidPublicKey: null,
};

export const DEFAULT_SETTINGS = {
  // Branding
  companyName: 'Kannan Blue Metals',
  plantName: 'Chennimalai Crusher Plant',
  companyLogo: null, // PNG data URL, null → built-in mark

  // Profile
  profileName: 'Admin',
  profileRole: 'Administrator',
  profilePhoto: null, // PNG data URL

  // Feeder automatic frequencies (Hz), one per AI state
  freqFull: 30,
  freqPartial: 37,
  freqEmpty: 43,

  // Manual override range (Hz) — only usable while AI detects EMPTY
  manualMin: 40,
  manualMax: 50,
  manualDefault: 47,

  // Support
  supportPhone: '8883921424',
  supportCountryCode: '91',
  supportEmail: 'support@example.com', // placeholder until the real address is provided

  // Preferences
  theme: 'light', // 'light' | 'dark' | 'system'
  notifications: false,
};

/** Feeder states reported by the AI model. */
export const FEEDER_STATES = {
  EMPTY: { key: 'EMPTY', label: 'Empty', long: 'Feeder Empty', tone: 'amber' },
  PARTIAL: { key: 'PARTIAL', label: 'Partially Full', long: 'Feeder Partially Full', tone: 'blue' },
  FULL: { key: 'FULL', label: 'Full', long: 'Feeder Full', tone: 'green' },
};

/** Crusher run states. */
export const CRUSHER_STATES = {
  RUNNING: { key: 'RUNNING', label: 'Running', tone: 'green', note: 'Normal operation' },
  STOPPED: { key: 'STOPPED', label: 'Stopped', tone: 'gray', note: 'Crusher idle' },
  WARNING: { key: 'WARNING', label: 'Warning', tone: 'amber', note: 'Check alerts' },
  FAULT: { key: 'FAULT', label: 'Fault', tone: 'red', note: 'Operator action required' },
};

export const SEVERITY = {
  fault: { label: 'Fault', tone: 'red' },
  warning: { label: 'Warning', tone: 'amber' },
  info: { label: 'Info', tone: 'blue' },
  normal: { label: 'Normal', tone: 'green' },
};
