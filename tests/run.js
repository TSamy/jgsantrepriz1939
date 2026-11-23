#!/usr/bin/env node
/* =========================================================
   JGS Antrepriz 1939 — end-to-end checks (not deployed)
   Usage:  node tests/run.js [--only=deploy,contacts,fab,poster,video,nav,a11y,contrast]
   Needs:  Playwright + axe-core reachable by Node (see tests/README.md),
           python3 (static server), ffmpeg (poster test card).
   Test phone numbers and the poster test card are injected with request
   interception only. Nothing is written into the site.
   No fixed sleeps: every step waits for an observable state.
   ========================================================= */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const { spawn, execFileSync } = require('child_process');

const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const AXE = fs.readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8790);
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'jgs-shots-'));
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = k => !ONLY.length || ONLY.includes(k);

const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

/* ---------- Test data (never deployed) ---------- */
const MSG = 'Hello JGS Antrepriz 1939, I would like to inquire about your glass eel products.';
const MSG_ENC = encodeURIComponent(MSG);
const T_HT = { phone: '+509 0000 0001', digits: '50900000001' };   // test-only
const T_US = { phone: '+1 202 555 0123', digits: '12025550123' };  // 555-01xx: reserved fictional range
const realConfig = fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8');
function configWith({ ht = '', us = '', htWa = true, usWa = true, poster = '' } = {}) {
  const sandbox = { window: {} }; vm.runInNewContext(realConfig, sandbox);
  const c = JSON.parse(JSON.stringify(sandbox.window.JGS_CONFIG));
  c.contacts[0].phone = ht; c.contacts[0].whatsapp = htWa;
  c.contacts[1].phone = us; c.contacts[1].whatsapp = usWa;
  c.heroPoster = poster;
  return 'window.JGS_CONFIG = ' + JSON.stringify(c) + ';';
}
const POSTER_PATH = 'assets/video/civelles-poster.jpg';
function makeTestCard() { // synthetic test card: red circle (r=120) on dark blue, 1280x720
  const f = path.join(OUT, 'test-card.jpg');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x10324a:s=1280x720', '-frames:v', '1',
    '-vf', "geq=r='if(lte(hypot(X-640,Y-360),120),255,16)':g='if(lte(hypot(X-640,Y-360),120),0,50)':b='if(lte(hypot(X-640,Y-360),120),0,74)'", f]);
  return fs.readFileSync(f);
}

/* ---------- Helpers ---------- */
async function newPage(browser, ctxOpts = {}, { config, poster, connection } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.route('https://wa.me/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa stub</title>' }));
  if (config) await ctx.route('**/assets/js/config.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: config }));
  if (poster) await ctx.route('**/' + POSTER_PATH, r => r.fulfill({ status: 200, contentType: 'image/jpeg', body: poster }));
  const page = await ctx.newPage();
  if (connection) await page.addInitScript(c => Object.defineProperty(navigator, 'connection', { value: c, configurable: true }), connection);
  const log = { req: [], bad: [], errs: [], popups: [] };
  page.on('request', r => log.req.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) log.bad.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', e => log.errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') log.errs.push(m.text()); });
  page.on('popup', p => log.popups.push(p));
  return { ctx, page, log };
}
const mp4s = log => [...new Set(log.req.filter(u => u.endsWith('.mp4')).map(u => u.split('/').pop()))];
const waitTransitionDone = (page, sel) => page.waitForFunction(s => {
  const el = document.querySelector(s); return el && el.getAnimations({ subtree: false }).every(a => a.playState !== 'running');
}, sel);
const scrollInstant = (page, y) => page.evaluate(y => {
  document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, y === 'end' ? document.body.scrollHeight : y);
}, y);
const waitScrollSettled = page => page.waitForFunction(() => new Promise(res => {
  let last = -1, same = 0; (function tick() { const y = window.scrollY; same = y === last ? same + 1 : 0; last = y;
    if (same >= 3) res(true); else requestAnimationFrame(tick); })(); }));
// Waits until the hero video is really playing; on timeout returns a diagnostic instead of throwing
async function waitPlaying(page, minTime = 0.3, timeout = 30000) {
  try { await page.waitForFunction(t => { const v = document.querySelector('[data-hero-video]'); return v && !v.paused && v.currentTime > t; }, minTime, { timeout }); return null; }
  catch { return JSON.stringify(await page.evaluate(() => { const v = document.querySelector('[data-hero-video]'); const b = document.querySelector('[data-video-toggle]');
    return v ? { paused: v.paused, t: +v.currentTime.toFixed(2), readyState: v.readyState, networkState: v.networkState, src: v.currentSrc.split('/').pop(),
      button: b.hidden ? 'hidden' : b.getAttribute('aria-pressed'), visibility: document.visibilityState } : 'video removed'; })); }
}
async function axeRun(page, tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('is-visible')));
  await page.waitForFunction(() => [...document.querySelectorAll('.reveal')].every(e => getComputedStyle(e).opacity === '1'));
  const r = await page.evaluate(t => axe.run(document, { runOnly: t }), tags);
  return r.violations.map(v => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(', ')}`);
}
const VIEWPORTS = [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['tablet', { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ['small', { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }],
];
const ctxFor = (bn, opts) => bn === 'firefox' ? { ...opts, isMobile: undefined } : opts; // Firefox has no isMobile

/* ---------- 1. Deployable files: no fictitious numbers or links ---------- */
function deployScan() {
  const ignore = fs.readFileSync(path.join(ROOT, '.deployignore'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const isIgnored = rel => ignore.some(p => p.endsWith('/') ? rel.startsWith(p) : rel === p);
  const files = [];
  (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name); const rel = path.relative(ROOT, abs) + (e.isDirectory() ? '/' : '');
    if (isIgnored(rel)) continue; if (e.isDirectory()) walk(abs); else files.push(rel); } })(ROOT);
  const text = files.filter(f => /\.(html|css|js|json|txt|xml|svg|md|webmanifest)$/.test(f));
  const REAL = ['+509 37 63 2416', '+1 (954) 706-2649']; // validated company numbers (config.js only)
  const patterns = [
    ['placeholder X digits', /X{3,}/],
    ['Haitian-looking number', /\+?509[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/],
    ['US-looking number', /\+1[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/],
    ['hard-coded tel: link', /tel:\+?\d/],
    ['hard-coded wa.me link', /wa\.me\/\d/],
    ['test numbers leaked', new RegExp(`${T_HT.digits}|${T_US.digits}|555[\\s.-]?0123`)],
  ];
  const hits = [];
  for (const f of text) { let s = fs.readFileSync(path.join(ROOT, f), 'utf8'); if (f === 'assets/js/config.js') REAL.forEach(n => { s = s.split(n).join(''); });
    for (const [name, re] of patterns) { const m = s.match(re); if (m) hits.push(`${f}: ${name} "${m[0]}"`); } }
  ok('[deploy] scanned deployable text files', text.length > 0, `${text.length} files: ${text.join(', ')}`);
  ok('[deploy] no fictitious numbers / placeholder / hard-coded tel: or wa.me links', hits.length === 0, hits.join(' | '));
  const sb = { window: {} }; vm.runInNewContext(realConfig, sb); const c = sb.window.JGS_CONFIG;
  ok('[deploy] config.js: phones are exactly the validated company numbers', c.contacts[0].phone === '+509 37 63 2416' && c.contacts[1].phone === '+1 (954) 706-2649', c.contacts.map(x => `${x.id}="${x.phone}"`).join(' '));
  ok('[deploy] config.js: WhatsApp message exactly as specified', c.whatsappMessage === MSG);
  ok('[deploy] config.js: heroPoster empty until the file exists', c.heroPoster === '' || fs.existsSync(path.join(ROOT, c.heroPoster)), `heroPoster="${c.heroPoster}"`);
  const md5 = f => require('crypto').createHash('md5').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  ok('[deploy] optimized videos preserved (unchanged checksums)',
    md5('assets/video/civelles-landscape.mp4') === 'ed1e5b264d4d36891064e07707f17120' && md5('assets/video/civelles-portrait.mp4') === '3cff3dbbb9fa6bb74a3b9b4d8c9a70e8');
}

/* ---------- 2. Contacts ---------- */
async function contactsTests(chrome) {
  // 0) Real configuration: the validated company numbers
  { const { ctx, page } = await newPage(chrome, { viewport: { width: 1440, height: 900 } });
    await page.goto(BASE, { waitUntil: 'load' });
    const r = await page.evaluate(() => [...document.querySelectorAll('[data-contact]')].map(c => [c.hidden, c.querySelector('[data-contact-number]').textContent,
      c.querySelector('[data-contact-call]').getAttribute('href'), c.querySelector('[data-contact-whatsapp]').getAttribute('href')]));
    ok('[contacts/real] Haiti: +509 37 63 2416 → tel:+50937632416 / wa.me/50937632416', !r[0][0] && r[0][1] === '+509 37 63 2416' && r[0][2] === 'tel:+50937632416' && r[0][3] === `https://wa.me/50937632416?text=${MSG_ENC}`, r[0].join(' | '));
    ok('[contacts/real] USA: +1 (954) 706-2649 → tel:+19547062649 / wa.me/19547062649', !r[1][0] && r[1][1] === '+1 (954) 706-2649' && r[1][2] === 'tel:+19547062649' && r[1][3] === `https://wa.me/19547062649?text=${MSG_ENC}`, r[1].join(' | '));
    await ctx.close(); }
  // a) Empty numbers: nothing shown
  { const { ctx, page, log } = await newPage(chrome, { viewport: { width: 1440, height: 900 } }, { config: configWith() });
    await page.goto(BASE, { waitUntil: 'load' });
    const s = await page.evaluate(() => ({
      officesHidden: document.querySelector('[data-offices]').hidden,
      fabHidden: document.querySelector('[data-wa-fab]').hidden,
      telLinks: [...document.querySelectorAll('a[href^="tel:"]')].length,
      waLinks: [...document.querySelectorAll('a[href*="wa.me"]')].length,
      visibleDigits: (document.body.innerText.match(/\+\d[\d\s().-]{7,}/g) || []),
      intro: document.querySelector('[data-contact-intro]').textContent,
      email: !!document.querySelector('a[href="mailto:contact@jgsantrepriz1939.com"]') }));
    ok('[contacts/empty] phone blocks hidden', s.officesHidden);
    ok('[contacts/empty] floating WhatsApp hidden', s.fabHidden);
    ok('[contacts/empty] no tel: / wa.me links and no phone numbers in the page', !s.telLinks && !s.waLinks && !s.visibleDigits.length, JSON.stringify(s.visibleDigits));
    ok('[contacts/empty] intro still says "by email"', /by email\.$/.test(s.intro));
    ok('[contacts/empty] email kept', s.email);
    ok('[contacts/empty] no popup / WhatsApp request on load', !log.popups.length && !log.req.some(u => u.includes('wa.me')));
    await ctx.close(); }

  // b) Invalid / placeholder values must stay hidden
  for (const [name, cfg] of [
    ['placeholder X', { ht: '+509 XXXX XXXX', us: '+1 XXX XXX XXXX' }],
    ['too short', { ht: '+509 1234', us: '+1 202 555' }],
    ['wrong country code', { ht: '+33 6 12 34 56 78', us: '+44 20 7946 0000' }],
    ['missing +', { ht: '509 0000 0001', us: '1 202 555 0123' }] ]) {
    const { ctx, page } = await newPage(chrome, { viewport: { width: 1440, height: 900 } }, { config: configWith(cfg) });
    await page.goto(BASE, { waitUntil: 'load' });
    const s = await page.evaluate(() => ({ off: document.querySelector('[data-offices]').hidden, fab: document.querySelector('[data-wa-fab]').hidden,
      txt: /X{3}|\+509|\+1 202|\+33|\+44/.test(document.body.innerText) }));
    ok(`[contacts/invalid: ${name}] rejected, nothing displayed`, s.off && s.fab && !s.txt);
    await ctx.close(); }

  // c) Both numbers configured
  const { ctx, page, log } = await newPage(chrome, { viewport: { width: 1440, height: 900 } }, { config: configWith({ ht: T_HT.phone, us: T_US.phone }) });
  await page.goto(BASE, { waitUntil: 'load' });
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-contact]')].map(c => ({
    id: c.dataset.contact, hidden: c.hidden, label: c.querySelector('[data-contact-label]').textContent,
    number: c.querySelector('[data-contact-number]').textContent,
    call: c.querySelector('[data-contact-call]').getAttribute('href'), callName: c.querySelector('[data-contact-call]').getAttribute('aria-label'),
    callText: c.querySelector('[data-contact-call]').textContent.trim(),
    wa: c.querySelector('[data-contact-whatsapp]').getAttribute('href'), waHidden: c.querySelector('[data-contact-whatsapp]').hidden,
    waTarget: c.querySelector('[data-contact-whatsapp]').target, waRel: c.querySelector('[data-contact-whatsapp]').rel,
    waText: c.querySelector('[data-contact-whatsapp]').textContent.trim(),
    icons: c.querySelectorAll('svg use').length })));
  const ht = cards.find(c => c.id === 'haiti'), us = cards.find(c => c.id === 'usa');
  ok('[contacts] Haiti Office block shown with label and number', !ht.hidden && ht.label === 'Haiti Office' && ht.number === T_HT.phone, JSON.stringify([ht.label, ht.number]));
  ok('[contacts] USA Contact block shown with label and number', !us.hidden && us.label === 'USA Contact' && us.number === T_US.phone, JSON.stringify([us.label, us.number]));
  ok('[contacts] Haiti "Call Now" → tel:+509…', ht.call === 'tel:+' + T_HT.digits && ht.callText === 'Call Now', ht.call);
  ok('[contacts] USA "Call Now" → tel:+1…', us.call === 'tel:+' + T_US.digits && us.callText === 'Call Now', us.call);
  const expWa = d => `https://wa.me/${d}?text=${MSG_ENC}`;
  ok('[contacts] Haiti WhatsApp → wa.me/<digits only>?text=<encoded>', ht.wa === expWa(T_HT.digits) && !ht.waHidden, ht.wa);
  ok('[contacts] USA WhatsApp → wa.me/<digits only>?text=<encoded>', us.wa === expWa(T_US.digits) && !us.waHidden, us.wa);
  ok('[contacts] wa.me number has no +, spaces or symbols', [ht.wa, us.wa].every(u => /^https:\/\/wa\.me\/\d+\?text=/.test(u)));
  const decoded = new URL(ht.wa).searchParams.get('text');
  ok('[contacts] prefilled message decodes back exactly', decoded === MSG, decoded);
  ok('[contacts] WhatsApp opens in new tab safely (noopener noreferrer)', ht.waTarget === '_blank' && /noopener/.test(ht.waRel) && /noreferrer/.test(ht.waRel));
  ok('[contacts] accessible names include visible text + office', /^Call Now: Haiti Office, \+509/.test(ht.callName) && /^Call Now: USA Contact/.test(us.callName), `${ht.callName} | ${us.callName}`);
  ok('[contacts] phone + WhatsApp icons present', ht.icons === 2 && us.icons === 2);
  ok('[contacts] intro mentions phone and WhatsApp', /email, phone or WhatsApp\.$/.test(await page.textContent('[data-contact-intro]')));
  ok('[contacts] email kept', await page.isVisible('a.contact-card__email[href="mailto:contact@jgsantrepriz1939.com"]'));
  // Opening WhatsApp only on user action
  ok('[contacts] WhatsApp NOT opened on load', !log.popups.length && !log.req.some(u => u.includes('wa.me')));
  await scrollInstant(page, 'end');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('[data-contact="usa"] [data-contact-whatsapp]')]);
  await popup.waitForLoadState();
  ok('[contacts] click on WhatsApp opens wa.me with message', popup.url() === expWa(T_US.digits), popup.url());
  await ctx.close();

  // d) WhatsApp disabled for one number
  { const { ctx, page } = await newPage(chrome, { viewport: { width: 1440, height: 900 } }, { config: configWith({ ht: T_HT.phone, us: T_US.phone, usWa: false }) });
    await page.goto(BASE, { waitUntil: 'load' });
    ok('[contacts] whatsapp:false hides only that WhatsApp button', await page.evaluate(() =>
      document.querySelector('[data-contact="usa"] [data-contact-whatsapp]').hidden && !document.querySelector('[data-contact="usa"] [data-contact-call]').closest('[hidden]')));
    await ctx.close(); }

  // e) Visual check across devices
  for (const [n, opts] of VIEWPORTS) {
    const { ctx, page } = await newPage(chrome, opts, { config: configWith({ ht: T_HT.phone, us: T_US.phone }) });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('is-visible')));
    await page.locator('#contact').scrollIntoViewIfNeeded(); await waitScrollSettled(page);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const fits = await page.evaluate(() => [...document.querySelectorAll('.office:not([hidden]) .office__number, .office__btn:not([hidden])')]
      .every(el => { const r = el.getBoundingClientRect(); return el.scrollWidth <= el.clientWidth + 1 && r.right <= innerWidth && r.left >= 0; }));
    const tap = await page.evaluate(() => [...document.querySelectorAll('.office__btn:not([hidden])')].every(b => b.getBoundingClientRect().height >= 44));
    ok(`[contacts/${n}] no horizontal overflow, numbers & buttons fit`, ov <= 0 && fits, `overflow=${ov}`);
    ok(`[contacts/${n}] touch targets ≥ 44px`, tap);
    await page.locator('#contact').screenshot({ path: path.join(OUT, `contact-${n}.png`) });
    await ctx.close();
  }
}

/* ---------- 3. Floating WhatsApp button & chooser ---------- */
async function fabTests() {
  for (const bn of ['chromium', 'firefox', 'webkit']) {
    const browser = await pw[bn].launch(bn === 'chromium' ? { channel: 'chrome' } : {});
    for (const [n, opts] of VIEWPORTS) {
      const tag = `[fab ${bn}/${n}]`;
      const { ctx, page, log } = await newPage(browser, ctxFor(bn, opts), { config: configWith({ ht: T_HT.phone, us: T_US.phone }) });
      await page.goto(BASE, { waitUntil: 'load' });
      const fabVisible = () => page.evaluate(() => { const f = document.querySelector('[data-wa-fab]'); const cs = getComputedStyle(f);
        return !f.hidden && cs.visibility === 'visible' && cs.opacity === '1'; });
      await waitTransitionDone(page, '[data-wa-fab]');
      ok(`${tag} tucked away while the hero is on screen`, !(await fabVisible()));
      await scrollInstant(page, await page.evaluate(() => document.querySelector('.hero').offsetHeight + 40)); await waitScrollSettled(page);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-wa-fab]')).opacity === '1');
      ok(`${tag} visible once the hero has left the screen`, await fabVisible());
      ok(`${tag} two numbers → chooser button (not a direct link)`, await page.evaluate(() =>
        !document.querySelector('[data-wa-toggle]').hidden && document.querySelector('[data-wa-direct]').hidden));
      ok(`${tag} toggle has accessible name & aria-expanded=false`, await page.evaluate(() => { const b = document.querySelector('[data-wa-toggle]');
        return b.getAttribute('aria-expanded') === 'false' && /WhatsApp/.test(b.textContent) && b.getAttribute('aria-controls') === 'wa-fab-panel'; }));
      // Open with the keyboard
      await page.focus('[data-wa-toggle]'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('[data-wa-panel]').hidden);
      const opt = await page.evaluate(() => [...document.querySelectorAll('[data-wa-option]')].map(a => ({ id: a.dataset.waOption, href: a.href, text: a.textContent.replace(/\s+/g, ' ').trim() })));
      ok(`${tag} Enter opens chooser, focus on first option`, await page.evaluate(() => document.activeElement.matches('[data-wa-option="haiti"]') &&
        document.querySelector('[data-wa-toggle]').getAttribute('aria-expanded') === 'true'));
      ok(`${tag} chooser lists Haiti and USA with correct links`, opt.length === 2 &&
        opt[0].href === `https://wa.me/${T_HT.digits}?text=${MSG_ENC}` && opt[1].href === `https://wa.me/${T_US.digits}?text=${MSG_ENC}` &&
        /Haiti Office/.test(opt[0].text) && /USA Contact/.test(opt[1].text), JSON.stringify(opt.map(o => o.text)));
      const inView = await page.evaluate(() => { const r = document.querySelector('[data-wa-panel]').getBoundingClientRect();
        return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
      ok(`${tag} chooser fully inside the viewport`, inView);
      if (bn === 'chromium') await page.screenshot({ path: path.join(OUT, `fab-open-${n}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-wa-panel]').hidden);
      ok(`${tag} Escape closes, focus back on toggle`, await page.evaluate(() => document.activeElement.matches('[data-wa-toggle]')));
      // Click outside closes
      await page.click('[data-wa-toggle]'); await page.waitForFunction(() => !document.querySelector('[data-wa-panel]').hidden);
      await page.mouse.click(10, Math.round(opts.viewport.height / 2));
      await page.waitForFunction(() => document.querySelector('[data-wa-panel]').hidden);
      ok(`${tag} click outside closes chooser`, true);
      // Choosing an option opens WhatsApp (user action) and closes the chooser
      await page.click('[data-wa-toggle]'); await page.waitForFunction(() => !document.querySelector('[data-wa-panel]').hidden);
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('[data-wa-option="usa"]')]);
      await popup.waitForLoadState();
      ok(`${tag} choosing USA opens wa.me/${T_US.digits} with message`, popup.url() === `https://wa.me/${T_US.digits}?text=${MSG_ENC}`, popup.url());
      await popup.close();
      await page.waitForFunction(() => document.querySelector('[data-wa-panel]').hidden);
      ok(`${tag} only one WhatsApp tab, opened by the click (none on load)`, log.popups.length === 1);
      // Never covers interactive elements at rest positions (section anchors + page end)
      const positions = await page.evaluate(() => ['about', 'product', 'export', 'contact'].map(id =>
        Math.round(document.getElementById(id).getBoundingClientRect().top + scrollY - 72)).concat(['end']));
      const covered = [];
      for (const y of positions) {
        await scrollInstant(page, y); await waitScrollSettled(page);
        await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('is-visible')));
        const hit = await page.evaluate(() => { const fab = document.querySelector('[data-wa-fab]');
          if (fab.classList.contains('is-away')) return [];
          const f = fab.querySelector('.wa-fab__btn:not([hidden])').getBoundingClientRect(); const pad = 4;
          return [...document.querySelectorAll('a[href], button:not([hidden])')].filter(el => !el.closest('[data-wa-fab]') && el.offsetParent !== null)
            .filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height && r.left < f.right + pad && r.right > f.left - pad && r.top < f.bottom + pad && r.bottom > f.top - pad; })
            .map(el => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30)); });
        if (hit.length) covered.push(`${y}: ${hit.join(', ')}`);
      }
      ok(`${tag} tucked away in the Contact section and at page end`, await page.evaluate(async () => {
        document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, document.getElementById('contact').offsetTop);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return document.querySelector('[data-wa-fab]').classList.contains('is-away'); }));
      ok(`${tag} never covers a link/button at section stops & page end`, !covered.length, covered.join(' | '));
      const endText = await page.evaluate(() => { const fab = document.querySelector('[data-wa-fab]');
        if (fab.classList.contains('is-away')) return [];
        const f = fab.querySelector('.wa-fab__btn:not([hidden])').getBoundingClientRect();
        const w = document.createTreeWalker(document.querySelector('.site-footer'), NodeFilter.SHOW_TEXT); const out = [];
        while (w.nextNode()) { const t = w.currentNode; if (!t.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(t);
          for (const r of rg.getClientRects()) if (r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top) out.push(t.textContent.trim()); }
        return out; });
      ok(`${tag} footer text not covered at page end`, !endText.length, endText.join(', '));
      // Full-page sweep (narrow screens): never on top of the contact Call/WhatsApp buttons;
      // report any other control that passes under it while scrolling
      if (opts.viewport.width < 900) {
        const sweep = await page.evaluate(async () => {
          document.documentElement.style.scrollBehavior = 'auto';
          const fab = document.querySelector('[data-wa-fab]'); const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const office = [], other = new Set(); let visibleSteps = 0, steps = 0;
          for (let y = 0; y <= document.body.scrollHeight; y += 60) {
            window.scrollTo(0, y); await frame(); await new Promise(r => setTimeout(r, 30)); steps++;
            if (fab.classList.contains('is-away')) continue; visibleSteps++; // tucked away = pointer-events none
            const f = fab.querySelector('.wa-fab__btn:not([hidden])').getBoundingClientRect();
            for (const el of document.querySelectorAll('a[href], button:not([hidden])')) {
              if (el.closest('[data-wa-fab]') || el.offsetParent === null) continue;
              const r = el.getBoundingClientRect();
              if (r.width && r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top) {
                if (el.closest('.office')) office.push(y); else other.add((el.textContent || '').trim().slice(0, 30));
              }
            }
          }
          return { office, other: [...other], visibleSteps, steps };
        });
        ok(`${tag} sweep: never over the contact Call/WhatsApp buttons (or any control, see NOTE)`, !sweep.office.length, `visible on ${sweep.visibleSteps}/${sweep.steps} scroll steps; office overlaps at ${sweep.office.join(',') || 'none'}`);
        if (sweep.other.length) results.push(`NOTE  ${tag} controls that pass under the floating button mid-scroll: ${sweep.other.join(' | ')}`);
      }
      // Mobile menu open → floating button covered and inert
      if (opts.viewport.width < 960) {
        await scrollInstant(page, 1200); await waitScrollSettled(page);
        await page.click('[data-nav-toggle]'); await waitTransitionDone(page, '#site-nav');
        const st = await page.evaluate(() => { const f = document.querySelector('[data-wa-fab]'); const r = f.querySelector('.wa-fab__btn:not([hidden])').getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { inert: f.hasAttribute('inert'), covered: !f.contains(el) }; });
        ok(`${tag} hidden behind the open mobile menu and inert`, st.inert && st.covered, JSON.stringify(st));
        await page.keyboard.press('Escape'); await waitTransitionDone(page, '#site-nav');
      }
      ok(`${tag} no JS errors / failed requests`, !log.errs.length && !log.bad.length, [...log.errs, ...log.bad].join(' | '));
      await ctx.close();
    }
    await browser.close();
  }
  // Single WhatsApp number → direct link
  const chrome = await pw.chromium.launch({ channel: 'chrome' });
  const { ctx, page } = await newPage(chrome, { viewport: { width: 390, height: 844 } }, { config: configWith({ ht: T_HT.phone }) });
  await page.goto(BASE, { waitUntil: 'load' });
  const s = await page.evaluate(() => { const d = document.querySelector('[data-wa-direct]');
    return { toggleHidden: document.querySelector('[data-wa-toggle]').hidden, directHidden: d.hidden, href: d.href, name: d.getAttribute('aria-label'),
      usaCard: document.querySelector('[data-contact="usa"]').hidden }; });
  ok('[fab single] one number → direct link, no chooser', s.toggleHidden && !s.directHidden && s.href === `https://wa.me/${T_HT.digits}?text=${MSG_ENC}`, s.href);
  ok('[fab single] accessible name names the office', /Haiti Office/.test(s.name), s.name);
  ok('[fab single] unconfigured USA block stays hidden', s.usaCard);
  await ctx.close(); await chrome.close();
}

/* ---------- 4. Poster ---------- */
async function posterTests(card) {
  const chrome = await pw.chromium.launch({ channel: 'chrome' });
  const cfg = configWith({ poster: POSTER_PATH });
  for (const [n, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
                           ['tablet', { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }]]) {
    // Reduced motion keeps the poster on screen (no video download)
    const { ctx, page, log } = await newPage(chrome, { ...opts, reducedMotion: 'reduce' }, { config: cfg, poster: card });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(p => { const v = document.querySelector('[data-hero-video]'); return v.getAttribute('poster') === p && v.classList.contains('is-ready'); }, POSTER_PATH);
    await waitTransitionDone(page, '[data-hero-video]');
    const st = await page.evaluate(() => { const v = document.querySelector('[data-hero-video]'); const cs = getComputedStyle(v); return { opacity: cs.opacity, fit: cs.objectFit }; });
    ok(`[poster ${n}] shown (opacity 1, object-fit cover) with no video download`, st.opacity === '1' && st.fit === 'cover' && !mp4s(log).length, JSON.stringify(st));
    // Measure the red test circle: must stay round (no distortion)
    await page.addStyleTag({ content: '.hero__content,.hero__foot,.site-header,.hero__shade{visibility:hidden!important;transition:none!important}.hero__video{filter:none!important;transition:none!important}' });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero__content')).visibility === 'hidden' &&
      document.getAnimations().every(a => a.playState !== 'running'));
    const shot = path.join(OUT, `poster-${n}.png`); await page.screenshot({ path: shot });
    const bbox = await measureRed(shot);
    ok(`[poster ${n}] no distortion: test circle stays round`, bbox && Math.abs(bbox.w / bbox.h - 1) < 0.04, bbox ? `circle ${bbox.w}×${bbox.h}px (ratio ${(bbox.w / bbox.h).toFixed(3)})` : 'circle not found');
    ok(`[poster ${n}] centred (cover crop keeps the middle)`, bbox && Math.abs(bbox.cx - opts.viewport.width / 2) < 4 && Math.abs(bbox.cy - opts.viewport.height / 2) < 4, bbox ? `centre ${bbox.cx},${bbox.cy}` : '');
    ok(`[poster ${n}] no errors`, !log.errs.length && !log.bad.length, [...log.errs, ...log.bad].join(' | '));
    await ctx.close();
    // Normal motion: poster first, then the video takes over and plays
    const t = await newPage(chrome, opts, { config: cfg, poster: card });
    await t.page.goto(BASE, { waitUntil: 'load' });
    await t.page.waitForFunction(() => { const v = document.querySelector('[data-hero-video]'); return v && !v.paused && v.currentTime > 0.5; });
    ok(`[poster ${n}] autoplay still works with a poster`, await t.page.evaluate(() => { const v = document.querySelector('[data-hero-video]'); return v.muted && v.loop && !v.paused; }));
    await t.ctx.close();
  }
  // Configured poster missing on the server → no broken image, video still plays
  { const { ctx, page, log } = await newPage(chrome, { viewport: { width: 1440, height: 900 } }, { config: configWith({ poster: 'assets/video/does-not-exist.jpg' }) });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => { const v = document.querySelector('[data-hero-video]'); return v && !v.paused && v.currentTime > 0.3; });
    ok('[poster missing] poster attribute not applied, video still plays', !(await page.evaluate(() => document.querySelector('[data-hero-video]').hasAttribute('poster'))));
    ok('[poster missing] no uncaught JS exception', !log.errs.some(e => !/404|Failed to load resource/.test(e)), log.errs.join(' | '));
    await ctx.close(); }
  await chrome.close();
}
async function measureRed(file) {
  const py = `import sys,json\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB');w,h=im.size;px=im.load()\nxs=[];ys=[]\nfor y in range(h):\n  for x in range(w):\n    r,g,b=px[x,y]\n    if r>150 and g<90 and b<90: xs.append(x); ys.append(y)\nprint(json.dumps(None if not xs else {'w':max(xs)-min(xs)+1,'h':max(ys)-min(ys)+1,'cx':round((max(xs)+min(xs))/2),'cy':round((max(ys)+min(ys))/2)}))`;
  return JSON.parse(execFileSync('python3', ['-I', '-c', py, file]).toString());
}

/* ---------- 5. Video regressions & slow connections ---------- */
async function videoTests() {
  const chrome = await pw.chromium.launch({ channel: 'chrome' });
  const vstate = page => page.evaluate(() => { const v = document.querySelector('[data-hero-video]'); const b = document.querySelector('[data-video-toggle]');
    return v ? { paused: v.paused, muted: v.muted, loop: v.loop, src: v.currentSrc.split('/').pop(), btn: b.hidden ? 'hidden' : `${b.getAttribute('aria-pressed')}|${b.textContent.trim()}` } : null; });
  for (const [n, opts, exp] of [['desktop', { viewport: { width: 1440, height: 900 } }, 'civelles-landscape.mp4'],
                                ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 'civelles-portrait.mp4'],
                                ['tablet', { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }, 'civelles-portrait.mp4']]) {
    const { ctx, page, log } = await newPage(chrome, opts);
    await page.goto(BASE, { waitUntil: 'load' });
    const stuck = await waitPlaying(page);
    ok(`[video ${n}] starts playing automatically`, !stuck, stuck || '');
    if (stuck) { await ctx.close(); continue; }
    const s = await vstate(page);
    ok(`[video ${n}] autoplay, muted, loop, right file, one download`, s.muted && s.loop && s.src === exp && mp4s(log).length === 1, `${s.src} / ${mp4s(log)}`);
    ok(`[video ${n}] pause button ready`, s.btn === 'false|Pause background video', s.btn);
    await page.click('[data-video-toggle]'); await page.waitForFunction(() => document.querySelector('[data-hero-video]').paused);
    ok(`[video ${n}] pause → aria-pressed=true, label "Play"`, (await vstate(page)).btn === 'true|Play background video');
    await page.focus('[data-video-toggle]'); await page.keyboard.press('Space');
    await page.waitForFunction(() => !document.querySelector('[data-hero-video]').paused);
    ok(`[video ${n}] keyboard resumes`, true);
    await scrollInstant(page, 2500); await page.waitForFunction(() => document.querySelector('[data-hero-video]').paused);
    await scrollInstant(page, 0); await page.waitForFunction(() => !document.querySelector('[data-hero-video]').paused);
    ok(`[video ${n}] off-screen pause / resume`, true);
    ok(`[video ${n}] no errors`, !log.errs.length && !log.bad.length, [...log.errs, ...log.bad].join(' | '));
    await ctx.close();
  }
  // Preferences & declared slow connections: no video download at all
  for (const [name, opts, connection] of [
    ['reduced motion', { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }, null],
    ['Save-Data', { viewport: { width: 390, height: 844 }, isMobile: true }, { saveData: true, effectiveType: '4g' }],
    ['slow-2g', { viewport: { width: 390, height: 844 }, isMobile: true }, { saveData: false, effectiveType: 'slow-2g' }],
    ['2g', { viewport: { width: 390, height: 844 }, isMobile: true }, { saveData: false, effectiveType: '2g' }],
    ['3g', { viewport: { width: 390, height: 844 }, isMobile: true }, { saveData: false, effectiveType: '3g' }] ]) {
    const { ctx, page, log } = await newPage(chrome, opts, { connection });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-video-toggle]').hidden);
    await page.waitForLoadState('networkidle');
    const s = await vstate(page);
    ok(`[video ${name}] no autoplay and NO video downloaded`, s.paused && mp4s(log).length === 0, `downloaded: ${mp4s(log).join(',') || 'none'}`);
    ok(`[video ${name}] "Play background video" offered`, s.btn === 'true|Play background video', s.btn);
    await page.click('[data-video-toggle]');
    await page.waitForFunction(() => { const v = document.querySelector('[data-hero-video]'); return !v.paused && v.currentTime > 0.2; });
    ok(`[video ${name}] downloads and plays only after the visitor asks`, mp4s(log).length === 1);
    await ctx.close();
  }
  // Real throttling (Chrome DevTools): page text first; video never before load
  for (const [name, cond] of [['throttled slow 3G', { latency: 400, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8 }],
                              ['throttled fast 3G', { latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 }]]) {
    const { ctx, page, log } = await newPage(chrome, { viewport: { width: 390, height: 844 }, isMobile: true });
    const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...cond, connectionType: 'cellular3g' });
    const t0 = Date.now(); let mp4At = null; page.on('request', r => { if (r.url().endsWith('.mp4') && mp4At === null) mp4At = Date.now() - t0; });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#hero-title', { state: 'visible' }); const titleAt = Date.now() - t0;
    await page.waitForLoadState('load'); const loadAt = Date.now() - t0;
    await page.waitForFunction(() => !document.querySelector('[data-video-toggle]').hidden, null, { timeout: 30000 });
    const et = await page.evaluate(() => navigator.connection && navigator.connection.effectiveType);
    const s = await vstate(page);
    ok(`[video ${name}] hero text visible before any video byte; video never requested before page load`,
      titleAt <= loadAt && (mp4At === null || mp4At >= loadAt), `title ${titleAt} ms, load ${loadAt} ms, video ${mp4At === null ? 'not requested' : mp4At + ' ms'}, effectiveType=${et}, state=${s.paused ? 'paused (Play offered)' : 'playing'}`);
    await ctx.close();
  }
  // Stall guard: very slow real network → automatic start aborted, Play offered, no endless download
  { const { ctx, page, log } = await newPage(chrome, { viewport: { width: 390, height: 844 }, isMobile: true });
    const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
    const aborted = []; page.on('requestfailed', r => { if (r.url().endsWith('.mp4')) aborted.push(r.failure() && r.failure().errorText); });
    await page.goto(BASE, { waitUntil: 'load' });                        // page itself loads at normal speed
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 60 * 1024 / 8, uploadThroughput: 60 * 1024 / 8 });
    await page.waitForFunction(() => document.querySelector('[data-video-toggle]').getAttribute('aria-pressed') === 'true', null, { timeout: 20000 });
    const s = await vstate(page);
    ok('[video stall guard] very slow network: automatic start aborted, "Play" offered', s && s.paused && s.btn === 'true|Play background video', JSON.stringify(s));
    ok('[video stall guard] pending video download cancelled', aborted.length >= 1 || await page.evaluate(() => document.querySelector('[data-hero-video]').networkState === 3 || document.querySelector('[data-hero-video]').networkState === 0), `aborted: ${aborted.join(',') || 'n/a'}`);
    ok('[video stall guard] video element kept (gradient/poster), no JS errors', !!(await page.$('[data-hero-video]')) && !log.errs.length, log.errs.join(' | '));
    const before = log.req.filter(u => u.endsWith('.mp4')).length;
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.click('[data-video-toggle]');
    await page.waitForFunction(() => { const v = document.querySelector('[data-hero-video]'); return !v.paused && v.currentTime > 0.2; }, null, { timeout: 20000 });
    ok('[video stall guard] visitor can still start it (new download on click)', log.req.filter(u => u.endsWith('.mp4')).length > before);
    await ctx.close(); }
  // Guard does not trigger on a usable connection (throttled fast 3G)
  { const { ctx, page } = await newPage(chrome, { viewport: { width: 390, height: 844 }, isMobile: true });
    const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
    await page.goto(BASE, { waitUntil: 'load' });
    const stuckG = await waitPlaying(page, 0.5, 20000);
    ok('[video stall guard] fast 3G: video plays normally (guard not triggered)', !stuckG, stuckG || '');
    await ctx.close(); }
  await chrome.close();
}

/* ---------- 6. Navigation regressions (deterministic waits) ---------- */
async function navTests() {
  for (const bn of ['chromium', 'firefox', 'webkit']) {
    const browser = await pw[bn].launch(bn === 'chromium' ? { channel: 'chrome' } : {});
    for (const [n, opts] of VIEWPORTS) {
      const tag = `[nav ${bn}/${n}]`;
      const { ctx, page, log } = await newPage(browser, ctxFor(bn, opts));
      await page.goto(BASE, { waitUntil: 'load' });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(`${tag} no horizontal overflow`, ov <= 0, `overflow=${ov}`);
      const navHidden = () => page.evaluate(() => getComputedStyle(document.getElementById('site-nav')).visibility === 'hidden');
      if (opts.viewport.width < 960) {
        ok(`${tag} menu closed initially`, await navHidden());
        await page.click('[data-nav-toggle]');
        await page.waitForFunction(() => { const cs = getComputedStyle(document.getElementById('site-nav')); return cs.visibility === 'visible' && cs.opacity === '1'; });
        ok(`${tag} opens: aria-expanded, focus inside, page inert`, await page.evaluate(() =>
          document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded') === 'true' && !!document.activeElement.closest('#site-nav') && document.getElementById('main').hasAttribute('inert')));
        const covers = await page.evaluate(() => [[innerWidth / 2, innerHeight / 2], [20, innerHeight - 60]].every(([x, y]) => document.elementFromPoint(x, y)?.closest('#site-nav'))
          && [...document.querySelectorAll('#site-nav a')].every(a => { const r = a.getBoundingClientRect(); return a.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }));
        ok(`${tag} panel covers the screen, every link clickable`, covers);
        let escaped = false; for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => !document.activeElement.closest('[data-header]'))) escaped = true; }
        ok(`${tag} focus trapped in menu`, !escaped);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => getComputedStyle(document.getElementById('site-nav')).visibility === 'hidden');
        ok(`${tag} Escape closes, focus back on toggle`, await page.evaluate(() =>
          document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded') === 'false' && document.activeElement.matches('[data-nav-toggle]')));
        await page.click('[data-nav-toggle]');
        await page.waitForFunction(() => getComputedStyle(document.getElementById('site-nav')).opacity === '1');
        await page.click('#site-nav a[href="#export"]');
        await page.waitForFunction(() => getComputedStyle(document.getElementById('site-nav')).visibility === 'hidden');
      } else {
        ok(`${tag} desktop links visible, no hamburger`, await page.isVisible('#site-nav a[href="#export"]') && !(await page.isVisible('[data-nav-toggle]')));
        await page.click('#site-nav a[href="#export"]');
      }
      await waitScrollSettled(page);
      const top = await page.evaluate(() => Math.round(document.getElementById('export').getBoundingClientRect().top));
      ok(`${tag} anchor lands below fixed header`, top >= 60 && top <= 90, `top=${top}`);
      await page.waitForFunction(() => document.querySelector('.site-nav__list a[aria-current]')?.getAttribute('href') === '#export');
      ok(`${tag} active section = Export Information`, true);
      ok(`${tag} no JS errors / failed requests`, !log.errs.length && !log.bad.length, [...log.errs, ...log.bad].join(' | '));
      await ctx.close();
    }
    await browser.close();
  }
  const chrome = await pw.chromium.launch({ channel: 'chrome' });
  const { ctx, page } = await newPage(chrome, { viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.keyboard.press('Tab');
  ok('[nav keyboard] first Tab = skip link', await page.evaluate(() => document.activeElement.classList.contains('skip-link')));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement.id === 'main');
  ok('[nav keyboard] skip link moves focus to main', true);
  await ctx.close(); await chrome.close();
}

/* ---------- 7. Automated accessibility audit (axe-core) ---------- */
async function a11yTests() {
  const chrome = await pw.chromium.launch({ channel: 'chrome' });
  const filled = configWith({ ht: T_HT.phone, us: T_US.phone });
  for (const [name, opts, extra, act] of [
    ['real site desktop', { viewport: { width: 1440, height: 900 } }, {}, null],
    ['real site phone', { viewport: { width: 390, height: 844 }, isMobile: true }, {}, null],
    ['contacts filled desktop', { viewport: { width: 1440, height: 900 } }, { config: filled }, null],
    ['contacts filled phone + chooser open', { viewport: { width: 390, height: 844 }, isMobile: true }, { config: filled }, async page => {
      await scrollInstant(page, 1500); await waitScrollSettled(page);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-wa-fab]')).opacity === '1');
      await page.click('[data-wa-toggle]'); await page.waitForFunction(() => !document.querySelector('[data-wa-panel]').hidden); }],
    ['mobile menu open', { viewport: { width: 390, height: 844 }, isMobile: true }, { config: filled }, async page => {
      await page.click('[data-nav-toggle]'); await waitTransitionDone(page, '#site-nav'); }] ]) {
    const { ctx, page } = await newPage(chrome, opts, extra);
    await page.goto(BASE, { waitUntil: 'load' });
    if (act) await act(page);
    const v = await axeRun(page);
    ok(`[axe ${name}] WCAG 2.2 A/AA + best practices: 0 violations`, !v.length, v.join(' | '));
    await ctx.close();
  }
  await chrome.close();
}

/* ---------- 8. Text contrast over the playing video ---------- */
async function contrastTests() {
  const chrome = await pw.chromium.launch({ channel: 'chrome' });
  const py = path.join(OUT, 'contrast.py');
  fs.writeFileSync(py, `import json,sys,numpy as np\nfrom PIL import Image\nd=json.load(open(sys.argv[1]))\ndef lin(c):\n  c=c/255; return np.where(c<=0.03928,c/12.92,((c+0.055)/1.055)**2.4)\ndef L(a): return 0.2126*lin(a[...,0])+0.7152*lin(a[...,1])+0.0722*lin(a[...,2])\ndef H(h): return float(L(np.array([[int(h[i:i+2],16) for i in (1,3,5)]],float))[0])\nspec={'title':[('#f3f1ea',3)],'lead':[('#b9c3c4',4.5)],'eyebrow':[('#e3cc9c',4.5)],'nav':[('#b9c3c4',4.5)],'foot':[('#b9c3c4',4.5)]}\nworst={}\nfor f,boxes in d:\n  im=np.asarray(Image.open(f).convert('RGB'),float)\n  for k,(x0,y0,x1,y1) in boxes.items():\n    bg=float(np.percentile(L(im[max(y0,0):y1,max(x0,0):x1]),95))\n    for col,req in spec[k]:\n      r=(max(H(col),bg)+.05)/(min(H(col),bg)+.05)\n      if k not in worst or r<worst[k][0]: worst[k]=(round(r,2),req)\nprint(json.dumps(worst))`);
  for (const [n, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    const { ctx, page } = await newPage(chrome, { viewport: vp });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => { const v = document.querySelector('[data-hero-video]'); return v && !v.paused && v.currentTime > 0.3; });
    const boxes = await page.evaluate(() => { const g = s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
      return { title: g('#hero-title'), lead: g('.hero__lead'), eyebrow: g('.eyebrow'), nav: g('.site-header__inner'), foot: g('.hero__foot') }; });
    await page.addStyleTag({ content: '.hero__content,.hero__foot,.site-header{visibility:hidden!important}' });
    const frames = [];
    for (let i = 0; i < 10; i++) { // one sample every ~1.4 s of video time (covers the whole loop)
      const t0 = await page.evaluate(() => document.querySelector('[data-hero-video]').currentTime);
      await page.waitForFunction(t => { const v = document.querySelector('[data-hero-video]'); const d = v.currentTime - t; return d > 1.3 || d < -1; }, t0);
      const f = path.join(OUT, `contrast-${n}-${i}.png`); await page.screenshot({ path: f }); frames.push([f, boxes]);
    }
    const j = path.join(OUT, `contrast-${n}.json`); fs.writeFileSync(j, JSON.stringify(frames));
    const worst = JSON.parse(execFileSync('python3', ['-I', py, j]).toString());
    for (const [k, [r, req]] of Object.entries(worst)) ok(`[contrast ${n}] ${k} over video ≥ ${req}:1 (worst of 10 frames)`, r >= req, `${r}:1`);
    await ctx.close();
  }
  await chrome.close();
}

/* ---------- Runner ---------- */
(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    const block = async (name, fn) => { if (!want(name)) return;
      try { await fn(); } catch (e) { results.push(`FAIL  [${name}] block crashed — ` + (e.stack || e).toString().split('\n').slice(0, 3).join(' / ')); } };
    await block('deploy', async () => deployScan());
    await block('contacts', async () => { const c = await pw.chromium.launch({ channel: 'chrome' }); try { await contactsTests(c); } finally { await c.close(); } });
    await block('fab', fabTests);
    await block('poster', async () => posterTests(makeTestCard()));
    await block('video', videoTests);
    await block('nav', navTests);
    await block('a11y', a11yTests);
    await block('contrast', contrastTests);
  } catch (e) { results.push('FAIL  runner crashed — ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' / ')); }
  finally { server.kill(); }
  console.log(results.join('\n'));
  const fail = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fail} passed, ${fail} failed   (screenshots: ${OUT})`);
  process.exit(fail ? 1 : 0);
})();
