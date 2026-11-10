/** Lightweight SVG charts (no dependencies). Colours come from CSS variables. */

import { esc } from '../core/format.js';

/**
 * Line chart. points: [{t, hz}]. Returns an SVG string.
 * opts: { height, min, max, bands: [{y, label}], xLabel: fn(t) }
 */
export function lineChart(points, { height = 180, min = 0, max = 50, bands = [], xLabel, ticks = 5, unit = 'Hz' } = {}) {
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 10, t: 10, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  if (!points.length) {
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="No data"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="chart-empty">No data for this period</text></svg>`;
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t || t0 + 1;
  const span = Math.max(1, t1 - t0);
  const x = (t) => pad.l + ((t - t0) / span) * iw;
  const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;

  let grid = '';
  const step = (max - min) / 5;
  for (let v = min; v <= max + 0.001; v += step) {
    grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/>
             <text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="chart-axis">${Math.round(v)}</text>`;
  }
  bands.forEach((b) => {
    grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(b.y)}" y2="${y(b.y)}" class="chart-ref"/>
             <text x="${W - pad.r - 2}" y="${y(b.y) - 4}" text-anchor="end" class="chart-ref-label">${esc(b.label)}</text>`;
  });
  let xl = '';
  for (let i = 0; i < ticks; i++) {
    const t = t0 + (span * i) / (ticks - 1);
    const anchor = i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle';
    xl += `<text x="${x(t)}" y="${H - 6}" text-anchor="${anchor}" class="chart-axis">${esc(xLabel ? xLabel(t) : '')}</text>`;
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(Math.max(min, Math.min(max, p.hz))).toFixed(1)}`).join('');
  const area = `${path}L${x(points[points.length - 1].t).toFixed(1)},${y(min)}L${x(t0).toFixed(1)},${y(min)}Z`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Frequency trend in ${unit}">
    ${grid}
    <path d="${area}" class="chart-area"/>
    <path d="${path}" class="chart-line" vector-effect="non-scaling-stroke"/>
    ${xl}
  </svg>`;
}

/** Horizontal stacked bar. parts: [{value, tone, label}] */
export function stackedBar(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return `<div class="stack" role="img" aria-label="${esc(parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', '))}">
    ${parts.map((p) => `<span class="stack-seg bg-${p.tone}" style="width:${(p.value / total) * 100}%"></span>`).join('')}
  </div>`;
}

/** Ring gauge for a percentage. */
export function ring(pct, { size = 112, stroke = 10, tone = 'blue', label = '', sub = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg" stroke-width="${stroke}" fill="none"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg stroke-${tone}" stroke-width="${stroke}" fill="none"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <div class="ring-text"><strong>${esc(label)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
  </div>`;
}

/** Vertical bars for per-day values. items: [{label, value}] */
export function barChart(items, { height = 150, unit = '' } = {}) {
  if (!items.length) return '';
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<div class="bars" style="height:${height}px">
    ${items.map((i) => `<div class="bar-col" title="${esc(i.label)}: ${Math.round(i.value)} ${esc(unit)}">
      <span class="bar-val">${Math.round(i.value)}</span>
      <span class="bar" style="height:${(i.value / max) * 100}%"></span>
      <span class="bar-label">${esc(i.label)}</span>
    </div>`).join('')}
  </div>`;
}
