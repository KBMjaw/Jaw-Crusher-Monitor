/** Hash router: #/dashboard, #/machine, … Each view module exports
 *  { id, head(), render(el), update?(state, path), destroy?() }. */

import dashboard from './views/dashboard.js';
import machine from './views/machine.js';
import camera from './views/camera.js';
import alerts from './views/alerts.js';
import analytics from './views/analytics.js';
import profile from './views/profile.js';
import help from './views/help.js';
import { setActiveNav, setHeader } from './ui/shell.js';
import { store } from './core/store.js';

const VIEWS = { dashboard, machine, camera, alerts, analytics, profile, help };
let current = null;
let unsub = null;

function parse() {
  const id = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'dashboard');
  return VIEWS[id] ? id : 'dashboard';
}

export function renderRoute() {
  const id = parse();
  const old = document.getElementById('view');
  if (!old) return;
  const ae = document.activeElement;
  const moveFocus = old.contains(ae) || (ae && ae !== document.body && !document.getElementById('modal-root').contains(ae));
  current?.destroy?.();
  // Fresh element per route so view-level listeners never accumulate.
  const el = old.cloneNode(false);
  old.replaceWith(el);
  unsub?.();
  current = VIEWS[id];
  setActiveNav(id);
  setHeader(current.head());
  el.className = 'view view-enter';
  el.innerHTML = '';
  current.render(el);
  if (current.update) {
    current.update(store.state, '*');
    unsub = store.subscribe((st, path) => current.update(st, path));
  }
  window.scrollTo(0, 0);
  // Move keyboard / screen-reader focus to the new page content.
  if (moveFocus) el.focus({ preventScroll: true });
  document.title = `${current.head().title || 'Dashboard'} — Crusher Monitor`;
}

/** Re-render the current view (after settings / branding change). */
export function rerender() {
  renderRoute();
}

export function startRouter() {
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

export function stopRouter() {
  window.removeEventListener('hashchange', renderRoute);
  current?.destroy?.();
  unsub?.();
  current = null;
}
