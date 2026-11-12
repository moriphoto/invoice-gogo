// Network-idle proof for MANUAL-ONLY sync: after sign-in, the app must make ZERO requests to /api/* by itself.
//   Phase 1: IDLE_SECONDS (default 180) of idle use (plus offline/online, tab hide/show, focus events)
//   Phase 2: EDIT_SECONDS (default 180) of continuously editing invoices / settings / expenses through the real UI
//   Phase 3: one press of "Sync data" -> exactly one POST /api/sync
// Requests are counted two ways: in the browser (page.on('request'), incl. service-worker traffic) and at the server (dev-server request log).
// Run: NODE_PATH=<dir with puppeteer-core> TZ=Europe/London node tests/idle.e2e.js
const puppeteer = require('puppeteer-core'); const assert = require('assert'); const fs = require('fs'); const path = require('path');
const IDLE = +(process.env.IDLE_SECONDS || 180), EDIT = +(process.env.EDIT_SECONDS || 180); const TEST_PIN = 'idle-test-pin-7'; const PORT = +(process.env.PORT || 8801);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const { startDevServer } = await import('../tools/dev-server.mjs'); const srv = await startDevServer({ port: PORT });
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--lang=en-GB'], defaultViewport: { width: 1280, height: 800 } });
  const pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  const pageReqs = []; const watch = target => { target.on && target.on('request', r => { if (/\/api\//.test(r.url())) pageReqs.push({ t: Date.now(), m: r.method(), u: new URL(r.url()).pathname }); }); };
  watch(pg); b.on('targetcreated', async t => { if (t.type() === 'service_worker') { try { const c = await t.createCDPSession(); await c.send('Network.enable'); c.on('Network.requestWillBeSent', e => { if (/\/api\//.test(e.request.url)) pageReqs.push({ t: Date.now(), m: e.request.method, u: new URL(e.request.url).pathname, sw: true }); }); } catch (e) { /* ignore */ } } });
  await pg.goto(`http://localhost:${PORT}/`); await pg.waitForSelector('#pinNew'); await pg.type('#pinNew', TEST_PIN); await pg.type('#pinConfirm', TEST_PIN); await pg.click('#lockForm button[type=submit]'); await pg.waitForSelector('#syncBtn', { visible: true });
  await sleep(1500); // let the service worker install
  const allowed = /^(GET \/api\/status|POST \/api\/login|POST \/api\/setup)$/;
  const mark = () => ({ s: srv.reqLog.length, p: pageReqs.length });
  const since = m => ({ server: srv.reqLog.slice(m.s).map(r => r.method + ' ' + r.path), browser: pageReqs.slice(m.p).map(r => r.m + ' ' + r.u + (r.sw ? ' (sw)' : '')) });
  const report = (name, r) => { console.log(`${name}: server /api requests = ${r.server.length}${r.server.length ? ' ' + JSON.stringify(r.server) : ''}; browser-side /api requests = ${r.browser.length}${r.browser.length ? ' ' + JSON.stringify(r.browser) : ''}`); };
  const t0 = new Date(); console.log('start', t0.toLocaleTimeString('en-GB'), '(Europe/London)');
  assert.deepStrictEqual(srv.reqLog.map(r => r.method + ' ' + r.path).filter(x => !allowed.test(x)), [], 'sign-in itself made no sync call');
  console.log('sign-in: API calls =', JSON.stringify(srv.reqLog.map(r => r.method + ' ' + r.path)), '(status + setup only; no sync, no data)');

  // first-ever press on this (still empty) device: the one-off "first sync" (GET data + POST sync). Everything after it is what we're measuring.
  await pg.click('#syncBtn'); await pg.waitForFunction(() => /^Synced \d\d:\d\d$/.test(document.querySelector('#syncInd').innerText.trim()), { timeout: 15000 }); await sleep(1000);
  console.log('first press of Sync data: API calls =', JSON.stringify(srv.reqLog.slice(2).map(r => r.method + ' ' + r.path)));
  // ---- phase 1: idle
  let m = mark(); const end1 = Date.now() + IDLE * 1000; let tick = 0;
  while (Date.now() < end1) {
    await sleep(15000); tick++;
    if (tick === 3) { await pg.setOfflineMode(true); await sleep(1500); await pg.setOfflineMode(false); }
    if (tick === 5) await pg.evaluate(() => { for (const v of ['hidden', 'visible']) { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); } window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
    if (tick === 8) await pg.evaluate(() => { location.hash = '#/invoices'; }); if (tick === 9) await pg.evaluate(() => { location.hash = '#/dashboard'; });
  }
  let r = since(m); report(`PHASE 1 idle ${IDLE}s`, r); assert.deepStrictEqual(r.server, [], 'idle: server saw API calls'); assert.deepStrictEqual(r.browser, [], 'idle: browser made API calls');

  // ---- phase 2: editing through the UI
  m = mark(); const end2 = Date.now() + EDIT * 1000; let cycle = 0, saved = 0; const typeSlow = async (sel, text) => { await pg.click(sel, { clickCount: 3 }).catch(() => {}); await pg.type(sel, text, { delay: 60 }); };
  while (Date.now() < end2) {
    cycle++;
    await pg.evaluate(() => { location.hash = '#/invoice/new'; }); await pg.waitForSelector('[data-f="clientId"]'); await sleep(400);
    await pg.select('[data-f="clientId"]', await pg.$eval('[data-f="clientId"] option:nth-child(2)', o => o.value));
    await typeSlow('[data-l="0:desc"]', 'Product shoot day ' + cycle); await typeSlow('[data-l="0:qty"]', String(1 + cycle % 3)); await typeSlow('[data-l="0:rate"]', String(250 + cycle));
    await pg.click('[data-act="edAddLine"]'); await sleep(300); await pg.keyboard.type('Editing + grade', { delay: 70 }); await sleep(2500);
    await typeSlow('[data-f="notes"]', 'Thanks! Usage: web + social. ' + 'x'.repeat(10 + cycle)); await sleep(3000);
    await pg.click('[data-act="edSave"]'); await pg.waitForSelector('[data-act="markSent"], [data-act="pdf"]'); saved++; await sleep(2500);
    await pg.evaluate(() => { document.querySelector('[data-act="markSent"]') && document.querySelector('[data-act="markSent"]').click(); }); await sleep(2000);
    await pg.evaluate(() => { location.hash = location.hash + '/edit'; }); await pg.waitForSelector('[data-l="0:desc"]'); await typeSlow('[data-l="0:desc"]', 'Edited later ' + cycle); await sleep(2500); await pg.click('[data-act="edSave"]'); await sleep(2500);
    await pg.evaluate(() => { location.hash = '#/settings'; }); await pg.waitForSelector('[data-s="phone"]'); await typeSlow('[data-s="phone"]', '07700 9000' + String(cycle % 10)); await sleep(2000);
    await pg.evaluate(() => { location.hash = '#/clients'; }); await sleep(2500);
  }
  r = since(m); report(`PHASE 2 editing ${EDIT}s (${saved} invoices created + edited + marked sent, settings changed)`, r); assert.deepStrictEqual(r.server, [], 'editing: server saw API calls'); assert.deepStrictEqual(r.browser, [], 'editing: browser made API calls');
  const ind = await pg.$eval('#syncInd', e => e.innerText.trim()); console.log('indicator after editing:', JSON.stringify(ind)); assert(/^Unsynced changes \(\d+\)$/.test(ind));
  await pg.evaluate(() => { location.hash = '#/dashboard'; }); await sleep(500); await pg.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'v3-idle-test-unsynced.png') });

  // ---- phase 3: one press
  m = mark(); await pg.click('#syncBtn'); await pg.waitForFunction(() => /^Synced \d\d:\d\d$/.test(document.querySelector('#syncInd').innerText.trim()), { timeout: 15000 }); await sleep(1000);
  r = since(m); report('PHASE 3 one press of Sync data', r); assert.deepStrictEqual(r.server.filter(x => !/^GET \/api\/data$/.test(x)), ['POST /api/sync']);
  assert.deepStrictEqual(errs, []); const t1 = new Date(); console.log('finished', t1.toLocaleTimeString('en-GB'), '(Europe/London) – PASS: nothing hit /api/* in the background');
  await b.close(); await srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
