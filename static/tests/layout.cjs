/**
 * Layout check: finds clipped / overflowing text and horizontal page scroll on
 * every screen at 11 widths (320–1920 px).
 *   node tests/layout.cjs [baseUrl]
 */
let pw;
try { pw = require('playwright'); } catch { pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium } = pw;
const WIDTHS = [320, 360, 390, 768, 900, 1024, 1100, 1180, 1280, 1440, 1920];
const PAGES = ['dashboard', 'machine', 'camera', 'alerts', 'analytics', 'analytics?tab=reports', 'analytics?tab=audit', 'profile', 'help'];
const BASE = process.argv[2] || 'http://localhost:8080'; const shots = ''; const doShots = false;
(async () => {
  const b = await chromium.launch(); let total = 0;
  for (const w of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('cm.session', JSON.stringify({ username: 'admin', sessionId: 't' })); } catch {} });
    const p = await ctx.newPage();
    await p.goto(BASE + '/#/dashboard', { waitUntil: 'networkidle' });
    for (const pg of PAGES) {
      await p.evaluate((h) => { location.hash = '#/' + h; }, pg); await p.waitForTimeout(700);
      const issues = await p.evaluate(() => {
        const out = [];
        const docOver = document.documentElement.scrollWidth - window.innerWidth;
        if (docOver > 1) out.push(`PAGE horizontal scroll +${docOver}px`);
        const boxes = '.card, .metric, .freq-cell, .list-row, .audit-card, .tab, .seg button, .status-card, .kv, .btn, .chip, .nav-link, .side-link, .topbar, .page-head';
        const boxSel = boxes;
        const walker = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          const el = n.parentElement;
          if (!n.textContent.trim() || !el.offsetParent || el.closest('.table-scroll, .tabs, svg, .sr-only')) continue;
          const range = document.createRange(); range.selectNodeContents(n);
          const tr = range.getBoundingClientRect(); if (!tr.width) continue;
          // nearest ancestor that visually bounds the text
          let anc = el; let why = '';
          while (anc && anc.id !== 'app') {
            const cs = getComputedStyle(anc);
            const ar = anc.getBoundingClientRect();
            const bounded = anc.matches(boxSel) || cs.overflow !== 'visible' || cs.overflowX !== 'visible';
            if (bounded) {
              const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
              if (tr.right > ar.right - (anc.matches('.card,.metric') ? pr - 2 : 0) + 1 || tr.left < ar.left - 1) why = `overflows ${anc.className.split(' ')[0] || anc.tagName}`;
              break;
            }
            anc = anc.parentElement;
          }
          if (why) out.push(`${why}: "${n.textContent.trim().slice(0, 30)}"`);
        }
        return [...new Set(out)];
      });
      if (issues.length) { total += issues.length; console.log(`\n[${w}px ${pg}]`); issues.slice(0, 12).forEach((i) => console.log('  ' + i)); }
      if (doShots && [1024, 1180].includes(w) && ['dashboard', 'machine', 'analytics', 'analytics?tab=audit'].includes(pg)) await p.screenshot({ path: `${shots}/r-${w}-${pg.replace(/\W/g, '_')}.png`, fullPage: true });
    }
    await ctx.close();
  }
  console.log('\nTOTAL ISSUES', total); await b.close(); process.exit(total ? 1 : 0);
})();
