/** Profile & Settings: profile, company branding, feeder frequencies, preferences, account. */

import { settings, validateFrequencies } from '../core/settings.js';
import { auth } from '../core/auth.js';
import { APP, DEFAULT_SETTINGS } from '../config.js';
import { icon } from '../ui/icons.js';
import {
  $, modal, toast, confirmDialog, field, showErrors, readImageFile, logoHTML, avatarHTML,
} from '../ui/components.js';
import { esc } from '../core/format.js';
import { pwa } from '../pwa/install.js';
import { notifications } from '../pwa/notifications.js';
import { installFlow } from '../ui/shell.js';
import { DataService } from '../services/dataService.js';
import { requestPin } from '../ui/pinDialog.js';
import { pinGuard } from '../core/security.js';

let offInstall = null;

function row({ ic, tone = 'blue', label, desc = '', value = '', act, href, chevron = true, extra = '' }) {
  const tag = href ? 'a' : 'button';
  const attrs = href ? `href="${href}"` : `type="button" data-act="${act}"`;
  return `<${tag} class="list-row" ${attrs}>
    <span class="icon-tile soft-${tone}">${icon(ic, { size: 18 })}</span>
    <span class="grow"><span class="label">${esc(label)}</span>${desc ? `<span class="desc" style="display:block">${desc}</span>` : ''}</span>
    ${value ? `<span class="value">${value}</span>` : ''}${extra}
    ${chevron ? icon('chevron', { size: 18 }) : ''}
  </${tag}>`;
}

/* ── Editors ── */

function imagePicker({ name, current, preview, maxSize }) {
  return `<div class="upload-row" data-picker="${name}">
    <div class="${name === 'logo' ? 'logo-box' : ''}" data-preview>${preview}</div>
    <div class="btns">
      <label class="btn btn-ghost btn-sm">${icon('image', { size: 16 })}${current ? 'Change' : 'Upload'}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden data-file data-max="${maxSize}"></label>
      <button type="button" class="btn btn-ghost btn-sm" data-remove ${current ? '' : 'hidden'}>Remove</button>
    </div>
  </div>`;
}

function wirePicker(el, onChange, renderPreview) {
  const input = $('[data-file]', el);
  input.addEventListener('change', async () => {
    try {
      const url = await readImageFile(input.files[0], Number(input.dataset.max));
      onChange(url);
      $('[data-preview]', el).innerHTML = renderPreview(url);
      $('[data-remove]', el).hidden = false;
    } catch (e) {
      toast(e.message, 'error');
    }
    input.value = '';
  });
  $('[data-remove]', el).addEventListener('click', (e) => {
    onChange(null);
    $('[data-preview]', el).innerHTML = renderPreview(null);
    e.currentTarget.hidden = true;
  });
}

function editProfile() {
  let photo = settings.get('profilePhoto');
  const prev = (url) => (url ? `<img class="avatar" src="${url}" width="64" height="64" alt="">` : avatarHTML(64));
  modal({
    title: 'Edit Profile',
    body: `<form novalidate data-form>
      ${imagePicker({ name: 'photo', current: photo, preview: prev(photo), maxSize: 256 })}
      ${field({ name: 'profileName', label: 'Profile name', value: settings.get('profileName'), attrs: 'maxlength="40" required' })}
      ${field({ name: 'profileRole', label: 'Role', value: settings.get('profileRole'), attrs: 'maxlength="40"', hint: 'Shown on your profile. Roles and permissions will come from the backend later.' })}
    </form>`,
    footer: '<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
    onMount(el, close) {
      wirePicker($('[data-picker="photo"]', el), (u) => { photo = u; }, prev);
      $('[data-cancel]', el).onclick = close;
      $('[data-save]', el).onclick = () => {
        const f = $('[data-form]', el);
        const name = f.profileName.value.trim();
        if (!name) return showErrors(f, { profileName: 'Enter a name' });
        if (!settings.update({ profileName: name, profileRole: f.profileRole.value.trim() || 'Administrator', profilePhoto: photo })) {
          return toast('Could not save — image may be too large for device storage', 'error');
        }
        toast('Profile updated', 'success');
        close();
      };
    },
  });
}

function editCompany() {
  let logo = settings.get('companyLogo');
  const prev = (url) => (url ? `<img src="${url}" alt="">` : logoHTML(64));
  modal({
    title: 'Company Information',
    body: `<form novalidate data-form>
      <div class="field-label">Company logo</div>
      ${imagePicker({ name: 'logo', current: logo, preview: prev(logo), maxSize: 512 })}
      <p class="form-note" style="margin:-6px 0 14px">Used on login, header, profile and reports. Square PNG works best. Stored on this device.</p>
      ${field({ name: 'companyName', label: 'Company name', value: settings.get('companyName'), attrs: 'maxlength="60" required' })}
      ${field({ name: 'plantName', label: 'Plant / site name', value: settings.get('plantName'), attrs: 'maxlength="60" required' })}
    </form>`,
    footer: '<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
    onMount(el, close) {
      wirePicker($('[data-picker="logo"]', el), (u) => { logo = u; }, prev);
      $('[data-cancel]', el).onclick = close;
      $('[data-save]', el).onclick = () => {
        const f = $('[data-form]', el);
        const errs = {};
        if (!f.companyName.value.trim()) errs.companyName = 'Enter the company name';
        if (!f.plantName.value.trim()) errs.plantName = 'Enter the plant / site name';
        showErrors(f, errs);
        if (Object.keys(errs).length) return;
        if (!settings.update({ companyName: f.companyName.value.trim(), plantName: f.plantName.value.trim(), companyLogo: logo })) {
          return toast('Could not save — logo may be too large for device storage', 'error');
        }
        toast('Company information updated', 'success');
        close();
      };
    },
  });
}

const EMPTY_FIELDS = ['freqEmpty', 'manualMin', 'manualMax'];

function editFrequencies() {
  const s = settings.all;
  let unlocked = pinGuard.recentlyVerified; // shared 5-minute PIN window
  modal({
    title: 'Feeder Frequency Settings',
    body: `<form novalidate data-form>
      <div class="eyebrow" style="margin-bottom:10px">Automatic frequency per AI state</div>
      <div class="form-grid">
        ${field({ name: 'freqFull', label: 'Full', type: 'number', value: s.freqFull, suffix: 'Hz', attrs: 'inputmode="decimal" step="1"' })}
        ${field({ name: 'freqPartial', label: 'Partially full', type: 'number', value: s.freqPartial, suffix: 'Hz', attrs: 'inputmode="decimal" step="1"' })}
      </div>
      <div class="protected" data-protected>
        <div class="protected-head">
          <div><div class="eyebrow">Empty feeder speed</div><div class="form-note" data-lockmsg>PIN required to change these values.</div></div>
          <button type="button" class="btn btn-ghost btn-sm" data-unlock>${icon('lock', { size: 16 })}Unlock</button>
        </div>
        ${field({ name: 'freqEmpty', label: 'Empty (automatic)', type: 'number', value: s.freqEmpty, suffix: 'Hz', attrs: 'inputmode="decimal" step="1" readonly' })}
        <div class="form-grid">
          ${field({ name: 'manualMin', label: 'Manual minimum', type: 'number', value: s.manualMin, suffix: 'Hz', attrs: 'inputmode="decimal" step="1" readonly' })}
          ${field({ name: 'manualMax', label: 'Manual maximum', type: 'number', value: s.manualMax, suffix: 'Hz', attrs: 'inputmode="decimal" step="1" readonly' })}
        </div>
      </div>
      <p class="form-note">Allowed drive range ${APP.vfdLimits.min}–${APP.vfdLimits.max} Hz. Changes are recorded in the Audit Log. In the final system these values are saved to and enforced by the backend.</p>
    </form>`,
    footer: '<button class="btn btn-ghost" data-reset>Defaults</button><button class="btn btn-primary" data-save>Save</button>',
    onMount(el, close) {
      const f = $('[data-form]', el);
      const box = $('[data-protected]', el);
      const setLocked = (locked) => {
        EMPTY_FIELDS.forEach((k) => { f[k].readOnly = locked; });
        box.classList.toggle('is-locked', locked);
        const b = $('[data-unlock]', el);
        b.hidden = !locked;
        $('[data-lockmsg]', el).innerHTML = locked
          ? 'PIN required to change these values.'
          : `<span class="t-green">${icon('check', { size: 14 })} Unlocked — PIN valid for ${Math.max(1, Math.round(pinGuard.remainingSec / 60))} more min.</span>`;
      };
      setLocked(!unlocked);
      const unlock = async () => {
        if (unlocked) return true;
        unlocked = await requestPin({ context: 'Empty feeder speed settings' });
        setLocked(!unlocked);
        if (unlocked) f.freqEmpty.focus();
        return unlocked;
      };
      $('[data-unlock]', el).onclick = unlock;
      // Trying to edit a locked field opens the PIN prompt.
      EMPTY_FIELDS.forEach((k) => f[k].addEventListener('focus', () => { if (!unlocked) { f[k].blur(); unlock(); } }));
      $('[data-reset]', el).onclick = () => {
        const D = DEFAULT_SETTINGS;
        const d = { freqFull: D.freqFull, freqPartial: D.freqPartial, ...(unlocked ? { freqEmpty: D.freqEmpty, manualMin: D.manualMin, manualMax: D.manualMax } : {}) };
        Object.entries(d).forEach(([k, v]) => { f[k].value = v; });
        showErrors(f, {});
        if (!unlocked) toast('Full and Partial reset. Unlock with PIN to reset Empty settings.', 'info');
      };
      $('[data-save]', el).onclick = async () => {
        const v = Object.fromEntries(['freqFull', 'freqPartial', ...EMPTY_FIELDS].map((k) => [k, f[k].value]));
        const errs = validateFrequencies(v);
        showErrors(f, errs);
        if (Object.keys(errs).length) return;
        const n = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(Number(x))]));
        const emptyChanged = EMPTY_FIELDS.some((k) => n[k] !== settings.get(k));
        if (emptyChanged && !unlocked) { toast('Enter the PIN to change Empty speed settings', 'warning'); return; }
        // The PIN window may have expired while the form was open — ask again.
        if (emptyChanged && !pinGuard.recentlyVerified) {
          const again = await requestPin({ message: 'PIN expired — enter PIN again to save Empty feeder speed settings', context: 'Empty feeder speed settings' });
          if (!again) return;
        }
        if (!unlocked) EMPTY_FIELDS.forEach((k) => { delete n[k]; });
        const lo = n.manualMin ?? settings.get('manualMin');
        const hi = n.manualMax ?? settings.get('manualMax');
        const md = Math.min(hi, Math.max(lo, settings.get('manualDefault')));
        settings.update({ ...n, manualDefault: md });
        toast('Frequency settings saved', 'success');
        close();
      };
    },
  });
}

function editSupport() {
  const s = settings.all;
  modal({
    title: 'Support Contact',
    size: 'sm',
    body: `<form novalidate data-form>
      ${field({ name: 'supportPhone', label: 'WhatsApp / phone number', type: 'tel', value: s.supportPhone, attrs: 'inputmode="tel" maxlength="15"', hint: `Country code +${s.supportCountryCode} is added for WhatsApp.` })}
      ${field({ name: 'supportEmail', label: 'Support email', type: 'email', value: s.supportEmail, attrs: 'inputmode="email"' })}
    </form>`,
    footer: '<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
    onMount(el, close) {
      const f = $('[data-form]', el);
      $('[data-cancel]', el).onclick = close;
      $('[data-save]', el).onclick = () => {
        const phone = f.supportPhone.value.replace(/[^\d]/g, '');
        const email = f.supportEmail.value.trim();
        const errs = {};
        if (phone.length < 10) errs.supportPhone = 'Enter a 10-digit number';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.supportEmail = 'Enter a valid email address';
        showErrors(f, errs);
        if (Object.keys(errs).length) return;
        settings.update({ supportPhone: phone.slice(-10), supportEmail: email });
        toast('Support contact saved', 'success');
        close();
      };
    },
  });
}

function changePassword() {
  const pw = (name, label, ac) => `
    <label class="field"><span class="field-label">${label}</span>
      <span class="field-control"><input name="${name}" type="password" autocomplete="${ac}" style="padding-right:46px">
      <button type="button" class="pw-toggle" data-pw aria-label="Show password">${icon('eye', { size: 18 })}</button></span>
      <span class="field-error" data-err="${name}"></span></label>`;
  modal({
    title: 'Change Password',
    size: 'sm',
    body: `<form novalidate data-form>
      ${pw('current', 'Current password', 'current-password')}
      ${pw('next', 'New password', 'new-password')}
      ${pw('confirm', 'Confirm new password', 'new-password')}
      <div class="banner soft-amber" style="font-size:12.5px">${icon('shield', { size: 16 })}<div>Prototype only: the password is checked and stored on this device, not on a server. Secure password management will be handled by the backend.</div></div>
    </form>`,
    footer: '<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Update password</button>',
    onMount(el, close) {
      const f = $('[data-form]', el);
      el.querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', () => {
        const inp = b.previousElementSibling;
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        b.innerHTML = icon(show ? 'eyeOff' : 'eye', { size: 18 });
      }));
      $('[data-cancel]', el).onclick = close;
      $('[data-save]', el).onclick = async () => {
        const errs = await auth.changePassword({ current: f.current.value, next: f.next.value, confirm: f.confirm.value });
        showErrors(f, errs);
        if (Object.keys(errs).length) return;
        toast('Password changed on this device', 'success');
        close();
      };
    },
  });
}

/* ── View ── */

export default {
  id: 'profile',
  head: () => ({ title: 'Profile & Settings', subtitle: 'Account, company and preferences' }),

  render(root) {
    const s = settings.all;
    const notifState = !notifications.supported ? 'Not supported in this browser'
      : notifications.permission === 'denied' ? 'Blocked in browser settings'
        : s.notifications ? (notifications.pushReady ? 'On' : 'On · push server not connected yet') : 'Off';
    root.innerHTML = `
      <div class="profile-cols">
        <div>
          <div class="section-title">My Profile</div>
          <section class="card">
            <div class="profile-card">
              ${avatarHTML(64)}
              <div style="flex:1;min-width:0">
                <div class="profile-name">${esc(s.profileName)}</div>
                <div class="muted" style="font-size:14px">${esc(s.profileRole)}</div>
                <div class="subtle" style="font-size:12.5px;margin-top:2px">Signed in as ${esc(auth.user?.username || APP.demoUser.username)}</div>
              </div>
              <button class="icon-btn" data-act="profile" aria-label="Edit profile">${icon('edit', { size: 18 })}</button>
            </div>
          </section>

          <div class="section-title">Company</div>
          <section class="card">
            <div class="profile-card" style="margin-bottom:12px">
              <div class="logo-box">${logoHTML(64)}</div>
              <div style="flex:1;min-width:0">
                <div class="eyebrow">Company</div>
                <div style="font-weight:700;font-size:16px">${esc(s.companyName)}</div>
                <div class="eyebrow" style="margin-top:6px">Plant / Site</div>
                <div style="font-weight:600">${esc(s.plantName)}</div>
              </div>
              <button class="icon-btn" data-act="company" aria-label="Edit company">${icon('edit', { size: 18 })}</button>
            </div>
            <button class="btn btn-ghost btn-sm btn-block" data-act="company">${icon('image', { size: 16 })}Change logo & company details</button>
          </section>

          <div class="section-title">Feeder Control</div>
          <div class="list">
            ${row({ ic: 'sliders', label: 'Feeder frequency settings', desc: `Full ${s.freqFull} · Partial ${s.freqPartial} · Empty ${s.freqEmpty} Hz (Empty: PIN)`, act: 'freq' })}
            ${row({ ic: 'hand', tone: 'amber', label: 'Manual empty speed range', desc: `${s.manualMin}–${s.manualMax} Hz · only while AI detects EMPTY · PIN protected`, act: 'freq' })}
          </div>
        </div>

        <div>
          <div class="section-title">Preferences</div>
          <div class="list">
            <div class="list-row">
              <span class="icon-tile soft-blue">${icon('moon', { size: 18 })}</span>
              <span class="grow"><span class="label">Theme</span></span>
              <div class="seg" style="width:210px;padding:3px" data-theme-seg>
                ${['light', 'dark', 'system'].map((t) => `<button type="button" data-t="${t}" class="${s.theme === t ? 'on' : ''}" style="height:32px;font-size:12.5px;letter-spacing:0">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
              </div>
            </div>
            <div class="list-row">
              <span class="icon-tile soft-blue">${icon('bell', { size: 18 })}</span>
              <span class="grow"><span class="label">Push notifications</span><span class="desc" style="display:block" data-notif-state>${esc(notifState)}</span></span>
              <label class="switch"><input type="checkbox" data-notif ${s.notifications ? 'checked' : ''} ${notifications.supported ? '' : 'disabled'} aria-label="Push notifications"><span></span></label>
            </div>
            <div data-install-row></div>
          </div>

          <div class="section-title">Account & Support</div>
          <div class="list">
            ${row({ ic: 'lock', label: 'Change password', act: 'password' })}
            ${row({ ic: 'phone', tone: 'green', label: 'Support contact', desc: `${esc(s.supportPhone)} · ${esc(s.supportEmail)}`, act: 'support' })}
            ${row({ ic: 'help', label: 'Help & Support', desc: 'WhatsApp, call or email', href: '#/help' })}
          </div>

          <div style="margin-top:20px">
            <button class="btn btn-danger-soft btn-block" data-act="logout">${icon('logout', { size: 18 })}Logout</button>
          </div>
          <p class="about">${esc(APP.name)} v${APP.version} (${APP.build})<br>
            Data source: ${DataService.source === 'mock' ? 'Demo data — hardware not connected' : esc(APP.apiBase)}<br>
            Settings are stored on this device.</p>
        </div>
      </div>`;

    const actions = {
      profile: editProfile,
      company: editCompany,
      freq: editFrequencies,
      support: editSupport,
      password: changePassword,
      install: installFlow,
      logout: async () => {
        const ok = await confirmDialog({ title: 'Logout', message: 'Are you sure you want to logout?', confirmLabel: 'Logout', danger: true });
        if (ok) document.dispatchEvent(new Event('cm:logout'));
      },
    };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && actions[b.dataset.act]) actions[b.dataset.act]();
    });

    $('[data-theme-seg]', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      settings.update({ theme: b.dataset.t });
      root.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
    });

    $('[data-notif]', root).addEventListener('change', async (e) => {
      const stateEl = $('[data-notif-state]', root);
      if (e.target.checked) {
        const r = await notifications.enable();
        if (!r.ok) { e.target.checked = false; toast(r.reason, 'warning', 4500); stateEl.textContent = 'Off'; return; }
        stateEl.textContent = notifications.pushReady ? 'On' : 'On · push server not connected yet';
        toast('Notifications enabled on this device', 'success');
      } else {
        notifications.disable();
        stateEl.textContent = 'Off';
      }
    });

    const renderInstall = () => {
      const el = $('[data-install-row]', root);
      if (!el) return;
      const desc = pwa.isStandalone ? 'Installed — running as an app'
        : pwa.installAvailable ? (pwa.isIOS ? 'Add to Home Screen from Safari' : 'Install on this device (Android / Windows)')
          : 'Use Chrome or Edge to install';
      el.innerHTML = row({ ic: 'install', tone: 'green', label: 'Install App', desc, act: 'install', chevron: !pwa.isStandalone });
      if (pwa.isStandalone) el.querySelector('button').disabled = true;
    };
    renderInstall();
    offInstall = pwa.onChange(renderInstall);

    if (/[?&]edit=freq/.test(location.hash)) {
      history.replaceState(null, '', '#/profile');
      editFrequencies();
    }
  },

  destroy() { offInstall?.(); },
};
