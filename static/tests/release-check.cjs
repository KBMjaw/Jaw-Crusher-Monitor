/**
 * Release guard (no browser needed):  node tests/release-check.cjs [liveTag]
 *  - sw.js VERSION matches APP.version in js/config.js
 *  - every app file (js, css, icons, assets) is precached in sw.js SHELL
 *  - VERSION differs from the live build (git commit, default 9e66e12 = live v1.1.1),
 *    otherwise installed apps would never receive the update
 */
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const LIVE = process.argv[2] || '9e66e12'; // live production build (v1.1.1)
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const cfg = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
const results = [];
const check = (n, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? `  — ${info}` : ''}`); };

const swVersion = /const VERSION = '([^']+)'/.exec(sw)[1];
const appVersion = /version: '([^']+)'/.exec(cfg)[1];
check('sw.js VERSION matches APP.version', swVersion === `cm-v${appVersion}`, `${swVersion} / ${appVersion}`);

const shell = [...sw.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [`/${path.join(d, e.name)}`]));
const appFiles = ['js', 'css', 'icons', 'assets'].flatMap(walk).filter((f) => !f.endsWith('.map'));
const missing = appFiles.filter((f) => !shell.includes(f));
check('All app files precached for offline use', missing.length === 0, missing.join(', '));
const stale = shell.filter((f) => f !== '/' && !f.startsWith('/api') && !f.startsWith('/ws') && !f.startsWith('/#') && !fs.existsSync(path.join(ROOT, f)));
check('No precache entries for missing files', stale.length === 0, stale.join(', '));

let liveVersion = '';
try { liveVersion = /const VERSION = '([^']+)'/.exec(execSync(`git -C "${ROOT}" show ${LIVE}:sw.js`).toString())[1]; } catch { /* tag missing */ }
check(`Version bumped vs live build (${LIVE})`, liveVersion && liveVersion !== swVersion, `live ${liveVersion || '?'} → ${swVersion}`);
process.exit(results.every(Boolean) ? 0 : 1);
