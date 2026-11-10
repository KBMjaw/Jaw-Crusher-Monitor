/** Alerts list with severity filters. */

import { DataService } from '../services/dataService.js';
import { icon } from '../ui/icons.js';
import { $ } from '../ui/components.js';
import { setHTML, alertRowHTML } from '../ui/widgets.js';
import { fmtDate } from '../core/format.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'fault', label: 'Fault' },
  { id: 'warning', label: 'Warning' },
  { id: 'info', label: 'Info' },
  { id: 'normal', label: 'Normal' },
];
let filter = 'all';

export default {
  id: 'alerts',
  head: () => ({ title: 'Alerts', subtitle: 'Crusher, feeder and VFD events' }),

  render(root) {
    root.innerHTML = `
      <div class="stack-y">
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div class="tabs" data-filters></div>
          <button class="btn btn-ghost btn-sm" data-readall>${icon('check', { size: 16 })}Mark all read</button>
        </div>
        <section class="card" data-list aria-live="polite"></section>
      </div>`;
    $('[data-filters]', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      filter = b.dataset.f;
      this.update(this._st, '*');
    });
    $('[data-readall]', root).addEventListener('click', () => DataService.markAlertsRead());
    $('[data-list]', root).addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) DataService.markAlertsRead([row.dataset.id]);
    });
  },

  update(st, path) {
    this._st = st;
    if (path !== 'alerts' && path !== '*') return;
    const root = document.getElementById('view');
    if (!root || !$('[data-list]', root)) return;
    const counts = { all: st.alerts.length };
    st.alerts.forEach((a) => { counts[a.severity] = (counts[a.severity] || 0) + 1; });
    setHTML($('[data-filters]', root), FILTERS.map((f) => `<button class="tab ${filter === f.id ? 'on' : ''}" data-f="${f.id}">${f.label}<span class="count">${counts[f.id] || 0}</span></button>`).join(''));
    const items = filter === 'all' ? st.alerts : st.alerts.filter((a) => a.severity === filter);
    if (!items.length) {
      setHTML($('[data-list]', root), `<div style="text-align:center;padding:36px 10px" class="subtle">${icon('checkCircle', { size: 32, cls: 't-green' }).replace('class="ic', 'style="margin:0 auto 10px" class="ic')}No ${filter === 'all' ? '' : `${filter} `}alerts</div>`);
      return;
    }
    // Group by day
    let html = '';
    let day = '';
    items.forEach((a) => {
      const d = fmtDate(a.time);
      if (d !== day) {
        day = d;
        html += `<div class="eyebrow" style="margin:${html ? '14px' : '0'} 0 6px">${d === fmtDate(new Date()) ? 'Today' : d}</div>`;
      }
      html += alertRowHTML(a);
    });
    setHTML($('[data-list]', root), html);
    const unread = st.alerts.some((a) => !a.read);
    $('[data-readall]', root).disabled = !unread;
  },
};
