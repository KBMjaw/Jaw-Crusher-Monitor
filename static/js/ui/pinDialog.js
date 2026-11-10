/** PIN prompt for protected settings. Resolves true only after a correct PIN. */

import { modal, $ } from './components.js';
import { icon } from './icons.js';
import { pinGuard } from '../core/security.js';
import { esc } from '../core/format.js';
import { APP } from '../config.js';

export function requestPin({ title = 'PIN Required', message = 'Enter PIN to modify Empty feeder speed settings', context } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    modal({
      title,
      size: 'sm',
      body: `
        <form novalidate data-pinform>
          <div class="pin-head">${icon('lock', { size: 22 })}<p>${esc(message)}</p></div>
          <label class="field">
            <span class="field-label">PIN</span>
            <input class="pin-input" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"
              autocomplete="off" autocorrect="off" spellcheck="false" placeholder="••••" aria-label="4-digit PIN">
            <span class="field-error" data-err="pin" role="alert"></span>
          </label>
          <p class="form-note">A correct PIN stays valid for ${Math.round(APP.pinGraceSec / 60)} minutes for Empty speed changes on the Machine screen and in Feeder Frequency Settings. Prototype: the PIN is checked on this device only.</p>
        </form>`,
      footer: '<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-verify>Verify</button>',
      onMount(el, close) {
        const form = $('[data-pinform]', el);
        const input = form.pin;
        const err = $('[data-err="pin"]', el);
        const btn = $('[data-verify]', el);
        input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); err.textContent = ''; });
        let verifying = false;
        const submit = async (e) => {
          e?.preventDefault();
          if (verifying) return;
          if (input.value.length !== 4) { err.textContent = 'Enter the 4-digit PIN.'; input.focus(); return; }
          verifying = true;
          btn.disabled = true;
          const res = await pinGuard.verify(input.value, context);
          btn.disabled = false;
          verifying = false;
          if (res.ok) { ok = true; close(); return; }
          err.textContent = res.error;
          input.value = '';
          input.focus();
        };
        form.addEventListener('submit', submit);
        btn.onclick = submit;
        $('[data-cancel]', el).onclick = close;
        setTimeout(() => input.focus(), 50);
      },
      onClose: () => resolve(ok),
    });
  });
}
