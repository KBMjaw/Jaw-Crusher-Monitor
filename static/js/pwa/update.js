/**
 * "New version available — Reload" banner.
 *
 * The service worker installs a new version in the background and waits.
 * We never reload on our own: the user decides, and if there is unsaved work
 * (an open form or a pending manual speed) they are asked to confirm first.
 */

import { icon } from '../ui/icons.js';
import { confirmDialog } from '../ui/components.js';

const CHECK_EVERY_MS = 30 * 60 * 1000;
const unsavedChecks = new Set();
let banner = null;
let reloading = false;

/** Views register a function that returns a description of unsaved work, or ''. */
export function registerUnsavedCheck(fn) {
  unsavedChecks.add(fn);
  return () => unsavedChecks.delete(fn);
}

function unsavedWork() {
  const items = [...unsavedChecks].map((fn) => { try { return fn(); } catch { return ''; } }).filter(Boolean);
  if (document.body.classList.contains('modal-open')) items.push('an open form or dialog');
  return items;
}

function showBanner(worker, note = 'Reload to update the app.') {
  if (banner) {
    banner.worker = worker;
    banner.querySelector('[data-note]').textContent = note;
    return;
  }
  banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = `
    ${icon('refresh', { size: 18 })}
    <span class="grow"><strong>New version available</strong><span data-note></span></span>
    <button type="button" class="btn btn-ghost btn-sm" data-later>Later</button>
    <button type="button" class="btn btn-primary btn-sm" data-reload>Reload</button>`;
  banner.worker = worker;
  banner.querySelector('[data-note]').textContent = note;
  document.body.appendChild(banner);
  document.body.classList.add('has-update-banner');
  banner.querySelector('[data-later]').onclick = () => { banner.remove(); banner = null; document.body.classList.remove('has-update-banner'); };
  banner.querySelector('[data-reload]').onclick = async () => {
    const work = unsavedWork();
    if (work.length) {
      const ok = await confirmDialog({
        title: 'Reload now?',
        message: `You have unsaved work (${work.join(', ')}). Reloading will discard it. Reload anyway?`,
        confirmLabel: 'Reload',
        cancelLabel: 'Keep working',
      });
      if (!ok) return;
    }
    reloading = true;
    const w = banner.worker;
    if (w) w.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  };
}

function track(reg) {
  // A worker already waiting (e.g. update downloaded while the tab was in the background).
  if (reg.waiting && navigator.serviceWorker.controller) showBanner(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    if (!nw) return;
    nw.addEventListener('statechange', () => {
      // 'installed' with an existing controller = an update (not the first install)
      if (nw.state === 'installed' && navigator.serviceWorker.controller) showBanner(nw);
    });
  });
}

export function initUpdates(reg) {
  track(reg);
  // On a first install the new worker takes control of an uncontrolled page;
  // that is not an update and must not show the banner.
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (reloading) { location.reload(); return; } // the user chose Reload here
    // Another tab activated the update: this tab keeps running (no forced
    // reload) and asks the user to reload when convenient.
    showBanner(null, 'The app was updated in another window. Reload to continue.');
  });
  const check = () => reg.update().catch(() => {});
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
