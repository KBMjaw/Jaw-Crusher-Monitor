/** Shared UI building blocks: modal sheets, confirm dialogs, toasts, brand. */

import { icon, defaultLogo } from './icons.js';
import { settings } from '../core/settings.js';
import { esc } from '../core/format.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Set text of every [data-b="key"] inside root. */
export function bindText(root, key, value) {
  root.querySelectorAll(`[data-b="${key}"]`).forEach((el) => {
    const v = String(value);
    if (el.textContent !== v) el.textContent = v;
  });
}

export function toneChip(tone, label, { dot = true } = {}) {
  return `<span class="chip chip-${tone}">${dot ? '<i class="dot"></i>' : ''}${esc(label)}</span>`;
}

export function logoHTML(size = 40) {
  const src = settings.get('companyLogo');
  return src
    ? `<img class="logo-img" src="${src}" width="${size}" height="${size}" alt="Company logo">`
    : defaultLogo(size);
}

/**
 * Logo + company wordmark lockup ("Kannan" over a rule and "BLUE METALS").
 * First word of the company name is the headline, the rest the subline.
 */
export function brandLockupHTML(size = 56) {
  const words = (settings.get('companyName') || '').trim().split(/\s+/);
  const head = words[0] || '';
  const rest = words.slice(1).join(' ');
  return `<div class="lockup">
    <div class="lockup-mark" style="width:${size}px;height:${size}px">${logoHTML(size)}</div>
    <div class="lockup-text"><strong>${esc(head)}</strong>${rest ? `<span>${esc(rest)}</span>` : ''}</div>
  </div>`;
}

export function avatarHTML(size = 40) {
  const src = settings.get('profilePhoto');
  if (src) return `<img class="avatar" src="${src}" width="${size}" height="${size}" alt="Profile photo">`;
  const initials = (settings.get('profileName') || 'A').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return `<span class="avatar avatar-initials" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">${esc(initials)}</span>`;
}

/* ── Toasts ── */
export function toast(message, tone = 'info', ms = 3200) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.setAttribute('role', 'status');
  const ic = { info: 'info', success: 'checkCircle', warning: 'alert', error: 'fault' }[tone] || 'info';
  el.innerHTML = `${icon(ic, { size: 18 })}<span>${esc(message)}</span>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

/* ── Modal / bottom sheet ── */
let openModals = 0;

/**
 * Keyboard focus stays inside the top-most dialog: everything behind it
 * (app, login, lower dialogs) is made inert while a dialog is open.
 */
function setBackgroundInert() {
  const wraps = [...document.querySelectorAll('#modal-root .modal-wrap')];
  const top = wraps[wraps.length - 1];
  wraps.forEach((w) => { w.inert = w !== top; });
  ['#app', '#login-root', '.update-banner', '.skip-link'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.inert = !!top;
  });
}

/**
 * Opens a modal. `body` is HTML; `onMount(el, close)` wires behaviour.
 * Returns a close function.
 */
export function modal({ title, body, footer = '', onMount, onClose, size = 'md', dismissible = true }) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        ${dismissible ? `<button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(wrap);
  openModals++;
  document.body.classList.add('modal-open');
  setBackgroundInert();
  const prevFocus = document.activeElement;

  const close = () => {
    if (!wrap.isConnected) return;
    wrap.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    onClose?.();
    setTimeout(() => {
      wrap.remove();
      openModals = Math.max(0, openModals - 1);
      if (!openModals) document.body.classList.remove('modal-open');
      setBackgroundInert();
      prevFocus?.focus?.();
    }, 180);
  };
  const onKey = (e) => {
    if (root.lastElementChild !== wrap) return; // only the top-most dialog reacts
    if (e.key === 'Escape' && dismissible) { close(); return; }
    if (e.key === 'Tab') {
      // Keep keyboard focus cycling inside the dialog.
      const items = [...wrap.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !wrap.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !wrap.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  if (dismissible) wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => {
    wrap.classList.add('show');
    const first = wrap.querySelector('input, select, button.btn-primary, button:not([data-close])');
    first?.focus({ preventScroll: true });
  });
  onMount?.(wrap, close);
  return close;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    modal({
      title,
      size: 'sm',
      body: `<p class="confirm-msg">${esc(message)}</p>`,
      footer: `<button class="btn btn-ghost" data-act="cancel">${esc(cancelLabel)}</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmLabel)}</button>`,
      onMount(el, close) {
        el.querySelector('[data-act="cancel"]').onclick = close;
        el.querySelector('[data-act="ok"]').onclick = () => { result = true; close(); };
      },
      onClose: () => resolve(result),
    });
  });
}

/** Field helper for forms. */
export function field({ name, label, type = 'text', value = '', hint = '', suffix = '', attrs = '' }) {
  return `
    <label class="field">
      <span class="field-label">${esc(label)}</span>
      <span class="field-control${suffix ? ' has-suffix' : ''}">
        <input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>
        ${suffix ? `<span class="field-suffix">${esc(suffix)}</span>` : ''}
      </span>
      <span class="field-error" data-err="${name}"></span>
      ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
    </label>`;
}

export function showErrors(form, errors) {
  form.querySelectorAll('[data-err]').forEach((el) => {
    const msg = errors[el.dataset.err] || '';
    el.textContent = msg;
    el.closest('.field')?.classList.toggle('invalid', !!msg);
  });
}

/** Resize an uploaded image to a square-bounded PNG data URL. */
export function readImageFile(file, maxSize = 512) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected'));
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.type)) return reject(new Error('Use a PNG, JPG, WEBP or SVG image'));
    if (file.size > 8 * 1024 * 1024) return reject(new Error('Image must be smaller than 8 MB'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || maxSize, img.naturalHeight || maxSize));
      const w = Math.max(1, Math.round((img.naturalWidth || maxSize) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || maxSize) * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
    img.src = url;
  });
}
