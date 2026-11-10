/**
 * Placeholder camera scene: a top-down view of the feeder pan with stone
 * load matching the AI state. Used until the RTSP stream is relayed by the
 * backend (browsers cannot play RTSP directly).
 */

const FILL = { EMPTY: 0.12, PARTIAL: 0.5, FULL: 0.92 };

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = {};

export function feederScene(aiState = 'EMPTY', { box = true, conf = null, cam = 1 } = {}) {
  const key = `${aiState}-${box}-${conf}-${cam}`;
  if (cache[key]) return cache[key];
  const W = 640; const H = 360;
  const r = rng(cam * 97 + 13);
  const fill = FILL[aiState] ?? 0.3;

  // pan interior (perspective trapezoid)
  const pan = { x1: 120, x2: 520, top: 40, bottom: 330, inset: 70 };
  let rocks = '';
  const count = Math.round(40 + fill * 420);
  const tones = ['#8d8f93', '#a3a5a8', '#76797e', '#b8b9bb', '#696c71', '#9a9590'];
  const yMin = pan.bottom - (pan.bottom - pan.top) * Math.max(0.18, fill);
  for (let i = 0; i < count; i++) {
    const y = yMin + r() * (pan.bottom - yMin - 10);
    const p = (y - pan.top) / (pan.bottom - pan.top);
    const left = pan.x1 + pan.inset * (1 - p) + 8;
    const right = pan.x2 - pan.inset * (1 - p) - 8;
    const x = left + r() * (right - left);
    const s = 5 + r() * 12 * (0.6 + p * 0.6);
    const rx = s * (0.8 + r() * 0.5); const ry = s * (0.6 + r() * 0.35);
    const c = tones[Math.floor(r() * tones.length)];
    rocks += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${c}" stroke="rgba(0,0,0,.35)" stroke-width="1" transform="rotate(${Math.round(r() * 180)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  const label = { EMPTY: 'EMPTY', PARTIAL: 'PARTIALLY FULL', FULL: 'FULL' }[aiState];
  const color = { EMPTY: '#f59e0b', PARTIAL: '#3b76ef', FULL: '#22a352' }[aiState];
  const bx = { x: pan.x1 + 50, y: yMin - 14, w: pan.x2 - pan.x1 - 100, h: pan.bottom - yMin + 2 };
  const boxSvg = box ? `
    <rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" fill="none" stroke="${color}" stroke-width="3" rx="4"/>
    <rect x="${bx.x}" y="${bx.y - 24}" width="${label.length * 9 + (conf != null ? 46 : 14)}" height="24" fill="${color}" rx="3"/>
    <text x="${bx.x + 7}" y="${bx.y - 7}" font-family="Inter,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff">${label}${conf != null ? ` ${conf}%` : ''}</text>` : '';

  const svg = `<svg class="scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Demo camera view, feeder ${label.toLowerCase()}">
    <defs>
      <linearGradient id="g-floor-${cam}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3f45"/><stop offset="1" stop-color="#25282d"/></linearGradient>
      <linearGradient id="g-pan-${cam}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4e55"/><stop offset="1" stop-color="#33363b"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g-floor-${cam})"/>
    <polygon points="${pan.x1 - 40},${pan.bottom + 20} ${pan.x1 + pan.inset - 30},${pan.top - 20} ${pan.x2 - pan.inset + 30},${pan.top - 20} ${pan.x2 + 40},${pan.bottom + 20}" fill="#5a4a2a"/>
    <polygon points="${pan.x1},${pan.bottom} ${pan.x1 + pan.inset},${pan.top} ${pan.x2 - pan.inset},${pan.top} ${pan.x2},${pan.bottom}" fill="url(#g-pan-${cam})" stroke="#1f2124" stroke-width="3"/>
    ${Array.from({ length: 7 }, (_, i) => { const y = pan.top + ((pan.bottom - pan.top) / 7) * (i + 0.5); return `<line x1="${pan.x1 + 20}" x2="${pan.x2 - 20}" y1="${y}" y2="${y}" stroke="rgba(0,0,0,.25)" stroke-width="2"/>`; }).join('')}
    ${rocks}
    ${boxSvg}
    <rect width="${W}" height="${H}" fill="rgba(10,14,22,.12)"/>
  </svg>`;
  cache[key] = svg;
  return svg;
}
