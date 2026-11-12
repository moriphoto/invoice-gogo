// End-to-end tests (puppeteer-core + system Chrome) against the local dev server (static app + the real API handler on an in-memory blob store).
// Run: NODE_PATH=<dir with puppeteer-core> TZ=Europe/London node tests/e2e.js
const puppeteer = require('puppeteer-core'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const TEST_PIN = 'e2e-test-pin-1'; const SHOTS = path.join(__dirname, '..', 'screenshots'); const SAMPLES = path.join(__dirname, '..', 'samples');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0; const t = async (name, fn) => { try { await fn(); pass++; console.log('ok  -', name); } catch (e) { process.exitCode = 1; console.error('FAIL -', name, '\n  ', e.message.split('\n').slice(0, 4).join('\n   ')); } };
(async () => {
  const { startDevServer } = await import('../tools/dev-server.mjs'); const srv1 = await startDevServer({ port: 8765 }); const URL = 'http://localhost:8765/';
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--lang=en-GB'], defaultViewport: { width: 1280, height: 800 } });
  const pg = await b.newPage(); const errs = []; await pg.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB' });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  pg.on('dialog', d => d.accept());
  const dl = path.join('/tmp', 'igg-dl'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl);
  const cdp = await pg.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  const hash = async h => { await pg.evaluate(h => { location.hash = '#/' + h; }, h); await sleep(120); };
  const txt = async s => pg.$eval(s || '#page', e => e.innerText);
  const click = async (sel, text) => { await pg.evaluate((sel, text) => { const el = [...document.querySelectorAll(sel)].find(e => !text || e.textContent.includes(text)); if (!el) throw new Error('no ' + sel + ' ' + text); el.click(); }, sel, text); await sleep(120); };
  const setVal = async (sel, v) => { await pg.evaluate((sel, v) => { const el = document.querySelector(sel); if (!el) throw new Error('no ' + sel); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, sel, v); await sleep(60); };
  const db = () => pg.evaluate(() => { const o = {}; ['clients', 'invoices', 'items', 'expenses', 'projects', 'settings', 'imported'].forEach(k => o[k] = JSON.parse(localStorage.getItem('igg_' + k))); return o; });
  const shot = async (n, w, h, scroll) => { await pg.evaluate(() => { const x = document.getElementById('toast'); if (x) x.remove(); }); if (w) await pg.setViewport({ width: w, height: h, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500 }); await sleep(250); if (scroll) await pg.evaluate(y => window.scrollTo(0, y), scroll); await sleep(100); await pg.screenshot({ path: path.join(SHOTS, n + '.png') }); };

  const unlock = async () => { await pg.waitForSelector('#lock #lockForm', { timeout: 8000 }); if (await pg.$('#pinNew')) { await pg.type('#pinNew', TEST_PIN); await pg.type('#pinConfirm', TEST_PIN); } else await pg.type('#pinLogin', TEST_PIN); await pg.click('#lockForm button[type=submit]'); await pg.waitForSelector('#topbar', { visible: true, timeout: 8000 }); await sleep(900); };
  await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await unlock();

  await t('first run seeds Sewing Studio client + Content work £22/hour item', async () => {
    const d = await db(); assert.strictEqual(d.clients.length, 1); assert.match(d.clients[0].name, /Sewing Studio/); assert.match(d.clients[0].address, /10 Chapel Street/);
    assert.strictEqual(d.items[0].name, 'Content work'); assert.strictEqual(d.items[0].rate, 22); assert.strictEqual(d.invoices.length, 0);
    assert(await pg.evaluate(() => Object.keys(localStorage).every(k => k.startsWith('igg_')))); });

  await t('settings: business, bank placeholders, accent + template change', async () => {
    await hash('settings');
    await setVal('[data-s="email"]', 'james@example.com'); await setVal('[data-s="bankName"]', 'Example Bank'); await setVal('[data-s="accountName"]', 'J Moriarty'); await setVal('[data-s="sortCode"]', '00-00-00'); await setVal('[data-s="accountNumber"]', '00000000');
    await setVal('[data-s="accentHex"]', '#0f766e'); let s = (await db()).settings; assert.strictEqual(s.accent, '#0f766e');
    assert(await pg.$eval('#setPreview .paper', e => e.getAttribute('style').includes('#0f766e')));
    await pg.click('.tpl-pick label:nth-child(2)'); await sleep(100); s = (await db()).settings; assert.strictEqual(s.template, 'modern'); assert(await pg.$('#setPreview .paper.t-modern'));
    await setVal('[data-s="accentHex"]', '#008080'); await pg.click('.tpl-pick label:nth-child(1)'); await sleep(100); assert.strictEqual((await db()).settings.template, 'classic'); });

  await t('logo upload stored as an image ref (data lives in IndexedDB), preview shows it', async () => {
    const png = path.join('/tmp', 'logo-test.png'); fs.copyFileSync(path.join(__dirname, '..', 'icon-192.png'), png);
    const inp = await pg.$('#logoFile'); await inp.uploadFile(png); await sleep(500);
    assert((await db()).settings.logo.startsWith('img:')); await sleep(300); assert(await pg.$eval('#setPreview .p-logo', e => e.src.startsWith('data:image/png')));
    await click('[data-act="rmLogo"]'); assert.strictEqual((await db()).settings.logo, ''); });

  await t('timesheet JSON import: 15 days / 112.5 h / £2,475.00 -> invoice', async () => {
    await hash('import'); const inp = await pg.$('#impFile'); await inp.uploadFile(path.join(SAMPLES, 'sewing_studio_timesheet_backup.json')); await sleep(400);
    await click('[data-act="impRange"]', 'All in file'); let x = await txt();
    assert.match(x, /15 sessions selected\s*·\s*112\.5 hours\s*·\s*£2,475\.00/); assert.match(x, /The Sewing Studio/);
    await click('[data-act="impCreate"]'); await sleep(200);
    assert.strictEqual(await pg.$$eval('#lines .lrow:not(.hd)', r => r.length), 15);
    assert.match(await pg.$eval('#edTotals', e => e.innerText), /Total\s*£2,475\.00/);
    assert.strictEqual(await pg.$eval('[data-l="0:desc"]', e => e.value), 'Content work – 21/10/2026 (09:30–17:00)');
    assert.strictEqual(await pg.$eval('[data-f="clientId"] option:checked', e => e.textContent), 'The Sewing Studio');
    await shot('invoice-editor-desktop', 1280, 1000);
    await click('[data-act="edSave"]'); await sleep(200);
    const d = await db(); assert.strictEqual(d.invoices[0].number, 'INV-0001'); assert.strictEqual(Object.keys(d.imported).length, 15); assert.strictEqual(d.settings.nextInvoice, 2);
    assert.strictEqual(d.invoices[0].dueDate, require('../logic.js').addDays(d.invoices[0].issueDate, 14)); });

  await t('re-importing the CSV does not double-invoice (badge shown, nothing selectable)', async () => {
    await hash('import'); await pg.evaluate(() => window.__igg.state()); const inp = await pg.$('#impFile'); await inp.uploadFile(path.join(SAMPLES, 'sewing_studio_timesheet.csv')); await sleep(400);
    await click('[data-act="impRange"]', 'All in file'); const x = await txt();
    assert.match(x, /0 sessions selected/); assert.strictEqual((x.match(/Invoiced INV-0001/gi) || []).length, 15);
    assert(await pg.$eval('[data-act="impCreate"]', e => e.disabled)); });

  await t('mark sent -> overdue after due date -> mark paid with date', async () => {
    await hash('invoices'); await click('.li:not(.hd)'); await sleep(150);
    assert.match(await txt('h1'), /INV-0001\s*Draft/i); await click('[data-act="markSent"]'); assert.match(await txt('h1'), /Sent/i);
    await pg.evaluate(() => { const d = JSON.parse(localStorage.getItem('igg_invoices')); d[0].dueDate = '2026-11-10'; localStorage.setItem('igg_invoices', JSON.stringify(d)); location.reload(); }); await sleep(500);
    assert.match(await txt('h1'), /Overdue/i);
    await click('[data-act="markPaid"]'); await setVal('#paidDate', '2026-11-11'); await click('#modalBg [data-mb="1"]'); await sleep(150);
    assert.match(await txt('h1'), /Paid/i); assert(await pg.$('.p-stamp')); });

  await t('print layout: A4, single page, no app chrome', async () => {
    await pg.emulateMediaType('print'); const vis = await pg.evaluate(() => ['#topbar', '#sidebar', '#tabbar', '.doc-actions'].map(s => { const e = document.querySelector(s); return !e || getComputedStyle(e).display === 'none'; }));
    assert.deepStrictEqual(vis, [true, true, true, true]);
    const pdf = await pg.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }); fs.writeFileSync('/tmp/invoice-print.pdf', pdf);
    const info = require('child_process').execSync('pdfinfo /tmp/invoice-print.pdf').toString(); const pages = +/Pages:\s+(\d+)/.exec(info)[1]; assert(/A4/.test(info), 'A4 size: ' + info);
    console.log('     print pages (15-line paid invoice):', pages); assert.strictEqual(pages, 1);
    const t0 = require('child_process').execSync('pdftotext -layout /tmp/invoice-print.pdf -').toString(); assert(/INV-0001/.test(t0) && /£2,475\.00/.test(t0) && !/Dashboard|Export CSV|Mark paid/.test(t0), 'print has only the invoice');
    await pg.emulateMediaType('screen'); });

  await t('Download PDF builds a text-based A4 PDF (selectable text, £ and – survive)', async () => {
    await pg.setViewport({ width: 390, height: 844, isMobile: true }); await sleep(100); // mobile viewport must not matter
    await click('[data-act="pdf"]'); let f; for (let i = 0; i < 40 && !f; i++) { await sleep(300); f = fs.readdirSync(dl).find(n => /^INV-0001.*\.pdf$/.test(n)); }
    await pg.setViewport({ width: 1280, height: 800 }); assert(f, 'PDF downloaded');
    const info = require('child_process').execSync('pdfinfo "' + path.join(dl, f) + '"').toString(); assert(/A4/.test(info), info);
    const txt = require('child_process').execSync('pdftotext -layout "' + path.join(dl, f) + '" -').toString();
    assert(/INV-0001/.test(txt) && /The Sewing Studio/.test(txt) && /£2,475\.00/.test(txt) && /Content work . 21\/10\/2026 \(09:30.17:00\)/.test(txt) && /Bank: Example Bank/.test(txt), txt.slice(0, 600));
    console.log('     PDF:', f, (info.match(/Pages:\s+\d+/) || [''])[0], '· text dash char:', JSON.stringify((txt.match(/Content work (.) 21/) || [])[1]));
    require('child_process').execSync('pdftoppm -r 60 -png "' + path.join(dl, f) + '" /tmp/dlpdf'); });

  await t('service worker caches the shell: app reloads offline', async () => {
    await pg.evaluate(() => navigator.serviceWorker.ready.then(() => 1)); await sleep(500); await pg.reload(); await sleep(500);
    await pg.setOfflineMode(true); await pg.reload({ waitUntil: 'domcontentloaded' }); await sleep(600);
    assert.match(await txt('#topbar'), /Invoice\s*GoGo/); assert((await txt('#page')).length > 20); await pg.setOfflineMode(false); });

  await t('delete invoice releases timesheet sessions', async () => {
    await click('[data-act="delDoc"]'); await sleep(200); const d = await db(); assert.strictEqual(d.invoices.length, 0); assert.strictEqual(Object.keys(d.imported).length, 0); });

  await t('manual invoice: discount + VAT totals, numbering continues', async () => {
    await hash('invoice/new'); await sleep(100);
    assert.match(await txt('#edNum'), /INV-0002/);
    await setVal('[data-f="clientId"]', (await db()).clients[0].id);
    await setVal('[data-l="0:desc"]', 'Product photography'); await setVal('[data-l="0:qty"]', '10'); await setVal('[data-l="0:rate"]', '22'); await setVal('[data-l="0:unit"]', 'hour');
    await click('[data-act="edAddLine"]'); await setVal('[data-l="1:desc"]', 'Props'); await setVal('[data-l="1:qty"]', '1'); await setVal('[data-l="1:rate"]', '80.50');
    await setVal('[data-f="discountValue"]', '10'); await setVal('[data-f="vatOn"]', true); await setVal('[data-f="terms"]', '30');
    assert.match(await txt('#edTotals'), /Subtotal\s*£300\.50[\s\S]*Discount\s*-£30\.05[\s\S]*VAT 20%\s*£54\.09[\s\S]*Total\s*£324\.54/);
    assert.strictEqual(await pg.$eval('[data-f="dueDate"]', e => e.value), require('../logic.js').addDays(require('../logic.js').todayYMD(), 30));
    await setVal('[data-f="lateNote"]', true); await setVal('[data-f="notes"]', 'Thanks!');
    await click('[data-act="edSave"]'); await sleep(200); const d = await db(); assert.strictEqual(d.invoices[0].number, 'INV-0002');
    assert.match(await txt('#paper'), /Statutory interest may be charged/); assert.match(await txt('#paper'), /Bank: Example Bank/); assert.match(await txt('#paper'), /Reference: INV-0002/); });

  await t('estimate -> convert to invoice', async () => {
    await hash('estimate/new'); await setVal('[data-f="clientId"]', (await db()).clients[0].id); await setVal('[data-l="0:desc"]', 'Lookbook shoot'); await setVal('[data-l="0:rate"]', '400');
    await click('[data-act="edSave"]'); await sleep(200); assert.match(await txt('h1'), /EST-0001/); await click('[data-act="convert"]'); await sleep(200);
    assert.match(await txt('h1'), /INV-0003/); const d = await db(); assert.strictEqual(d.invoices.find(x => x.number === 'EST-0001').convertedTo, d.invoices.find(x => x.number === 'INV-0003').id);
    await hash('estimates'); assert.match(await txt(), /Converted/); });

  await t('client, project, item, expense CRUD + receipt photo', async () => {
    await hash('clients'); await click('[data-act="newClient"]'); await setVal('#modalBg [data-k="name"]', 'Test Client Ltd'); await setVal('#modalBg [data-k="email"]', 't@example.com'); await click('#modalBg [data-mb]', 'Save'); await sleep(150);
    assert.match(await txt(), /Test Client Ltd/);
    await hash('projects'); await click('[data-act="newProject"]'); await setVal('#modalBg [data-k="name"]', 'Spring shoot'); await setVal('#modalBg [data-k="clientId"]', (await db()).clients[0].id); await click('#modalBg [data-mb]', 'Save'); await sleep(150);
    assert.match(await txt(), /Spring shoot/);
    await hash('items'); await click('[data-act="newItem"]'); await setVal('#modalBg [data-k="name"]', 'Editing'); await setVal('#modalBg [data-k="rate"]', '30'); await click('#modalBg [data-mb]', 'Save'); await sleep(150); assert.match(await txt(), /Editing/);
    await hash('expenses'); await click('[data-act="newExpense"]'); await setVal('#modalBg [data-k="amount"]', '49.99'); await setVal('#modalBg [data-k="note"]', 'Reflector'); await setVal('#modalBg [data-k="projectId"]', (await db()).projects[0].id);
    await (await pg.$('#modalBg input[type=file]')).uploadFile(path.join(__dirname, '..', 'icon-192.png')); await sleep(500); await click('#modalBg [data-mb]', 'Save'); await sleep(200);
    const d = await db(); assert.strictEqual(d.expenses[0].amount, 49.99); assert(d.expenses[0].receipt.startsWith('img:')); assert(await pg.$('img.thumb')); });

  await t('dashboard & reports numbers', async () => {
    await pg.evaluate(() => { const d = JSON.parse(localStorage.getItem('igg_invoices')); const i = d.find(x => x.number === 'INV-0002'); i.status = 'paid'; i.paidDate = new Date().toISOString().slice(0, 7) + '-05'; localStorage.setItem('igg_invoices', JSON.stringify(d)); location.hash = '#/dashboard'; location.reload(); }); await sleep(500);
    const x = await txt(); assert.match(x, /PAID THIS MONTH\s*£324\.54/i); assert.match(x, /EXPENSES THIS MONTH\s*£49\.99/i);
    await hash('reports'); const r = await txt(); assert.match(r, /INCOME RECEIVED\s*£324\.54/i); assert.match(r, /PROFIT\s*£274\.55/i);
    await click('[data-act="repCSV"]'); await sleep(500); const f = fs.readdirSync(dl).find(n => /report/.test(n)); assert(f); assert.match(fs.readFileSync(path.join(dl, f), 'utf8'), /Income received,324\.55|Income received,324\.54/); });

  await t('backup & restore roundtrip', async () => {
    await hash('settings'); await click('[data-act="backup"]'); await sleep(600); const f = fs.readdirSync(dl).find(n => /backup/.test(n)); assert(f);
    const j = JSON.parse(fs.readFileSync(path.join(dl, f), 'utf8')); assert.strictEqual(j.app, 'invoice-gogo'); assert(j.data.invoices.length >= 3);
    await pg.evaluate(() => { ['clients', 'invoices', 'items', 'expenses', 'projects', 'settings', 'imported'].forEach(k => localStorage.removeItem('igg_' + k)); }); await pg.reload(); await sleep(300); assert.strictEqual((await db()).invoices.length, 0);
    await hash('settings'); await (await pg.$('#restoreFile')).uploadFile(path.join(dl, f)); await sleep(500); const d = await db(); assert.strictEqual(d.invoices.length, j.data.invoices.length); assert.strictEqual(d.expenses.length, 1); });

  await t('demo data load/remove leaves real data intact', async () => {
    const before = await db(); await hash('settings'); await click('[data-act="loadDemo"]'); await sleep(200); let d = await db();
    assert(d.invoices.some(x => x.demo)); assert(d.clients.some(x => x.demo)); const n = d.invoices.length;
    await hash('invoices'); assert.match(await txt(), /demo/i); await hash('settings'); await click('[data-act="removeDemo"]'); await sleep(200); d = await db();
    assert.strictEqual(d.invoices.length, before.invoices.length); assert.strictEqual(d.settings.nextInvoice, before.settings.nextInvoice); assert.strictEqual(d.expenses.length, before.expenses.length); });

  // ---- screenshots with demo data + realistic settings ----
  const srv2 = await startDevServer({ port: 8766 }); await pg.goto('http://localhost:8766/'); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await unlock();
  await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('igg_settings')); Object.assign(s, { email: 'james@example.com', phone: '07000 000000', address: 'Cornwall, UK', bankName: 'Example Bank', accountName: 'J Moriarty', sortCode: '00-00-00', accountNumber: '00000000', lateNote: true, template: 'modern' }); localStorage.setItem('igg_settings', JSON.stringify(s)); }); await pg.reload(); await sleep(300);
  await hash('settings'); await click('[data-act="loadDemo"]'); await sleep(300);
  // import screens first (nothing invoiced yet). Viewport switches reload the page, so upload again after each.
  const upload = async () => { await hash('import'); await (await pg.$('#impFile')).uploadFile(path.join(SAMPLES, 'sewing_studio_timesheet_backup.json')); await sleep(400); await click('[data-act="impRange"]', 'All in file'); };
  await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await upload(); await shot('import-screen-mobile', null, null, 330);
  await pg.setViewport({ width: 1280, height: 1200 }); await upload(); await shot('import-screen-desktop');
  await click('[data-act="impCreate"]'); await sleep(200); await click('[data-act="edSave"]'); await sleep(200);
  await click('[data-act="markSent"]');
  const inv1 = (await db()).invoices.find(x => !x.demo).id;
  await pg.setViewport({ width: 1280, height: 800 });
  await hash('dashboard'); await shot('dashboard-desktop', 1280, 800);
  await hash('invoice/' + inv1); await shot('invoice-preview-desktop', 1280, 1500);
  await hash('invoice/new'); await setVal('[data-f="clientId"]', (await db()).clients[1].id); await setVal('[data-l="0:desc"]', 'Product shoot – half day'); await setVal('[data-l="0:qty"]', '2'); await setVal('[data-l="0:rate"]', '150'); await shot('invoice-editor-desktop', 1280, 1000);
  await click('[data-act="edCancel"]');
  // mobile
  await hash('dashboard'); await shot('dashboard-mobile', 390, 844);
  await hash('invoice/new'); await setVal('[data-f="clientId"]', (await db()).clients[1].id); await setVal('[data-l="0:desc"]', 'Product shoot – half day'); await setVal('[data-l="0:qty"]', '2'); await setVal('[data-l="0:rate"]', '150'); await shot('invoice-editor-mobile', 390, 844);
  await click('[data-act="edCancel"]');
  await hash('invoice/' + inv1); await shot('invoice-preview-mobile', 390, 844);
  await hash('invoices'); await shot('invoices-mobile', 390, 844);
  await pg.setViewport({ width: 1280, height: 800 }); await hash('settings'); await shot('settings-design-desktop', 1280, 1100);
  await hash('reports'); await shot('reports-desktop', 1280, 900); await hash('cashflow'); await shot('cashflow-desktop', 1280, 900);

  assert.strictEqual(errs.length, 0, 'console/page errors:\n' + errs.join('\n'));
  console.log(pass + ' e2e checks passed'); await b.close(); await srv1.close(); await srv2.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
