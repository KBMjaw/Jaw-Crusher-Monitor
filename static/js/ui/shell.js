/** App chrome: desktop sidebar, mobile top bar, bottom navigation. */

import { icon } from './icons.js';
import { logoHTML, avatarHTML, $ } from './components.js';
import { settings } from '../core/settings.js';
import { store } from '../core/store.js';
import { esc } from '../core/format.js';
import { pwa } from '../pwa/install.js';
import { APP } from '../config.js';

export const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'machine', label: 'Machine', icon: 'machine' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'alerts', label: 'Alerts', icon: 'bell' },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
  { id: 'profile', label: 'Profile', icon: 'user' },
];

export function renderShell(root) {
  const s = settings.all;
  root.innerHTML = `
    <aside class="sidebar" aria-label="Main navigation">
      <div class="side-brand">
        <div class="brand-logo" data-logo>${logoHTML(42)}</div>
        <div><strong data-b="company">${esc(s.companyName)}</strong><span>${esc(APP.name)}</span></div>
      </div>
      <nav class="side-nav">
        ${NAV.map((n) => `<a class="side-link" href="#/${n.id}" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span>${n.id === 'alerts' ? '<span class="badge" data-alert-badge hidden></span>' : ''}</a>`).join('')}
      </nav>
      <div class="side-foot">
        <button class="btn" data-install hidden>${icon('install', { size: 18 })}Install App</button>
        <div class="side-src" data-src></div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar" data-topbar></header>
      <header class="page-head" data-pagehead></header>
      <main class="view" id="view" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" aria-label="Main navigation">
      ${NAV.map((n) => `<a class="nav-link" href="#/${n.id}" data-nav="${n.id}"><span class="nav-ic">${icon(n.icon, { size: 21 })}</span><span>${n.label}</span>${n.id === 'alerts' ? '<span class="badge" data-alert-badge hidden></span>' : ''}</a>`).join('')}
    </nav>`;

  root.querySelectorAll('[data-install]').forEach((b) => b.addEventListener('click', () => installFlow()));
  const refreshInstall = () => root.querySelectorAll('[data-install]').forEach((b) => { b.hidden = !pwa.installAvailable; });
  pwa.onChange(refreshInstall);
  refreshInstall();
  $('[data-src]', root).textContent = APP.dataSource === 'mock' ? 'Data source: Demo (mock)' : `Data source: ${APP.apiBase}`;
  updateAlertBadges();
  store.subscribe((_, path) => { if (path === 'alerts') updateAlertBadges(); });
}

export function updateAlertBadges() {
  const n = store.state.alerts.filter((a) => !a.read).length;
  document.querySelectorAll('[data-alert-badge]').forEach((b) => {
    b.hidden = n === 0;
    b.textContent = n > 99 ? '99+' : String(n);
  });
}

export function setActiveNav(id) {
  const navId = id === 'help' ? 'profile' : id;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === navId;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

/**
 * Renders the header for the current view.
 * head: { title, subtitle, back, brand (dashboard style), actions: html }
 */
export function setHeader(head) {
  const s = settings.all;
  const top = document.querySelector('[data-topbar]');
  const page = document.querySelector('[data-pagehead]');
  const unread = store.state.alerts.filter((a) => !a.read).length;
  const bell = `<a class="top-btn" href="#/alerts" aria-label="Alerts">${icon('bell')}${unread ? `<span class="badge" data-alert-badge>${unread}</span>` : '<span class="badge" data-alert-badge hidden></span>'}</a>`;
  const avatar = `<a class="top-avatar" href="#/profile" aria-label="Profile">${avatarHTML(38)}</a>`;

  if (head.brand) {
    top.innerHTML = `
      <div class="brand-logo" data-logo>${logoHTML(38)}</div>
      <div class="topbar-title"><h1>${esc(s.companyName)}</h1><p>${esc(s.plantName)}</p></div>
      <div class="topbar-actions">${bell}${avatar}</div>`;
  } else {
    top.innerHTML = `
      ${head.back ? `<a class="top-btn" href="${head.back}" aria-label="Back">${icon('back')}</a>` : ''}
      <div class="topbar-title"><h1>${esc(head.title)}</h1>${head.subtitle ? `<p>${esc(head.subtitle)}</p>` : ''}</div>
      <div class="topbar-actions">${head.actions || bell}</div>`;
  }

  page.innerHTML = `
    ${head.back ? `<a class="icon-btn" href="${head.back}" aria-label="Back">${icon('back')}</a>` : ''}
    <div class="grow"><h1>${esc(head.brand ? 'Dashboard' : head.title)}</h1><p>${esc(head.brand ? `${s.companyName} · ${s.plantName}` : head.subtitle || s.plantName)}</p></div>
    <div class="head-actions">
      ${head.deskActions || ''}
      <a class="icon-btn" href="#/alerts" aria-label="Alerts">${icon('bell')}<span class="badge" data-alert-badge ${unread ? '' : 'hidden'}>${unread}</span></a>
      <a href="#/profile" aria-label="Profile">${avatarHTML(42)}</a>
    </div>`;
  updateAlertBadges();
}

/** Refresh branding in persistent chrome after settings change. */
export function refreshBranding() {
  document.querySelectorAll('.sidebar [data-logo]').forEach((el) => { el.innerHTML = logoHTML(42); });
  document.querySelectorAll('.sidebar [data-b="company"]').forEach((el) => { el.textContent = settings.get('companyName'); });
}

export async function installFlow() {
  const { modal, toast } = await import('./components.js');
  if (pwa.canPrompt) {
    const outcome = await pwa.install();
    if (outcome === 'accepted') toast('Crusher Monitor is being installed', 'success');
    return;
  }
  if (pwa.isIOS) {
    modal({
      title: 'Install on iPhone / iPad',
      size: 'sm',
      body: `<ol class="muted" style="padding-left:18px;margin:0;line-height:1.8">
        <li>Open this page in <strong>Safari</strong>.</li>
        <li>Tap the <strong>Share</strong> button.</li>
        <li>Choose <strong>Add to Home Screen</strong>.</li></ol>`,
    });
    return;
  }
  modal({
    title: 'Install App',
    size: 'sm',
    body: `<p class="muted" style="line-height:1.6">Install is available in <strong>Chrome</strong> or <strong>Edge</strong> on Android and Windows.
      If no prompt appears, open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>`,
  });
}
