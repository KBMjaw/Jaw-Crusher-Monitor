/** Formatting helpers shared by views and reports. */

export const pad = (n) => String(n).padStart(2, '0');

export function fmtDuration(sec, { short = false } = {}) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (short) return h ? `${h}h ${pad(m)}m` : `${m}m`;
  return `${h}h ${m}m`;
}

export function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
}

export function fmtTimeSec(d) {
  return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateShort(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function fmtDateTime(d) {
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

export function toISODate(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function fromISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function relTime(d) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return fmtDateShort(d);
}

export function pct(n, digits = 1) {
  return `${Number(n).toFixed(digits)}%`;
}

export function hz(n, digits = 0) {
  return `${Number(n).toFixed(digits)} Hz`;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
