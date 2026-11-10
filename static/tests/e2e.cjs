/**
 * End-to-end regression suite for the Crusher Monitor PWA.
 *
 *   python3 -m http.server 8080          # in the repo root
 *   node tests/e2e.cjs [baseUrl] [outDir]  # default http://localhost:8080
 *
 * Requires Playwright (global install is fine). Every check prints PASS/FAIL;
 * the process exits non-zero if any check fails.
 */
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch { pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); }
const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = process.argv[3] || path.join(require('os').tmpdir(), 'cm-e2e');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let a0;
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  — ${info}` : ''}`);
}
const wait = (p, ms = 400) => p.waitForTimeout(ms);
const go = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await wait(p, 650); };
const text = (p, sel) => p.textContent(sel).then((t) => (t || '').replace(/\s+/g, ' ').trim());
const auditTop = (p, n = 5) => p.evaluate((k) => JSON.parse(localStorage.getItem('cm.audit') || '[]').slice(0, k), n);

async function login(p, user = 'admin', pass = '12345', remember = false) {
  await p.fill('input[name=username]', user);
  await p.fill('input[name=password]', pass);
  if (remember) await p.check('input[name=remember]');
  await p.click('button[type=submit]');
  await wait(p, 900);
}

async function download(p, clickSel) {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click(clickSel)]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), size: fs.statSync(file).size, file };
}

(async () => {
  const browser = await pw.chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });

  /* ── Login ── */
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  check('Login screen shows Kannan logo lockup', await p.isVisible('.lockup') && (await text(p, '.lockup-text')).includes('Kannan'));
  check('Demo credentials not prefilled in password', (await p.inputValue('input[name=password]')) === '');
  await p.click('[data-pw]');
  check('Show/hide password toggles input type', (await p.getAttribute('input[name=password]', 'type')) === 'text');
  await p.click('[data-pw]');
  check('Fresh install: audit log empty before any action', await p.evaluate(() => !(JSON.parse(localStorage.getItem('cm.audit') || '[]').length)));
  await login(p, 'admin', 'wrong');
  check('Wrong password shows error', (await text(p, '.login-error')).includes('Incorrect username or password'));
  await login(p, 'admin', '12345');
  check('Correct login opens dashboard', await p.isVisible('[data-crusher]'));
  a0 = await p.evaluate(() => JSON.parse(localStorage.getItem('cm.audit') || '[]'));
  check('Audit holds only real actions (failed login + login)', a0.length === 2 && a0[0].action === 'LOGIN' && a0[1].action === 'LOGIN_FAILED');
  check('Audit records flagged unverified with simulated IP', a0.every((r) => r.verified === false && r.ipSimulated === true));

  /* ── Dashboard ── */
  await wait(p, 1200);
  check('Dashboard: crusher status card', /RUNNING|STOPPED|WARNING|FAULT/.test(await text(p, '[data-crusher]')));
  check('Dashboard: feeder AI card', /EMPTY|FULL|PARTIALLY FULL/.test(await text(p, '[data-feeder]')));
  check('Dashboard: VFD command card shows Hz + AI state', /VFD Command \d+ ?Hz/i.test(await text(p, '[data-vfd]')) && /AI state/i.test(await text(p, '[data-vfd]')));
  check('Dashboard: Today KPIs loaded', (await text(p, '[data-today]')).includes('OEE'));
  check('Dashboard: recent alerts listed', (await p.$$('[data-alerts] .alert-row')).length > 0);

  /* ── Machine: Empty-only manual control ── */
  await go(p, '#/machine');
  await p.click('details.demo summary');
  await p.uncheck('[data-demo-cycle]');
  for (const st of ['FULL', 'PARTIAL']) {
    await p.click(`[data-demo-ai] button[data-v=${st}]`); await wait(p);
    check(`Machine ${st}: MANUAL button disabled`, await p.isDisabled('[data-mode=MANUAL]'));
    check(`Machine ${st}: manual speed controls hidden`, await p.isHidden('[data-manual]'));
    check(`Machine ${st}: lock message shown`, (await text(p, '[data-lock]')).includes('Manual control unavailable'));
    check(`Machine ${st}: AI state still shown`, (await text(p, '[data-ai]')).includes(st === 'FULL' ? 'FULL' : 'PARTIALLY FULL'));
  }
  await p.click('[data-demo-ai] button[data-v=EMPTY]'); await wait(p);
  check('Machine EMPTY: MANUAL enabled', !(await p.isDisabled('[data-mode=MANUAL]')));
  check('Machine EMPTY: AUTO command = Empty frequency 43 Hz', (await text(p, '[data-vfdp] .state-word')).startsWith('43'));
  await p.click('[data-mode=MANUAL]'); await wait(p, 700);
  check('Switching to MANUAL needs no PIN', !(await p.isVisible('.pin-input')));
  check('MANUAL: command = manual setpoint 47 Hz', (await text(p, '[data-vfdp] .state-word')).startsWith('47'));
  check('MANUAL: AI detection still EMPTY', (await text(p, '[data-ai] .state-word')) === 'EMPTY');
  await p.click('[data-step="1"]'); await p.click('[data-apply]'); await wait(p);
  check('Apply new speed asks for PIN', await p.isVisible('.pin-input'));
  check('PIN not shown in page', !(await p.evaluate(() => document.body.innerText.includes('0000'))));
  await p.fill('.pin-input', '1111'); await p.click('[data-verify]'); await wait(p, 600);
  check('Wrong PIN message', (await text(p, '[data-err="pin"]')) === 'Incorrect PIN. Please try again.');
  check('Wrong PIN leaves speed unchanged', (await text(p, '[data-vfdp] .state-word')).startsWith('47'));
  await p.fill('.pin-input', '0000'); await p.click('[data-verify]'); await wait(p, 900);
  check('Correct PIN applies 48 Hz', (await text(p, '[data-vfdp] .state-word')).startsWith('48'));
  await p.click('[data-step="1"]'); await p.click('[data-step="1"]'); await p.click('[data-apply]'); await wait(p, 900);
  check('Within 5 min, next change needs no PIN (50 Hz)', !(await p.isVisible('.pin-input')) && (await text(p, '[data-vfdp] .state-word')).startsWith('50'));
  check('At maximum: + disabled and MAXIMUM shown', await p.isDisabled('[data-step="1"]') && (await text(p, '[data-vfdp]')).includes('Maximum'));
  let a = await auditTop(p, 6);
  check('Audit: speed changes recorded with prev/new', a.some((r) => r.action === 'EMPTY_SPEED_CHANGED' && r.prev === '48 Hz' && r.next === '50 Hz'));
  check('Audit: manual override enabled recorded', a.some((r) => r.action === 'MANUAL_OVERRIDE_ENABLED'));
  check('Audit: wrong PIN recorded', a.some((r) => r.action === 'PIN_FAILED'));
  await p.click('[data-demo-ai] button[data-v=PARTIAL]'); await wait(p, 1500);
  check('Feeder leaves EMPTY → back to AUTO 37 Hz', (await text(p, '[data-modechip]')) === 'Auto' && (await text(p, '[data-vfdp] .state-word')).startsWith('37'));
  a = await auditTop(p, 3);
  check('Audit: automatic return to AUTO recorded as system with correct values', a.some((r) => r.action === 'MANUAL_OVERRIDE_DISABLED' && r.username === 'system' && r.prev === 'MANUAL · 50 Hz' && r.next === 'AUTO · 37 Hz'));
  // Feeder leaves EMPTY while the PIN dialog is open → speed must not change.
  await p.click('[data-demo-ai] button[data-v=EMPTY]'); await wait(p);
  await p.click('[data-mode=MANUAL]'); await wait(p, 600);
  await p.evaluate(() => sessionStorage.setItem('cm.pinOkUntil', JSON.stringify(0)));
  await p.click('[data-step="-1"]'); await p.click('[data-apply]'); await wait(p);
  await p.evaluate(() => { location.hash = location.hash; });
  await p.evaluate(() => document.querySelector('[data-demo-ai] button[data-v=FULL]').click()); await wait(p, 600);
  await p.fill('.pin-input', '0000'); await p.click('[data-verify]'); await wait(p, 900);
  check('Feeder left EMPTY during PIN entry → speed not applied', (await p.evaluate(() => JSON.parse(localStorage.getItem('cm.audit'))[0].action)) !== 'EMPTY_SPEED_CHANGED' && (await text(p, '[data-vfdp] .state-word')).startsWith('30'));
  await p.click('[data-demo-ai] button[data-v=PARTIAL]'); await wait(p);
  await p.click('[data-demo-crusher] button[data-v=STOPPED]'); await wait(p);
  check('Interlock: crusher stopped → command 0 Hz', (await text(p, '[data-vfdp] .state-word')).startsWith('0'));
  // Interlock: auto-return audit records the real command (0 Hz while crusher stopped)
  await p.click('[data-demo-ai] button[data-v=EMPTY]'); await wait(p);
  await p.click('[data-mode=MANUAL]'); await wait(p, 600);
  await p.click('[data-demo-ai] button[data-v=FULL]'); await wait(p, 600);
  check('Audit: auto-return during interlock records AUTO · 0 Hz', (await auditTop(p, 3)).some((r) => r.username === 'system' && r.next === 'AUTO · 0 Hz'));
  await p.click('[data-demo-crusher] button[data-v=RUNNING]'); await wait(p);
  await p.click('[data-demo-ai] button[data-v=PARTIAL]'); await wait(p);

  /* ── Shared PIN window ── */
  await go(p, '#/profile?edit=freq');
  check('PIN from Machine screen also unlocks Freq settings (shared 5 min)', !(await p.$eval('input[name=freqEmpty]', (i) => i.readOnly)));
  await p.keyboard.press('Escape'); await wait(p);
  await p.evaluate(() => sessionStorage.setItem('cm.pinOkUntil', JSON.stringify(Date.now() - 1000)));

  /* ── Profile: PIN-protected frequency settings ── */
  await go(p, '#/profile?edit=freq');
  check('After 5 min expiry: Empty fields locked again', await p.$eval('input[name=freqEmpty]', (i) => i.readOnly) && await p.$eval('input[name=manualMax]', (i) => i.readOnly));
  await p.fill('input[name=freqFull]', '31');
  await p.click('.modal [data-save]'); await wait(p);
  check('Full frequency saves without PIN', await p.evaluate(() => JSON.parse(localStorage.getItem('cm.settings')).freqFull === 31));
  await go(p, '#/profile?edit=freq');
  await p.click('[data-unlock]'); await wait(p);
  check('Unlock asks for PIN', (await text(p, '.pin-head p')).includes('Empty feeder speed'));
  await p.fill('.pin-input', '0000'); await p.click('[data-verify]'); await wait(p, 600);
  check('Correct PIN unlocks Empty fields', !(await p.$eval('input[name=freqEmpty]', (i) => i.readOnly)));
  await p.fill('input[name=freqPartial]', ''); await p.click('.modal [data-save]'); await wait(p);
  check('Validation: blank frequency rejected (not saved as 0 Hz)', (await text(p, '[data-err="freqPartial"]')) === 'Enter a number');
  await p.fill('input[name=freqPartial]', '37');
  await p.fill('input[name=manualMin]', '48'); await p.fill('input[name=manualMax]', '45');
  await p.click('.modal [data-save]'); await wait(p);
  check('Validation: min ≥ max rejected', (await text(p, '[data-err="manualMax"]')).includes('greater'));
  await p.fill('input[name=freqEmpty]', '44'); await p.fill('input[name=manualMin]', '42'); await p.fill('input[name=manualMax]', '48');
  await p.click('.modal [data-save]'); await wait(p);
  const s1 = await p.evaluate(() => JSON.parse(localStorage.getItem('cm.settings')));
  check('Empty 44 Hz, range 42–48 Hz saved', s1.freqEmpty === 44 && s1.manualMin === 42 && s1.manualMax === 48);
  a = await auditTop(p, 5);
  check('Audit: Empty frequency 43→44 Hz', a.some((r) => r.action === 'FREQUENCY_SETTING_CHANGED' && r.prev === '43 Hz' && r.next === '44 Hz'));
  check('Audit: range 40–50 → 42–48 Hz', a.some((r) => r.action === 'MANUAL_RANGE_CHANGED' && r.prev === '40–50 Hz' && r.next === '42–48 Hz'));
  await go(p, '#/machine'); await p.click('details.demo summary');
  await p.click('[data-demo-ai] button[data-v=EMPTY]'); await wait(p);
  check('New Empty auto frequency used (44 Hz)', (await text(p, '[data-vfdp] .state-word')).startsWith('44'));
  check('Slider uses new range 42–48', (await p.getAttribute('[data-range]', 'min')) === '42' && (await p.getAttribute('[data-range]', 'max')) === '48');

  /* ── Profile edits, logo, password, theme ── */
  await go(p, '#/profile');
  await p.click('[data-act=profile]'); await wait(p);
  await p.fill('input[name=profileName]', 'Plant Admin');
  await p.click('.modal [data-save]'); await wait(p);
  check('Profile name updated', (await text(p, '.profile-name')) === 'Plant Admin');
  await p.click('[data-act=company] >> nth=0'); await wait(p);
  const png = path.join(OUT, 'logo-test.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64'));
  await p.setInputFiles('.modal input[type=file]', png); await wait(p, 600);
  await p.fill('input[name=plantName]', 'Chennimalai Plant 2');
  await p.click('.modal [data-save]'); await wait(p, 800);
  check('Company logo uploaded and used in header/profile', await p.evaluate(() => !!document.querySelector('.logo-box img[src^="data:image/png"]')));
  check('Plant name updated', (await text(p, '#view')).includes('Chennimalai Plant 2'));
  a = await auditTop(p, 6);
  check('Audit: logo + plant + profile changes recorded', ['COMPANY_LOGO_CHANGED', 'COMPANY_DETAILS_UPDATED', 'PROFILE_UPDATED'].every((k) => a.some((r) => r.action === k)));
  await p.click('[data-act=password]'); await wait(p);
  await p.fill('input[name=current]', '12345'); await p.fill('input[name=next]', 'abcde'); await p.fill('input[name=confirm]', 'abcdx');
  await p.click('.modal [data-save]'); await wait(p);
  check('Password mismatch error', (await text(p, '[data-err="confirm"]')).includes('do not match'));
  await p.fill('input[name=confirm]', 'abcde'); await p.click('.modal [data-save]'); await wait(p);
  check('Password changed', (await auditTop(p, 1))[0].action === 'PASSWORD_CHANGED');
  await p.click('[data-t=dark]'); await wait(p);
  check('Dark theme applies', (await p.getAttribute('html', 'data-theme')) === 'dark');
  await p.click('[data-t=light]'); await wait(p);

  /* ── Alerts ── */
  await go(p, '#/alerts');
  const all = (await p.$$('[data-list] .alert-row')).length;
  await p.click('[data-f=info]'); await wait(p, 300);
  const info = await p.$$eval('[data-list] .alert-row .chip', (c) => c.map((x) => x.textContent.trim()));
  check('Alerts list + Info filter', all > 0 && info.length > 0 && info.every((t) => t === 'Info'));
  await p.click('[data-readall]'); await wait(p, 300);
  check('Mark all read clears badge', await p.evaluate(() => [...document.querySelectorAll('[data-alert-badge]')].every((b) => b.hidden)));
  const beforeReload = await p.evaluate(() => JSON.parse(localStorage.getItem('cm.alerts')).map((x) => x.id + x.read).join());
  await p.reload({ waitUntil: 'networkidle' }); await wait(p, 900); await go(p, '#/alerts');
  const afterReload = await p.evaluate(() => JSON.parse(localStorage.getItem('cm.alerts')).map((x) => x.id + x.read).join());
  check('Alerts + read status survive reload', afterReload.startsWith(beforeReload.slice(0, 200)) && (await p.$$('[data-list] .unread-dot')).length === 0 && (await p.$$('[data-list] .alert-row')).length >= all);

  /* ── Camera / Help ── */
  await go(p, '#/camera');
  await p.click('[data-cam=cam2]'); await wait(p, 300);
  check('Camera switch to Camera 02', (await text(p, '[data-cam-name]')).includes('Camera 02'));
  await go(p, '#/help');
  const hrefs = await p.$$eval('.support-btn', (l) => l.map((x) => x.getAttribute('href')));
  check('Help: WhatsApp / Call / Email links', hrefs[0].startsWith('https://wa.me/918883921424') && hrefs[1] === 'tel:+918883921424' && hrefs[2].startsWith('mailto:'));

  /* ── Analytics periods ── */
  await go(p, '#/analytics');
  for (const per of ['today', 'yesterday', 'daily', 'weekly']) {
    await p.selectOption('[data-period]', per); await wait(p, 700);
    check(`Analytics period: ${per}`, (await text(p, '[data-body]')).includes('Production & Operation') || (await text(p, '[data-body]')).includes('No operating data'));
  }
  await p.selectOption('[data-period]', 'range'); await wait(p, 300);
  await p.fill('[data-r1]', '2026-01-01'); await p.dispatchEvent('[data-r1]', 'change'); await wait(p, 400);
  check('Custom range > 31 days rejected', (await text(p, '[data-range-err]')).includes('31'));
  await p.selectOption('[data-period]', 'weekly'); await wait(p, 700);

  /* ── Reports: 3 types × 3 formats ── */
  await p.click('[data-tab=reports]'); await wait(p, 900);
  for (const type of ['operational', 'audit', 'complete']) {
    for (const fmt of ['pdf', 'excel', 'csv']) {
      await p.check(`input[name=rtype-inline][value=${type}]`);
      await p.check(`input[name=fmt-inline][value=${fmt}]`);
      const d = await download(p, '[data-build]');
      check(`Report ${type} / ${fmt}`, d.size > 500, `${d.name} ${d.size} B`);
      if (fmt === 'csv') {
        const csv = fs.readFileSync(d.file, 'utf8');
        check(`  ${type} CSV content`, type === 'operational' ? csv.includes('OEE') && !csv.includes('AUDIT LOG') : csv.includes('AUDIT LOG') && csv.includes('IP Address') && csv.includes('(simulated)') && csv.includes('Unverified'));
      }
      await wait(p, 300);
    }
  }

  /* ── Audit Log tab ── */
  await p.click('[data-tab=audit]'); await wait(p, 800);
  const total = await text(p, '[data-count]');
  await p.selectOption('[data-f=action]', 'LOGIN'); await wait(p, 300);
  const loginCards = await p.$$eval('.audit-card .chip', (c) => c.map((x) => x.textContent.trim()));
  check('Audit filter: action', loginCards.length > 0 && loginCards.every((t) => t === 'Successful Login'), total);
  await p.click('[data-clear]'); await wait(p, 300);
  await p.selectOption('[data-f=user]', 'system'); await wait(p, 300);
  check('Audit filter: user', (await p.$$eval('.audit-card-meta', (c) => c.every((x) => x.textContent.includes('system')))));
  await p.click('[data-clear]'); await p.fill('[data-f=ip]', '192.168.1'); await wait(p, 300);
  check('Audit filter: IP', (await p.$$eval('.audit-card-meta', (c) => c.length > 0 && c.every((x) => x.textContent.includes('192.168.1')))));
  check('Simulated IP clearly marked', (await p.$$eval('.audit-card .tag-sim', (c) => c.length)) > 0);
  await p.click('[data-clear]'); await wait(p, 200);
  const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await p.fill('[data-f=from]', iso); await wait(p, 300);
  const todayCount = await text(p, '[data-count]');
  const y = new Date(Date.now() - 86400000); const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  await p.fill('[data-f=from]', ''); await p.fill('[data-f=to]', yIso); await wait(p, 300);
  check('Audit filter: date (today has records, nothing before today)', todayCount === total && (await text(p, '[data-list]')).includes('No audit records match'));
  await p.click('[data-clear]'); await wait(p, 200);
  await p.click('[data-export]'); await wait(p, 300);
  const ad = await download(p, '.modal [data-dl]');
  check('Audit Log export (filtered)', ad.size > 500, ad.name);

  /* ── Logout + remember me ── */
  await go(p, '#/profile');
  await p.click('[data-act=logout]'); await wait(p, 300);
  check('Logout asks for confirmation', (await text(p, '.confirm-msg')) === 'Are you sure you want to logout?');
  for (let i = 0; i < 6; i++) await p.keyboard.press('Tab');
  check('Keyboard focus stays inside dialog', await p.evaluate(() => !!document.activeElement.closest('.modal')));
  await p.keyboard.press('Escape'); await wait(p, 300);
  check('Escape closes dialog and returns focus', !(await p.isVisible('.modal')) && await p.evaluate(() => document.activeElement.matches('[data-act=logout]')));
  await p.click('[data-act=logout]'); await wait(p, 300);
  await p.click('.modal [data-act=cancel]'); await wait(p, 300);
  check('Cancel keeps user logged in', await p.isVisible('#view'));
  await p.click('[data-act=logout]'); await wait(p, 300);
  await p.click('.modal [data-act=ok]'); await wait(p, 600);
  check('Logout returns to login', await p.isVisible('.login-card'));
  check('Audit: logout recorded', (await auditTop(p, 1))[0].action === 'LOGOUT');
  await login(p, '=HYPERLINK("http://x","y")', 'x');
  await login(p, "-2+3+cmd|'/C calc'!A0", 'x');
  await login(p, 'admin', '12345');
  check('Old password rejected after change', await p.isVisible('.login-error'));
  await login(p, 'admin', 'abcde', true);
  check('New password works', await p.isVisible('#view'));
  await p.reload({ waitUntil: 'networkidle' }); await wait(p, 800);
  check('Remember me keeps session after reload', await p.isVisible('#view'));
  await go(p, '#/analytics?tab=audit');
  await p.selectOption('[data-f=action]', 'LOGIN_FAILED'); await wait(p, 300);
  await p.click('[data-export]'); await wait(p, 300);
  await p.check('.modal input[name=fmt][value=csv]');
  const inj = await download(p, '.modal [data-dl]');
  const injCsv = fs.readFileSync(inj.file, 'utf8');
  check('CSV export neutralises formulas (injection)', injCsv.includes(`"'=HYPERLINK`) && injCsv.includes(`,'-2+3+cmd`) && !/,(=|-2\+3)/.test(injCsv));

  /* ── Old PIN failures expire ── */
  await p.evaluate(() => localStorage.setItem('cm.pinFails', JSON.stringify({ n: 4, at: Date.now() - 11 * 60000 })));
  await p.evaluate(() => sessionStorage.removeItem('cm.pinOkUntil'));
  await go(p, '#/profile?edit=freq');
  await p.click('[data-unlock]'); await wait(p);
  await p.fill('.pin-input', '9999'); await p.click('[data-verify]'); await wait(p, 500);
  check('Wrong PINs older than 10 min do not count towards lockout', (await text(p, '[data-err="pin"]')) === 'Incorrect PIN. Please try again.');
  await p.keyboard.press('Escape'); await wait(p, 300); await p.keyboard.press('Escape'); await wait(p, 300);
  await p.evaluate(() => localStorage.removeItem('cm.pinFails'));

  /* ── Keyboard: focus moves to new page content ── */
  await go(p, '#/dashboard'); await wait(p, 600);
  await p.focus('[data-alerts] ~ * , .card-link[href="#/alerts"]').catch(() => {});
  await p.evaluate(() => document.querySelector('.card-link[href="#/alerts"]').focus());
  await p.keyboard.press('Enter'); await wait(p, 700);
  check('Keyboard navigation from a link in the page focuses the new page', await p.evaluate(() => document.activeElement.id === 'view' && location.hash === '#/alerts'));

  /* ── PIN lockout is shared by all tabs ── */
  await p.evaluate(() => sessionStorage.removeItem('cm.pinOkUntil'));
  await go(p, '#/profile?edit=freq');
  await p.click('[data-unlock]'); await wait(p);
  for (let i = 0; i < 5; i++) { await p.fill('.pin-input', '9999'); await p.click('[data-verify]'); await wait(p, 450); }
  check('5 wrong PINs → locked', (await text(p, '[data-err="pin"]')).includes('locked'));
  const p2 = await ctx.newPage(); await p2.goto(BASE + '/#/profile?edit=freq', { waitUntil: 'networkidle' }); await wait(p2, 900);
  await p2.click('[data-unlock]'); await wait(p2);
  await p2.fill('.pin-input', '0000'); await p2.click('[data-verify]'); await wait(p2, 500);
  check('Lockout also applies in a new tab', (await text(p2, '[data-err="pin"]')).includes('Too many attempts'));
  await p2.close();
  await p.evaluate(() => localStorage.removeItem('cm.pinLockUntil'));

  /* ── PWA ── */
  const man = await p.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  check('Manifest: standalone + icons', man.display === 'standalone' && man.icons.length >= 3 && man.icons.some((i) => i.purpose === 'maskable'));
  const iconsOk = await p.evaluate(async (list) => (await Promise.all(list.map((i) => fetch(i.src).then((r) => r.ok && r.headers.get('content-type').includes('png'))))).every(Boolean), man.icons);
  check('Manifest icons load', iconsOk);
  const swOk = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  check('Service worker active', swOk);
  await p.reload({ waitUntil: 'networkidle' }); await wait(p, 800);
  await ctx.setOffline(true);
  await p.reload().catch(() => {}); await wait(p, 1500);
  check('Works offline (app shell from cache)', await p.isVisible('#view .card'));
  await ctx.setOffline(false);

  check('No JavaScript errors during run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
