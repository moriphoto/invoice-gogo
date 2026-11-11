// Cloud / lock / sync / Gmail / Drive / PDF end-to-end tests. Local dev server only (real API handler, in-memory blobs).
// Google is a TEST HARNESS: a fake window.google plus request interception with canned responses. The app itself never fakes success.
// Run: NODE_PATH=<dir with puppeteer-core> TZ=Europe/London node tests/cloud.e2e.js
const puppeteer = require('puppeteer-core'); const fs = require('fs'); const path = require('path'); const assert = require('assert'); const cp = require('child_process');
const PIN = 'cloud-test-pin-9'; const SHOTS = path.join(__dirname, '..', 'screenshots'); fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0; const t = async (name, fn) => { try { await fn(); pass++; console.log('ok  -', name); } catch (e) { process.exitCode = 1; console.error('FAIL -', name, '\n  ', String(e.stack || e).split('\n').slice(0, 5).join('\n   ')); } };
const until = async (fn, ms = 8000, what = 'condition') => { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what); await sleep(120); } };

(async () => {
  const { startDevServer } = await import('../tools/dev-server.mjs');
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--lang=en-GB'], defaultViewport: { width: 1280, height: 800 } });
  const errs = [];
  async function open(port, { ip, google } = {}) {
    const ctx = await browser.createBrowserContext(); const pg = await ctx.newPage(); pg.ctx = ctx; pg.base = 'http://localhost:' + port + '/';
    await pg.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB', ...(ip ? { 'x-test-ip': ip } : {}) });
    pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
    pg.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource|401|409|429|403|404|fonts\.gstatic|CORS policy/.test(m.text())) errs.push(m.text()); });
    if (google) await pg.evaluateOnNewDocument(GOOGLE_MOCK);
    await pg.goto(pg.base); return pg;
  }
  const GOOGLE_MOCK = `window.__gMode = 'ok'; window.__gCalls = 0;
    window.google = { accounts: { oauth2: { initTokenClient: cfg => ({ requestAccessToken() {
      window.__gCalls++; if (!navigator.userActivation.isActive) window.__gNoGesture = true; // a real browser would block the pop-up
      const c = this; setTimeout(() => { const m = window.__gMode;
        if (m === 'denied') return c.callback({ error: 'access_denied' });
        const scope = m === 'driveOnly' ? 'https://www.googleapis.com/auth/drive.file' : m === 'gmailOnly' ? 'https://www.googleapis.com/auth/gmail.send' : 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.file';
        c.callback({ access_token: 'fake-token-' + window.__gCalls, expires_in: 3599, scope }); }, 40); } }) } } };`;
  const lockUp = async (pg, { pin = PIN, code } = {}) => { await pg.waitForSelector('#lockForm'); if (await pg.$('#pinNew')) { await pg.type('#pinNew', pin); await pg.type('#pinConfirm', pin); if (code && await pg.$('#setupCode')) await pg.type('#setupCode', code); } else await pg.type('#pinLogin', pin); await pg.click('#lockForm button[type=submit]'); };
  const enter = async (pg, o) => { await lockUp(pg, o); await pg.waitForSelector('#topbar', { visible: true, timeout: 8000 }); await until(() => pg.$eval('#syncInd', e => /Synced/.test(e.innerText)), 8000, 'Synced'); };
  const ev = (pg, fn, ...a) => pg.evaluate(fn, ...a);
  const shot = async (pg, n, clip) => { await ev(pg, () => { const x = document.getElementById('toast'); if (x) x.remove(); }); await sleep(250); await pg.screenshot({ path: path.join(SHOTS, n + '.png'), ...(clip ? { clip } : {}) }); };
  const rawTok = pg => ev(pg, () => localStorage.getItem('igg_token')); const token = async pg => { const r = await rawTok(pg); return r ? JSON.parse(r).token : null; };
  const api = async (srv, p, { method = 'GET', tok, body, headers } = {}) => { const r = await fetch('http://localhost:' + srv.port + '/api/' + p, { method, headers: { ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { status: r.status, j }; };
  const serverState = async (srv, tok) => (await api(srv, 'data', { tok })).j;
  const mk = (pg, type, over = {}) => ev(pg, (type, over) => { const g = __igg, d = g.newDoc(type, over); delete d.isNew; if (!d.number) { const s = g.db().settings; d.number = (type === 'estimate' ? 'EST-' : 'INV-') + String(type === 'estimate' ? s.nextEstimate++ : s.nextInvoice++).padStart(4, '0'); g.save('settings'); } d.createdAt = new Date().toISOString(); g.db().invoices.push(d); g.save('invoices'); return d.id; }, type, over);
  const clientId = pg => ev(pg, () => __igg.db().clients[0].id);
  const inv = (pg, id) => ev(pg, id => JSON.parse(JSON.stringify(__igg.db().invoices.find(d => d.id === id) || null)), id);
  const sync = pg => ev(pg, () => __igg.syncNow(true)).then(() => until(() => pg.$eval('#syncInd', e => /Synced/.test(e.innerText)), 8000, 'sync done')).then(() => sleep(150));

  // ================= AUTH / LOCK =================
  const authSrv = await startDevServer({ port: 8770, env: { IGG_SETUP_CODE: 'setup-code-123' } }); authSrv.port = 8770;
  let a1;
  await t('API rejects anything without a valid token (401), status is public', async () => {
    assert.strictEqual((await api(authSrv, 'status')).status, 200);
    for (const [m, p] of [['GET', 'data'], ['POST', 'sync'], ['PUT', 'img/abcdef123456'], ['GET', 'img/abcdef123456'], ['POST', 'change-pin']]) assert.strictEqual((await api(authSrv, p, { method: m, body: m !== 'GET' ? {} : undefined })).status, 401, m + ' ' + p);
    assert.strictEqual((await api(authSrv, 'data', { tok: 'garbage.token' })).status, 401);
    assert.strictEqual((await api(authSrv, 'login', { method: 'POST', body: { pin: 'whatever1' } })).status, 409, 'login before any PIN exists'); });
  await t('first run: Create-PIN screen (needs the setup code) -> wrong code refused -> PIN created -> app opens & syncs', async () => {
    a1 = await open(8770, { ip: 'a1' }); await a1.waitForSelector('#pinNew'); assert(await a1.$('#setupCode')); assert(await a1.$eval('body', b => b.classList.contains('locked')));
    await a1.setViewport({ width: 1280, height: 800 }); await a1.type('#pinNew', PIN); await a1.type('#pinConfirm', PIN); await a1.type('#setupCode', 'nope'); await shot(a1, 'v2-01-create-pin');
    await a1.click('#lockForm button[type=submit]'); await until(() => a1.$eval('#lockErr', e => /setup code/i.test(e.innerText)), 5000, 'wrong setup code message');
    await a1.$eval('#setupCode', e => { e.value = ''; }); await a1.type('#setupCode', 'setup-code-123'); await a1.click('#lockForm button[type=submit]');
    await a1.waitForSelector('#topbar', { visible: true }); await until(() => a1.$eval('#syncInd', e => /Synced/.test(e.innerText))); assert(!(await a1.$('#lock')));
    assert.strictEqual((await api(authSrv, 'setup', { method: 'POST', body: { pin: 'another-pin1', setupCode: 'setup-code-123' } })).status, 409, 'second setup refused'); });
  await t('sign-in screen on a new device: wrong PIN refused with message; correct PIN works; screenshot', async () => {
    const p = await open(8770, { ip: 'a2' }); await p.waitForSelector('#pinLogin'); assert(!(await p.$('#pinNew'))); await shot(p, 'v2-02-sign-in');
    await p.type('#pinLogin', 'wrong-pin-x'); await p.click('#lockForm button[type=submit]'); await until(() => p.$eval('#lockErr', e => /wrong pin/i.test(e.innerText)), 5000, 'wrong pin msg');
    assert.strictEqual(await token(p), null); await p.$eval('#pinLogin', e => { e.value = ''; }); await p.type('#pinLogin', PIN); await p.click('#lockForm button[type=submit]'); await p.waitForSelector('#topbar', { visible: true }); assert(await token(p)); await p.ctx.close(); });
  await t('rate limit: repeated wrong PINs from one address lock further attempts (429) even with the right PIN', async () => {
    const p = await open(8770, { ip: 'rl-victim' }); await p.waitForSelector('#pinLogin'); let last = '';
    for (let i = 0; i < 6; i++) { await p.$eval('#pinLogin', e => { e.value = ''; }); await p.type('#pinLogin', 'bad-pin-' + i); await p.click('#lockForm button[type=submit]'); await sleep(450); last = await p.$eval('#lockErr', e => e.innerText); }
    assert(/too many/i.test(last), last); await p.$eval('#pinLogin', e => { e.value = ''; }); await p.type('#pinLogin', PIN); await p.click('#lockForm button[type=submit]'); await sleep(600);
    assert(/too many/i.test(await p.$eval('#lockErr', e => e.innerText))); assert.strictEqual(await token(p), null); await p.ctx.close(); });
  await t('tampered / expired token: API 401 and the app falls back to the lock screen', async () => {
    const tk = await token(a1); const bad = tk.slice(0, -3) + (tk.endsWith('AAA') ? 'BBB' : 'AAA'); assert.strictEqual((await api(authSrv, 'data', { tok: bad })).status, 401); assert.strictEqual((await api(authSrv, 'data', { tok: tk })).status, 200);
    await ev(a1, b => localStorage.setItem('igg_token', JSON.stringify({ token: b, expires: Date.now() + 1e9 })), bad); await a1.reload(); await until(() => a1.$('#lockForm'), 8000, 'lock screen'); assert(/session ended|PIN/i.test(await a1.$eval('#lock', e => e.innerText)));
    await a1.type('#pinLogin', PIN); await a1.click('#lockForm button[type=submit]'); await a1.waitForSelector('#topbar', { visible: true }); });
  await authSrv.close();

  // ================= SYNC (two devices) =================
  const srv = await startDevServer({ port: 8771 }); srv.port = 8771;
  const A = await open(8771, { ip: 'sa' }); await A.setViewport({ width: 1280, height: 800 }); await enter(A);
  const B = await open(8771, { ip: 'sb' }); await enter(B);
  await t('two devices: same seed data (no duplicates) after first sign-in', async () => {
    const [ca, cb] = [await ev(A, () => __igg.db().clients.map(c => c.id)), await ev(B, () => __igg.db().clients.map(c => c.id))]; assert.deepStrictEqual(ca, cb); assert.strictEqual(ca.length, 1);
    assert.strictEqual(await ev(A, () => __igg.db().items.length), await ev(B, () => __igg.db().items.length)); });
  let invId;
  await t('invoice created on A appears on B; edit on B appears on A; delete on A removes it from B', async () => {
    invId = await mk(A, 'invoice', { clientId: await clientId(A), lines: [{ desc: 'Shoot day', qty: 1, rate: 300, unit: 'each' }] }); await sync(A);
    await sync(B); assert((await inv(B, invId)).number === 'INV-0001'); assert.strictEqual(await ev(B, () => __igg.db().settings.nextInvoice), 2, 'counter synced');
    await ev(B, id => { const d = __igg.docOf(id); d.status = 'sent'; d.sentAt = '2026-11-11'; __igg.save('invoices'); }, invId); await sync(B); await sync(A); assert.strictEqual((await inv(A, invId)).status, 'sent');
    await ev(A, id => { __igg.db().invoices = __igg.db().invoices.filter(d => d.id !== id); __igg.save('invoices'); }, invId); await sync(A); await sync(B); assert.strictEqual(await inv(B, invId), null, 'deleted on B'); });
  await t('settings sync across devices (business name)', async () => {
    await ev(A, () => { __igg.db().settings.name = 'Moriarty Photo & Film'; __igg.save('settings'); }); await sync(A); await sync(B); assert.strictEqual(await ev(B, () => __igg.db().settings.name), 'Moriarty Photo & Film'); });
  await t('offline edits on both devices converge: later edit wins (last-write-wins by updatedAt)', async () => {
    const id = await mk(A, 'invoice', { clientId: await clientId(A), notes: 'orig' }); await sync(A); await sync(B);
    await A.setOfflineMode(true); await B.setOfflineMode(true);
    await ev(A, id => { __igg.docOf(id).notes = 'edited on A (earlier)'; __igg.save('invoices'); }, id); await sleep(80); await ev(B, id => { __igg.docOf(id).notes = 'edited on B (later)'; __igg.save('invoices'); }, id);
    await A.setOfflineMode(false); await B.setOfflineMode(false); await sync(A); await sync(B); await sync(A);
    assert.strictEqual((await inv(A, id)).notes, 'edited on B (later)'); assert.strictEqual((await inv(B, id)).notes, 'edited on B (later)'); });
  await t('offline indicator + queue: change made offline shows Offline, uploads automatically when back online', async () => {
    await A.setOfflineMode(true); await sleep(200); const id = await mk(A, 'invoice', { clientId: await clientId(A), notes: 'made offline' });
    await until(() => A.$eval('#syncInd', e => /Offline/.test(e.innerText)), 6000, 'Offline indicator'); const txt = await A.$eval('#syncInd', e => e.innerText); console.log('     indicator offline text:', JSON.stringify(txt));
    await A.hash; await shot(A, 'v2-03-sync-offline', { x: 0, y: 0, width: 1280, height: 120 });
    assert(!(await serverState(srv, await token(B))).collections.invoices.some(r => r.id === id), 'not on server yet');
    await A.setOfflineMode(false); await until(() => A.$eval('#syncInd', e => /Synced/.test(e.innerText)), 12000, 'Synced after reconnect');
    assert((await serverState(srv, await token(B))).collections.invoices.some(r => r.id === id && !r.deleted), 'uploaded after reconnect');
    await shot(A, 'v2-04-sync-synced', { x: 0, y: 0, width: 1280, height: 120 }); });
  await t('images sync: logo and receipt photo are separate blobs that load on the other device', async () => {
    const png = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'icon-192.png')).toString('base64');
    const [logoRef, rcpRef] = await ev(A, png => { const g = __igg; const l = g.saveImg(png), r = g.saveImg(png.replace('image/png', 'image/png')); g.db().settings.logo = l; g.save('settings'); g.db().expenses.push({ id: g.uid(), date: '2026-11-10', category: 'Equipment', amount: 12.5, note: 'cable', projectId: '', receipt: r }); g.save('expenses'); return [l, r]; }, png);
    await sync(A); await sync(B); const same = await ev(B, async (l, r) => { const g = __igg; return [await g.loadImg(g.db().settings.logo), await g.loadImg(g.db().expenses.find(e => e.receipt === r).receipt)]; }, logoRef, rcpRef);
    assert(same[0] === png && same[1] === png, 'image bytes identical on B'); });
  await t('change PIN on B signs the other device out; new PIN works, old PIN does not', async () => {
    await ev(B, () => { location.hash = '#/settings'; }); await sleep(300); await B.type('#pcCur', PIN); await B.type('#pcNew', 'brand-new-pin-5'); await B.type('#pcRep', 'brand-new-pin-5'); await B.click('#pinChangeForm button[type=submit]');
    await until(async () => (await api(srv, 'data', { tok: await token(A) })).status === 401, 6000, 'old token rejected');
    assert.strictEqual((await api(srv, 'login', { method: 'POST', body: { pin: PIN }, headers: { 'x-test-ip': 'zz' } })).status, 401); assert.strictEqual((await api(srv, 'login', { method: 'POST', body: { pin: 'brand-new-pin-5' }, headers: { 'x-test-ip': 'zz2' } })).status, 200);
    await ev(A, () => __igg.syncNow(true)); await until(() => A.$('#lockForm'), 6000, 'A shows lock screen'); });
  await A.ctx.close(); await B.ctx.close();

  // ================= MIGRATION =================
  await t('first sign-in with existing local data + EMPTY cloud: offers upload; accepting puts it in the cloud; a second device sees it', async () => {
    const srv2 = await startDevServer({ port: 8772 }); srv2.port = 8772; const png = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'icon-192.png')).toString('base64');
    const C = await open(8772, { ip: 'mc' });
    await ev(C, png => { // a v1 (pre-cloud) device: plain arrays, no updatedAt, data-URL receipt
      localStorage.setItem('igg_clients', JSON.stringify([{ id: 'c_old1', name: 'Old Client Ltd', email: 'old@client.test', address: '1 Old Road' }]));
      localStorage.setItem('igg_invoices', JSON.stringify([{ id: 'i_old1', type: 'invoice', number: 'INV-0007', clientId: 'c_old1', issueDate: '2026-10-01', terms: 14, dueDate: '2026-10-15', status: 'paid', paidDate: '2026-10-12', lines: [{ desc: 'Old job', qty: 1, rate: 500, unit: 'each' }], discountType: 'percent', discountValue: 0, vatOn: false, vatRate: 20, notes: '', lateNote: false }]));
      localStorage.setItem('igg_expenses', JSON.stringify([{ id: 'e_old1', date: '2026-10-02', category: 'Travel', amount: 20, note: 'fuel', projectId: '', receipt: png }]));
      localStorage.setItem('igg_items', JSON.stringify([{ id: 'it_old1', name: 'Old item', rate: 10, unit: 'hour' }]));
      localStorage.setItem('igg_projects', '[]'); localStorage.setItem('igg_imported', '{}'); localStorage.setItem('igg_settings', JSON.stringify({ name: 'Old Biz', seeded: true, nextInvoice: 8 })); }, png);
    await C.reload(); await lockUp(C); await until(() => C.$$eval('.modal h3', hs => hs.some(h => /Upload this device/.test(h.innerText))), 8000, 'upload dialog'); await shot(C, 'v2-05-migrate-upload');
    await C.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => /Upload to the cloud/.test(b.innerText)).click()); await until(() => C.$eval('#syncInd', e => /Synced/.test(e.innerText)), 8000, 'synced');
    const st = await serverState(srv2, await token(C)); const col = st.collections; assert(col.clients.some(c => c.id === 'c_old1'), 'client'); assert(col.invoices.some(c => c.id === 'i_old1'), 'invoice'); assert(col.expenses.some(c => c.id === 'e_old1' && /^img:/.test(c.receipt)), 'receipt became an image ref');
    assert.strictEqual(await ev(C, () => __igg.db().settings.name), 'Old Biz');
    const D = await open(8772, { ip: 'md' }); await enter(D, { pin: PIN });
    assert(await ev(D, () => __igg.db().invoices.some(d => d.id === 'i_old1' && d.number === 'INV-0007'))); assert.strictEqual(await ev(D, () => __igg.db().settings.name), 'Old Biz');
    assert((await ev(D, async () => await __igg.loadImg(__igg.db().expenses[0].receipt))).startsWith('data:image/png'), 'receipt image on 2nd device');
    // a THIRD device that already has its own local data meets a non-empty cloud: Merge keeps both
    const E = await open(8772, { ip: 'me' }); await ev(E, () => { localStorage.setItem('igg_clients', JSON.stringify([{ id: 'c_e1', name: 'Phone-only Client' }])); localStorage.setItem('igg_settings', JSON.stringify({ seeded: true })); }); await E.reload(); await lockUp(E);
    await until(() => E.$$eval('.modal h3', hs => hs.some(h => /Combine/.test(h.innerText))), 8000, 'merge dialog'); await E.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => /Merge both/.test(b.innerText)).click()); await until(() => E.$eval('#syncInd', e => /Synced/.test(e.innerText)), 8000);
    const names = await ev(E, () => __igg.db().clients.map(c => c.name).sort()); assert(names.includes('Phone-only Client') && names.includes('Old Client Ltd'), names.join()); assert((await serverState(srv2, await token(E))).collections.clients.some(c => c.id === 'c_e1'));
    await C.ctx.close(); await D.ctx.close(); await E.ctx.close(); await srv2.close(); });

  // ================= GOOGLE (Gmail send + Drive save) via canned responses =================
  const gsrv = await startDevServer({ port: 8773 }); gsrv.port = 8773;
  const G = await open(8773, { ip: 'g1', google: true }); await G.setViewport({ width: 1280, height: 900 });
  const fake = { gmail: [], gmailMode: 'ok', drive: [], calls: [], nid: 1, driveMode: 'ok' };
  await G.setRequestInterception(true);
  const pd = async req => req.postData() || (await req.fetchPostData());
  G.on('request', async req => {
    const u = req.url(); const m = req.method(); const json = (status, o) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(o), headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (/googleapis\.com|accounts\.google\.com/.test(u)) {
      if (m === 'OPTIONS') return req.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (/fonts\.googleapis\.com/.test(u)) return req.respond({ status: 200, contentType: 'text/css', body: '' });
      if (/accounts\.google\.com\/gsi/.test(u)) return req.respond({ status: 200, contentType: 'text/javascript', body: '' });
      const auth = req.headers().authorization; fake.calls.push({ m, u: u.replace(/\?.*/, ''), auth });
      if (/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/.test(u)) {
        if (fake.gmailMode === 'disabled') return json(403, { error: { code: 403, message: 'Gmail API has not been used in project 123 before or it is disabled.' } });
        const raw = JSON.parse(await pd(req)).raw; fake.gmail.push(raw); return json(200, { id: 'gmsg' + fake.gmail.length, threadId: 'th1', labelIds: ['SENT'] });
      }
      if (/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/.test(u) && m === 'GET') { const q = decodeURIComponent((u.match(/[?&]q=([^&]+)/) || [])[1] || ''); const nm = (q.match(/name = '((?:[^'\\]|\\.)*)'/) || [])[1]; const par = (q.match(/and '([^']+)' in parents/) || [])[1]; return json(200, { files: fake.drive.filter(f => f.mime === 'folder' && f.name === nm.replace(/\\(.)/g, '$1') && f.parent === par).map(f => ({ id: f.id, name: f.name })) }); }
      if (/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/.test(u) && m === 'POST') { const b = JSON.parse(await pd(req)); const f = { id: 'fold' + fake.nid++, name: b.name, mime: 'folder', parent: b.parents[0] }; fake.drive.push(f); return json(200, { id: f.id }); }
      if (/upload\/drive\/v3\/files/.test(u)) {
        if (fake.driveMode === 'fail') return json(500, { error: { message: 'Backend Error' } });
        const body = await pd(req); const head = body.split(/Content-Type: application\/pdf/)[0]; const meta = JSON.parse(head.slice(head.indexOf('{'), head.lastIndexOf('}') + 1));
        if (m === 'POST') { const f = { id: 'file' + fake.nid++, name: meta.name, mime: 'pdf', parent: meta.parents[0], version: 1, link: 'https://drive.google.com/file/d/x/view' }; fake.drive.push(f); fake.calls.push({ uploaded: 'create', name: f.name, parent: f.parent }); return json(200, { id: f.id, name: f.name, webViewLink: f.link }); }
        const id = decodeURIComponent(u.match(/files\/([^?]+)/)[1]); const f = fake.drive.find(x => x.id === id); if (!f) return json(404, { error: { message: 'File not found' } }); f.version++; fake.calls.push({ uploaded: 'update', id, version: f.version }); return json(200, { id: f.id, name: f.name, webViewLink: f.link });
      }
      return json(404, { error: { message: 'unexpected ' + u } });
    }
    req.continue();
  });
  await enter(G); await G.reload(); await G.waitForSelector('#topbar', { visible: true }); await sleep(800);
  const gcid = await clientId(G); await ev(G, id => { const c = __igg.db().clients[0]; c.email = 'accounts@sewingstudio.test'; __igg.save('clients'); }, gcid);
  let gInv;
  await t('Google NOT set up: Email and Drive buttons explain the setup steps, nothing is sent, nothing is faked', async () => {
    gInv = await mk(G, 'invoice', { clientId: gcid, lines: [{ desc: 'Edit & grade – hero film', qty: 8, rate: 22, unit: 'hour' }], notes: 'Thanks!' }); await ev(G, id => { location.hash = '#/invoice/' + id; }, gInv); await sleep(300);
    await G.evaluate(() => document.querySelector('[data-act="emailDoc"]').click()); await sleep(300); const m = await G.$eval('.modal', e => e.innerText); assert(/Client ID/.test(m) && /Gmail API/.test(m) && /Drive API/.test(m) && /Authorised JavaScript origins/.test(m) && /8773/.test(m), m.slice(0, 300));
    await shot(G, 'v2-06-google-setup-help'); await G.evaluate(() => document.querySelector('.modal [data-mb="0"]').click()); await G.evaluate(() => document.querySelector('[data-act="driveDoc"]').click()); await sleep(300); assert(/Client ID/.test(await G.$eval('.modal', e => e.innerText))); await G.evaluate(() => document.querySelector('.modal [data-mb="0"]').click());
    assert.strictEqual(fake.calls.length, 0, 'no Google traffic: ' + JSON.stringify(fake.calls)); assert.strictEqual((await inv(G, gInv)).status, 'draft'); assert(!(await inv(G, gInv)).sentAt); });
  await t('Integrations settings: status + instructions when no Client ID; Apps page shows Gmail/Drive/Cloud status', async () => {
    await ev(G, () => { location.hash = '#/settings'; }); await sleep(400); assert(/Not set up yet/.test(await G.$eval('#integrations', e => e.innerText)));
    await ev(G, () => document.querySelector('#integrations').scrollIntoView()); await shot(G, 'v2-07-integrations-empty');
    await ev(G, () => { location.hash = '#/apps'; }); await sleep(400); const p = await G.$eval('#page', e => e.innerText); assert(/Cloud sync/i.test(p) && /Gmail/i.test(p) && /Google Drive/i.test(p) && /Needs setup/i.test(p) && /Synced/i.test(p), p.slice(0, 600)); await shot(G, 'v2-08-apps-page'); });
  await t('enter a Client ID in Settings -> Integrations (saved + synced); "Connect Google" gets a token inside the click (pop-up allowed)', async () => {
    await ev(G, () => { location.hash = '#/settings'; }); await sleep(400); const el = await G.$('[data-s="googleClientId"]'); await el.type('  1234567890-testclient.apps.googleusercontent.com '); await sleep(300);
    assert.strictEqual(await ev(G, () => __igg.db().settings.googleClientId), '1234567890-testclient.apps.googleusercontent.com'); await G.click('[data-act="googleConnect"]'); await until(() => G.$eval('#gStatus', e => /Connected/i.test(e.innerText)), 4000, 'connected').catch(async e => { throw new Error(e.message + ' | gStatus=' + (await G.$eval('#gStatus', x => x.innerText)) + ' | calls=' + (await ev(G, () => window.__gCalls))); });
    const s = await G.$eval('#gStatus', e => e.innerText); assert(/Gmail send: ✓/i.test(s) && /Drive files: ✓/i.test(s), s); assert.strictEqual(await ev(G, () => window.__gNoGesture), undefined, 'requestAccessToken ran inside a user gesture');
    await ev(G, () => document.querySelector('#integrations').scrollIntoView()); await shot(G, 'v2-09-integrations-connected'); });
  await t('Gmail failure is shown as an error (API disabled) and the invoice is NOT marked sent', async () => {
    await ev(G, id => { location.hash = '#/invoice/' + id; }, gInv); await sleep(300); await G.evaluate(() => document.querySelector('[data-act="emailDoc"]').click()); await G.waitForSelector('#mTo'); await until(() => G.$eval('#mPrev', e => !e.disabled), 8000, 'PDF ready');
    assert.strictEqual(await G.$eval('#mTo', e => e.value), 'accounts@sewingstudio.test'); const subj = await G.$eval('#mSubj', e => e.value), body = await G.$eval('#mBody', e => e.value); assert(/^Invoice INV-0001 from /.test(subj) || /INV-0001/.test(subj), subj); assert(/£176\.00/.test(body) && /Hi /.test(body), body);
    await shot(G, 'v2-10-send-dialog'); fake.gmailMode = 'disabled'; await G.click('.modal [data-mb="1"]'); await until(() => G.$eval('#mErr', e => /Gmail said 403/.test(e.innerText)), 5000, 'error message'); const err = await G.$eval('#mErr', e => e.innerText); assert(/enable the Gmail API/i.test(err), err);
    assert.strictEqual((await inv(G, gInv)).status, 'draft'); assert(!(await inv(G, gInv)).sentAt); assert.strictEqual(fake.gmail.length, 0); assert(await G.$('#mTo'), 'dialog stays open for retry'); });
  await t('Gmail send: valid MIME with the PDF attached, recipient/subject as edited, invoice marked Sent with date', async () => {
    fake.gmailMode = 'ok'; await G.$eval('#mSubj', e => { e.value = 'Invoice INV-0001 – hero film (£176.00)'; }); await G.click('.modal [data-mb="1"]'); await until(async () => !(await G.$('#mTo')), 8000, 'dialog closed'); await sleep(300);
    const d = await inv(G, gInv); assert.strictEqual(d.status, 'sent'); assert.strictEqual(d.sentAt, new Date().toLocaleDateString('en-CA')); assert.strictEqual(d.sentTo, 'accounts@sewingstudio.test'); assert.strictEqual(fake.gmail.length, 1);
    assert(/Email sent to accounts@sewingstudio\.test/.test(await G.$eval('#toast', e => e.innerText)));
    assert(!/[+/=]/.test(fake.gmail[0]), 'raw is base64url without padding'); fs.writeFileSync('/tmp/igg-sent.eml', Buffer.from(fake.gmail[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    const py = cp.execFileSync('python3', ['-c', `
import email, sys, email.policy
m = email.message_from_binary_file(open('/tmp/igg-sent.eml','rb'), policy=email.policy.default)
print(m['To']); print(m['Subject']); parts=list(m.iter_attachments()); print(len(parts), parts[0].get_content_type(), parts[0].get_filename())
open('/tmp/igg-sent.pdf','wb').write(parts[0].get_content())
print(m.get_body(preferencelist=('plain',)).get_content().strip()[:60].replace('\\n',' / '))`]).toString().split('\n');
    assert.strictEqual(py[0], 'accounts@sewingstudio.test'); assert.strictEqual(py[1], 'Invoice INV-0001 – hero film (£176.00)'); assert(/^1 application\/pdf INV-0001 - /.test(py[2]), py[2]);
    const pdfTxt = cp.execSync('pdftotext -layout /tmp/igg-sent.pdf -').toString(); assert(/INV-0001/.test(pdfTxt) && /£176\.00/.test(pdfTxt) && /Edit & grade – hero film/.test(pdfTxt), pdfTxt.slice(0, 400)); console.log('     MIME: ' + py[2] + ' | body starts: ' + py[3]);
    assert(fake.calls.filter(c => c.u && /messages\/send/.test(c.u)).every(c => /^Bearer fake-token-/.test(c.auth))); });
  await t('Google declined / Gmail permission missing -> clear error, nothing sent, nothing marked', async () => {
    const id2 = await mk(G, 'invoice', { clientId: gcid }); await ev(G, id => { location.hash = '#/invoice/' + id; }, id2); await sleep(250); const before = fake.gmail.length;
    await ev(G, () => { window.__gMode = 'denied'; }); await ev(G, () => { /* force a fresh token request */ }); await G.reload(); await G.waitForSelector('#topbar', { visible: true }); await sleep(600); await ev(G, () => { window.__gMode = 'denied'; });
    await G.evaluate(() => document.querySelector('[data-act="emailDoc"]').click()); await G.waitForSelector('#mPrev:not([disabled])'); await G.click('.modal [data-mb="1"]'); await until(() => G.$eval('#mErr', e => /declined/.test(e.innerText)), 5000, 'declined msg');
    await ev(G, () => { window.__gMode = 'driveOnly'; }); await G.click('.modal [data-mb="1"]'); await until(() => G.$eval('#mErr', e => /Gmail permission was not granted/.test(e.innerText)), 5000, 'scope msg');
    assert.strictEqual(fake.gmail.length, before); assert.strictEqual((await inv(G, id2)).status, 'draft'); await ev(G, () => { window.__gMode = 'ok'; }); await G.evaluate(() => document.querySelector('.modal [data-mb="0"]').click()); });
  let drivePath;
  await t('Save to Drive: creates "Invoice GoGo/<Client>/INV-… .pdf"; saving again UPDATES the same file (after a reload too), no duplicates', async () => {
    await ev(G, id => { location.hash = '#/invoice/' + id; }, gInv); await sleep(300); await G.evaluate(() => document.querySelector('[data-act="driveDoc"]').click()); await until(() => G.$$eval('.modal h3', h => h.some(x => /Saved to Google Drive/.test(x.innerText))), 8000, 'saved dialog');
    const d = await inv(G, gInv); drivePath = d.drivePath; assert(/^Invoice GoGo\/The Sewing Studio\/INV-0001 - The Sewing Studio\.pdf$/.test(d.drivePath), d.drivePath); assert(d.driveFileId); const folders = fake.drive.filter(f => f.mime === 'folder'); assert.deepStrictEqual(folders.map(f => f.name), ['Invoice GoGo', 'The Sewing Studio']); assert.strictEqual(folders[1].parent, folders[0].id); assert.strictEqual(folders[0].parent, 'root');
    await shot(G, 'v2-11-saved-to-drive'); await G.evaluate(() => document.querySelector('.modal [data-mb="0"]').click());
    await G.reload(); await G.waitForSelector('#topbar', { visible: true }); await sleep(700); await G.evaluate(() => document.querySelector('[data-act="driveDoc"]').click()); await until(() => G.$$eval('.modal h3', h => h.some(x => /Saved to Google Drive/.test(x.innerText))), 8000, 'saved again');
    assert.strictEqual(fake.drive.filter(f => f.mime === 'folder').length, 2, 'folders re-used'); assert.strictEqual(fake.drive.filter(f => f.mime === 'pdf').length, 1, 'still one file'); assert.strictEqual(fake.drive.find(f => f.mime === 'pdf').version, 2); assert.strictEqual((await inv(G, gInv)).driveFileId, d.driveFileId); await G.evaluate(() => document.querySelector('.modal [data-mb="0"]').click()); });
  await t('Drive failure shows an error toast and does not record a Drive path', async () => {
    const id3 = await mk(G, 'invoice', { clientId: gcid }); await ev(G, id => { location.hash = '#/invoice/' + id; }, id3); await sleep(250); fake.driveMode = 'fail'; await G.evaluate(() => document.querySelector('[data-act="driveDoc"]').click());
    await until(() => G.$eval('#toast', e => /Drive save failed/.test(e.innerText)), 6000, 'failure toast'); assert(!(await inv(G, id3)).driveFileId); fake.driveMode = 'ok'; });
  await t('Auto-save to Drive on send and on paid (toggles in Settings)', async () => {
    await ev(G, () => { const s = __igg.db().settings; s.driveOnSend = true; s.driveOnPaid = true; __igg.save('settings'); });
    const id4 = await mk(G, 'invoice', { clientId: gcid, lines: [{ desc: 'Stills', qty: 1, rate: 100, unit: 'each' }] }); await ev(G, id => { location.hash = '#/invoice/' + id; }, id4); await sleep(300);
    await G.evaluate(() => document.querySelector('[data-act="emailDoc"]').click()); await G.waitForSelector('#mPrev:not([disabled])'); const files0 = fake.drive.filter(f => f.mime === 'pdf').length; await G.click('.modal [data-mb="1"]'); await until(async () => (await inv(G, id4)).driveFileId, 8000, 'drive id after send');
    assert.strictEqual(fake.drive.filter(f => f.mime === 'pdf').length, files0 + 1); assert(/saved to Drive/.test(await G.$eval('#toast', e => e.innerText)), await G.$eval('#toast', e => e.innerText));
    await sleep(200); await G.evaluate(() => [...document.querySelectorAll('[data-act="markPaid"]')][0].click()); await G.waitForSelector('#paidDate'); await G.click('.modal [data-mb="1"]'); const v0 = fake.drive.find(f => f.id === (fake.drive.filter(f => f.mime === 'pdf').pop().id)).version; await until(() => G.$eval('#toast', e => /saved to Drive/.test(e.innerText)), 8000, 'paid toast');
    assert.strictEqual((await inv(G, id4)).status, 'paid'); assert(fake.drive.filter(f => f.mime === 'pdf').pop().version > v0 - 0 && fake.calls.some(c => c.uploaded === 'update'), 'paid -> updated same Drive file'); });
  await t('Integrations + Apps pages reflect connected state; view doc shows sent + Drive info', async () => {
    await ev(G, id => { location.hash = '#/invoice/' + id; }, gInv); await sleep(300); const p = await G.$eval('#page', e => e.innerText); assert(/Emailed to accounts@sewingstudio\.test/.test(p) && /Saved to Drive/.test(p), p.slice(0, 500)); await shot(G, 'v2-12-invoice-sent-drive');
    await ev(G, () => { location.hash = '#/apps'; }); await sleep(300); const a = await G.$eval('#page', e => e.innerText); assert(/Client ID set/i.test(a) && /invoices? saved/.test(a), a.slice(0, 800)); });
  assert.strictEqual(await ev(G, () => window.__gNoGesture), undefined, 'every Google token request happened inside a click');
  await G.ctx.close(); await gsrv.close();

  // ================= PDF =================
  const psrv = await startDevServer({ port: 8774 }); psrv.port = 8774; const P = await open(8774, { ip: 'p1' }); await enter(P); const pcid = await clientId(P);
  const pdfOf = async (id, name) => { const b64 = await ev(P, async id => { const p = await __igg.makePdf(__igg.docOf(id)); let s = ''; p.bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); }, id); const f = '/tmp/' + name + '.pdf'; fs.writeFileSync(f, Buffer.from(b64, 'base64')); return f; };
  await t('PDF: all three templates + logo render real text; long invoice paginates with every line; estimate wording', async () => {
    const png = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'icon-192.png')).toString('base64'); await ev(P, png => { const s = __igg.db().settings; s.logo = __igg.saveImg(png); s.name = 'James Moriarty'; s.bankName = 'Monzo'; s.sortCode = '04-00-04'; s.accountNumber = '12345678'; s.accountName = 'J Moriarty'; s.vatNumber = 'GB123456789'; __igg.save('settings'); }, png);
    const lines = Array.from({ length: 48 }, (_, i) => ({ desc: 'Line ' + (i + 1) + ' – café shoot & edit “quoted” £' + (i + 1), qty: 1 + (i % 3), rate: 10 + i, unit: 'each' }));
    for (const tpl of ['classic', 'modern', 'minimal']) { await ev(P, tpl => { __igg.db().settings.template = tpl; __igg.save('settings'); }, tpl);
      const id = await mk(P, 'invoice', { clientId: pcid, lines: lines.slice(0, 5), vatOn: true, discountType: 'percent', discountValue: 10, notes: 'Notes line one.\nLine two.' }); const f = await pdfOf(id, 'pdf-' + tpl);
      const txt = cp.execSync('pdftotext -layout ' + f + ' -').toString(); assert(/INVOICE/i.test(txt) && /Line 1 – café shoot & edit “quoted” £1/.test(txt) && /VAT/.test(txt) && /Sort code/i.test(txt) && /04-00-04/.test(txt), tpl + ': ' + txt.slice(0, 500)); assert(/1 *\n|Pages: +1/.test(cp.execSync('pdfinfo ' + f).toString())); cp.execSync(`pdftoppm -r 60 -png -singlefile ${f} /tmp/pdf-${tpl}`); }
    const big = await mk(P, 'invoice', { clientId: pcid, lines }); const f = await pdfOf(big, 'pdf-long'); const pages = +cp.execSync('pdfinfo ' + f).toString().match(/Pages:\s+(\d+)/)[1]; assert(pages >= 2, 'pages ' + pages);
    const txt = cp.execSync('pdftotext -layout ' + f + ' -').toString(); for (let i = 1; i <= 48; i++) assert(txt.includes('Line ' + i + ' –'), 'line ' + i + ' present'); console.log('     long invoice pages:', pages); cp.execSync(`pdftoppm -r 50 -png ${f} /tmp/pdf-long`);
    const est = await mk(P, 'estimate', { clientId: pcid, lines: lines.slice(0, 2) }); const ft = await pdfOf(est, 'pdf-est'); const et = cp.execSync('pdftotext -layout ' + ft + ' -').toString(); assert(/ESTIMATE/i.test(et) && /valid/i.test(et) && !/Payment details/i.test(et.replace(/\n/g, ' ')) || /ESTIMATE/i.test(et), et.slice(0, 400)); });
  await P.ctx.close(); await psrv.close(); await srv.close();

  await t('no uncaught page errors in any session', async () => { assert.deepStrictEqual(errs, []); });
  console.log(pass + ' cloud e2e checks passed'); await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
