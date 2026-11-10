/** Entry point: theme, PWA, auth gate, shell, data service, router. */

import { settings } from './core/settings.js';
import { auth } from './core/auth.js';
import { DataService } from './services/dataService.js';
import { initPWA } from './pwa/install.js';
import { notifications } from './pwa/notifications.js';
import { renderShell, refreshBranding } from './ui/shell.js';
import { startRouter, stopRouter, rerender } from './router.js';
import { renderLogin } from './views/login.js';
import { toast } from './ui/components.js';
import { installSettingsAudit } from './services/auditService.js';

const app = document.getElementById('app');
const loginRoot = document.getElementById('login-root');

/* ── Theme ── */
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const pref = settings.get('theme');
  const t = pref === 'system' ? (darkMq.matches ? 'dark' : 'light') : pref;
  document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0f1a33' : '#1b2d5b');
}
darkMq.addEventListener?.('change', applyTheme);

/* ── Session ── */
let started = false;

async function enterApp() {
  loginRoot.innerHTML = '';
  loginRoot.hidden = true;
  document.querySelector('[data-skip]').hidden = false;
  app.hidden = false;
  renderShell(app);
  if (!started) {
    started = true;
    await DataService.start();
  }
  if (!location.hash || location.hash === '#/' || location.hash === '#') location.replace('#/dashboard');
  startRouter();
}

export function logout() {
  auth.logout();
  stopRouter();
  DataService.stop();
  started = false;
  app.hidden = true;
  app.innerHTML = '';
  showLogin();
}

function showLogin() {
  loginRoot.hidden = false;
  document.querySelector('[data-skip]').hidden = true;
  renderLogin(loginRoot, { onSuccess: enterApp });
}

document.addEventListener('cm:logout', logout);

// "Skip to content" without changing the hash route.
document.querySelector('[data-skip]')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('view')?.focus();
});

/* ── Live alert side effects ── */
document.addEventListener('cm:alert', (e) => {
  const a = e.detail;
  if (a.severity === 'fault' || a.severity === 'warning') {
    toast(`${a.title}: ${a.description}`, a.severity === 'fault' ? 'error' : 'warning', 4500);
  }
  if (document.hidden && (a.severity === 'fault' || a.severity === 'warning')) {
    notifications.showLocal(a.title, a.description);
  }
});

/* ── Settings changes ── */
settings.subscribe((_, changed) => {
  if ('theme' in changed) applyTheme();
  if (['freqFull', 'freqPartial', 'freqEmpty', 'manualMin', 'manualMax'].some((k) => k in changed)) DataService.refresh();
  if (['companyName', 'plantName', 'companyLogo', 'profileName', 'profilePhoto', 'profileRole'].some((k) => k in changed)) {
    if (!app.hidden) { refreshBranding(); rerender(); }
  }
});

/* ── Boot ── */
applyTheme();
installSettingsAudit();
initPWA();
if (auth.user) enterApp(); else showLogin();
