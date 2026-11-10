/**
 * Rollback test: an installed app on the current version must return to the
 * live v1.1.1 build (git commit given as argv[2], default 9e66e12) after the
 * server is rolled back.   node tests/rollback.cjs [liveCommit]
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const ROOT = path.resolve(__dirname, '..'); const LIVE = process.argv[2] || '9e66e12';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-rb-'));
const CUR = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))[1];
const results = [];
const PORT = 8094, BASE = `http://localhost:${PORT}`;
const check = (n, ok, i = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`); };
execSync(`cp -r "${ROOT}/." "${TMP}/" && rm -rf "${TMP}/.git"`);
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: TMP, stdio: 'ignore' });
(async () => {
  for (let i = 0; i < 50; i++) { try { execSync(`curl -s ${BASE} >/dev/null`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const b = await pw.chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.evaluate(async () => { await navigator.serviceWorker.ready; }); await p.reload({ waitUntil: 'networkidle' });
  check(`${CUR} installed`, (await p.evaluate(() => caches.keys())).includes(CUR));
  // Roll the server back to the live v1.1.1 files (what a rollback serves).
  // Fresh mtimes mimic Vercel, which detects changes by content (ETag).
  execSync(`rm -rf "${TMP}"/* && git -C "${ROOT}" archive ${LIVE} | tar -x -C "${TMP}" && find "${TMP}" -type f -exec touch {} +`);
  await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await p.waitForTimeout(4000);
  const keys = await p.evaluate(() => caches.keys());
  const banner = await p.isVisible('.update-banner');
  check('Rolled-back worker detected', keys.some((k) => k.startsWith('cm-v1.1')) , `caches=${keys.join()} banner=${banner}`);
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  let isOld = await p.evaluate(() => !document.querySelector('[data-skip]'));
  check('After 1 reload: v1.1.1 shown', isOld);
  if (!isOld) { await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200); isOld = await p.evaluate(() => !document.querySelector('[data-skip]')); check('After 2nd reload: v1.1.1 shown', isOld); }
  await b.close(); srv.kill(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); srv.kill(); process.exit(2); });
