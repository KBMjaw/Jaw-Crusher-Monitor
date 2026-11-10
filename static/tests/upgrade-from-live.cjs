/**
 * Upgrade test from the currently live build (commit given as argv[2],
 * default 9e66e12) to the working tree. Checks that open v1.1.x pages pick
 * up the new service worker without a forced reload, and that the next
 * normal reload shows the new version.
 *   node tests/upgrade-from-live.cjs [liveCommit]
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const ROOT = path.resolve(__dirname, '..');
const LIVE = process.argv[2] || '9e66e12';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-live-'));
const PORT = 8092; const BASE = `http://localhost:${PORT}`;
const results = [];
const check = (n, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? `  — ${info}` : ''}`); };

execSync(`git -C "${ROOT}" archive ${LIVE} | tar -x -C "${TMP}"`);
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: TMP, stdio: 'ignore' });
(async () => {
  for (let i = 0; i < 50; i++) { try { execSync(`curl -s ${BASE} >/dev/null`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await p.reload({ waitUntil: 'networkidle' });
  const before = await p.evaluate(async () => caches.keys());
  check(`Live build ${LIVE} installed`, before.some((k) => k.startsWith('cm-v1.1')), before.join());
  await p.evaluate(() => { window.__still = true; });
  // Deploy the new version over it.
  execSync(`cp -r "${ROOT}/." "${TMP}/" && rm -rf "${TMP}/.git"`);
  await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await p.waitForTimeout(4000);
  const after = await p.evaluate(async () => caches.keys());
  const NEW = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))[1];
  check('New service worker activated for old page', after.includes(NEW) && !after.some((k) => k.startsWith('cm-v1.1')), after.join());
  check('Old page was not force-reloaded', await p.evaluate(() => window.__still === true));
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  check('Next normal reload shows new version', await p.evaluate(() => !!document.querySelector('[data-skip]')));
  await b.close(); server.kill(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); server.kill(); process.exit(2); });
