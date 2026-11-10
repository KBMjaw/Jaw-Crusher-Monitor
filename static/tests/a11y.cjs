/**
 * Accessibility scan with axe-core (WCAG 2 A/AA + best practices) on every
 * screen and dialog, light + dark theme, phone + desktop width.
 *   npm pack axe-core && tar xzf axe-core-*.tgz   # anywhere
 *   node tests/a11y.cjs path/to/package/axe.min.js [baseUrl]
 */
let pw;
try { pw = require('playwright'); } catch { pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium } = pw;
const fs = require('fs');
const AXE = fs.readFileSync(process.argv[2], 'utf8');
const BASE = process.argv[3] || 'http://localhost:8080';
const PAGES = ['dashboard', 'machine', 'camera', 'alerts', 'analytics', 'analytics?tab=reports', 'analytics?tab=audit', 'profile', 'help'];
async function scan(p, label, agg) {
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'], resultTypes: ['violations'] })).violations
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + (n.any[0]?.message ? ' :: ' + n.any[0].message.slice(0, 110) : '')) })));
  for (const v of r) { const k = v.id; (agg[k] ||= { impact: v.impact, help: v.help, where: [] }).where.push(`${label}: ${v.nodes.join(' | ')}`); }
}
(async () => {
  const b = await chromium.launch(); const agg = {};
  for (const theme of ['light', 'dark']) {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const ctx = await b.newContext({ viewport: vp, colorScheme: theme });
      await ctx.addInitScript((t) => { localStorage.setItem('cm.settings', JSON.stringify({ theme: t })); }, theme);
      const p = await ctx.newPage();
      await p.goto(BASE + '/', { waitUntil: 'networkidle' });
      await scan(p, `${theme}/${vp.width}/login`, agg);
      await p.fill('input[name=username]', 'admin'); await p.fill('input[name=password]', '12345'); await p.click('button[type=submit]'); await p.waitForTimeout(1000);
      for (const pg of PAGES) {
        await p.evaluate((h) => { location.hash = '#/' + h; }, pg); await p.waitForTimeout(800);
        await scan(p, `${theme}/${vp.width}/${pg}`, agg);
      }
      // dialogs
      await p.evaluate(() => { location.hash = '#/profile?edit=freq'; }); await p.waitForTimeout(700);
      await scan(p, `${theme}/${vp.width}/freq-modal`, agg);
      await p.click('[data-unlock]'); await p.waitForTimeout(400);
      await scan(p, `${theme}/${vp.width}/pin-modal`, agg);
      await ctx.close();
    }
  }
  for (const [id, v] of Object.entries(agg)) {
    console.log(`\n### ${id} [${v.impact}] ${v.help}  (${v.where.length} screens)`);
    v.where.slice(0, 4).forEach((w) => console.log('   ' + w.slice(0, 400)));
  }
  console.log('\nRULES VIOLATED:', Object.keys(agg).length);
  await b.close();
  process.exit(Object.keys(agg).length ? 1 : 0);
})();
