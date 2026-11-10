/** Login screen (demo credentials, see core/auth.js). */

import { auth } from '../core/auth.js';
import { settings } from '../core/settings.js';
import { APP } from '../config.js';
import { icon } from '../ui/icons.js';
import { brandLockupHTML, $ } from '../ui/components.js';
import { esc } from '../core/format.js';
import { pwa } from '../pwa/install.js';
import { installFlow } from '../ui/shell.js';

export function renderLogin(root, { onSuccess }) {
  const s = settings.all;
  const remembered = auth.rememberedUsername;
  root.innerHTML = `
    <main class="login">
      <section class="login-hero">
        ${brandLockupHTML(68)}
        <h1 class="login-app">${esc(APP.name)}</h1>
        <div class="login-tag">Monitor · Control · Higher Output</div>
      </section>
      <section class="login-body">
        <form class="card login-card" novalidate autocomplete="on">
          <h2>Sign in</h2>
          <p class="muted">${esc(s.plantName)}</p>
          <div class="banner soft-red login-error" role="alert" hidden>${icon('fault', { size: 18 })}<span></span></div>
          <label class="field">
            <span class="field-label">Username</span>
            <span class="field-control with-icon">
              <span class="input-icon">${icon('user', { size: 18 })}</span>
              <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(remembered)}" required>
            </span>
          </label>
          <label class="field">
            <span class="field-label">Password</span>
            <span class="field-control with-icon">
              <span class="input-icon">${icon('lock', { size: 18 })}</span>
              <input name="password" type="password" autocomplete="current-password" required style="padding-right:46px">
              <button type="button" class="pw-toggle" aria-label="Show password" data-pw>${icon('eye', { size: 18 })}</button>
            </span>
          </label>
          <div style="display:flex;justify-content:space-between;align-items:center;margin:2px 0 18px">
            <label class="check"><input type="checkbox" name="remember" ${remembered ? 'checked' : ''}> Remember me</label>
          </div>
          <button class="btn btn-primary btn-block" type="submit">Login ${icon('arrowRight', { size: 18 })}</button>
          <button class="btn btn-ghost btn-block" type="button" data-install style="margin-top:10px" hidden>${icon('install', { size: 18 })} Install App</button>
        </form>
        <p class="login-foot">Demo login: <span class="demo-hint">${esc(APP.demoUser.username)}</span> / <span class="demo-hint">${esc(APP.demoUser.password)}</span><br>
        Version ${APP.version} · ${APP.dataSource === 'mock' ? 'Demo data — no hardware connected' : 'Live'}</p>
      </section>
    </main>`;

  const form = $('form', root);
  const err = $('.login-error', root);
  const pw = form.password;
  const submit = form.querySelector('[type="submit"]');

  $('[data-pw]', root).addEventListener('click', (e) => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    e.currentTarget.innerHTML = icon(show ? 'eyeOff' : 'eye', { size: 18 });
    e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  const installBtn = $('[data-install]', root);
  const syncInstall = () => { installBtn.hidden = !pwa.installAvailable; };
  syncInstall();
  pwa.onChange(syncInstall);
  installBtn.addEventListener('click', installFlow);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      await auth.login(form.username.value, pw.value, form.remember.checked);
      onSuccess();
    } catch (ex) {
      err.hidden = false;
      err.querySelector('span').textContent = ex.message;
      submit.disabled = false;
      submit.innerHTML = `Login ${icon('arrowRight', { size: 18 })}`;
      pw.select();
    }
  });

  (form.username.value ? pw : form.username).focus();
}
