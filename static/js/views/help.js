/** Help & Support (opened from Profile). */

import { settings } from '../core/settings.js';
import { icon } from '../ui/icons.js';
import { esc } from '../core/format.js';
import { APP } from '../config.js';

export default {
  id: 'help',
  head: () => ({ title: 'Help & Support', subtitle: 'We are here to help', back: '#/profile' }),

  render(root) {
    const s = settings.all;
    const phone = s.supportPhone.replace(/\D/g, '');
    const intl = `${s.supportCountryCode}${phone}`;
    const waText = encodeURIComponent(`Hello, I need help with ${APP.name} at ${s.companyName} — ${s.plantName}.`);
    const mailSubject = encodeURIComponent(`${APP.name} support — ${s.plantName}`);
    root.innerHTML = `
      <div style="max-width:620px;margin:0 auto" class="stack-y">
        <div class="support-hero">
          <div class="icon-tile soft-blue">${icon('help', { size: 32 })}</div>
          <h2 style="font-size:20px">Need help?</h2>
          <p class="muted" style="font-size:14px">Contact support for the Crusher Monitor system.</p>
        </div>
        <a class="support-btn" href="https://wa.me/${intl}?text=${waText}" target="_blank" rel="noopener">
          <span class="icon-tile wa">${icon('whatsapp', { size: 24 })}</span>
          <span class="grow"><strong>WhatsApp Support</strong><span>${esc(phone)}</span></span>${icon('chevron', { size: 18 })}
        </a>
        <a class="support-btn" href="tel:+${intl}">
          <span class="icon-tile call">${icon('phone', { size: 22 })}</span>
          <span class="grow"><strong>Call Support</strong><span>${esc(phone)}</span></span>${icon('chevron', { size: 18 })}
        </a>
        <a class="support-btn" href="mailto:${esc(s.supportEmail)}?subject=${mailSubject}">
          <span class="icon-tile mail">${icon('mail', { size: 22 })}</span>
          <span class="grow"><strong>Email Support</strong><span>${esc(s.supportEmail)}</span></span>${icon('chevron', { size: 18 })}
        </a>
        ${s.supportEmail === 'support@example.com' ? `<p class="form-note" style="text-align:center">The support email is a placeholder. Set the real address in Profile › Support contact.</p>` : ''}
        <section class="card">
          <div class="card-title" style="margin-bottom:10px">${icon('clock', { size: 16 })}Quick guide</div>
          <div class="kv"><span>Manual feeder speed</span><strong>Only when AI shows EMPTY</strong></div>
          <div class="kv"><span>Manual range</span><strong>${s.manualMin}–${s.manualMax} Hz</strong></div>
          <div class="kv"><span>Reports</span><strong>Analytics › Download Report</strong></div>
          <div class="kv"><span>App version</span><strong>${APP.version}</strong></div>
        </section>
      </div>`;
  },
};
