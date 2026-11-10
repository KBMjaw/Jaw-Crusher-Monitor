/**
 * PWA install support.
 *  • Chrome / Edge on Android and Windows fire `beforeinstallprompt`; we keep
 *    the event and show an "Install App" button that triggers it.
 *  • iOS Safari has no install prompt — we show "Share → Add to Home Screen".
 *  • Already installed (standalone) → no install button.
 */

import { settings } from '../core/settings.js';
import { initUpdates } from './update.js';

let deferred = null;
let installed = false;
const EVT = 'cm:installchange';

export const pwa = {
  get isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: window-controls-overlay)').matches
      || window.navigator.standalone === true;
  },
  get isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },
  get canPrompt() { return !!deferred; },
  /** Whether an install entry point should be shown at all. */
  get installAvailable() {
    return !this.isStandalone && !installed && (!!deferred || this.isIOS);
  },

  async install() {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      document.dispatchEvent(new Event(EVT));
      return outcome; // 'accepted' | 'dismissed'
    }
    return this.isIOS ? 'ios' : 'unavailable';
  },

  onChange(fn) {
    document.addEventListener(EVT, fn);
    return () => document.removeEventListener(EVT, fn);
  },
};

export function initPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    document.dispatchEvent(new Event(EVT));
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    document.dispatchEvent(new Event(EVT));
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => initUpdates(reg))
        .catch((err) => console.warn('SW registration failed', err));
    });
  }

  applyBrandIcon();
  settings.subscribe((_, changed) => { if ('companyLogo' in changed) applyBrandIcon(); });
}

/** Use the uploaded company logo for the browser tab icon. */
function applyBrandIcon() {
  const logo = settings.get('companyLogo');
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = logo || '/icons/favicon-32.png';
}
