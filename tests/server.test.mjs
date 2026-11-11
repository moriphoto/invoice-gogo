// Unit tests for the API handler with a blobs mock.  Run: node tests/server.test.mjs
import assert from 'node:assert/strict';
import { createApi, mergeRecords, verifyToken, signToken, hashPin, verifyPin } from '../netlify/lib/handler.mjs';
import { createMockBlobs } from './mock-blobs.mjs';

let pass = 0; const t = async (name, fn) => { try { await fn(); pass++; console.log('ok  -', name); } catch (e) { process.exitCode = 1; console.error('FAIL -', name, '\n  ', e.stack.split('\n').slice(0, 4).join('\n   ')); } };
const SECRET = 'x'.repeat(48) + 'TESTONLY'; const TEST_PIN = 'test-pin-123456';
let clock = 1_000_000_000_000;
const mk = (env = { IGG_SECRET: SECRET }, opts) => { const getStore = createMockBlobs(opts); return { getStore, api: createApi({ getStore, env, now: () => clock }) }; };
const call = (api, method, path, { body, token, ip = '1.1.1.1', raw } = {}) => api(new Request('http://x/api/' + path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' }, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) }), { ip }).then(async r => ({ status: r.status, json: await r.clone().json().catch(() => null), text: await r.text() }));
const setup = async (api, extra = {}) => (await call(api, 'POST', 'setup', { body: { pin: TEST_PIN, ...extra } })).json.token;
const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, ...extra });

await t('status: reports pinSet false before setup, configured true', async () => {
  const { api } = mk(); const r = await call(api, 'GET', 'status'); assert.equal(r.status, 200); assert.equal(r.json.pinSet, false); assert.equal(r.json.configured, true);
});
await t('every protected route rejects requests without a token (401)', async () => {
  const { api } = mk(); await setup(api);
  for (const [m, p, b] of [['GET', 'data'], ['POST', 'sync', { changes: {} }], ['PUT', 'img/abcdef12', undefined], ['GET', 'img/abcdef12'], ['POST', 'change-pin', {}]]) {
    const r = await call(api, m, p, { body: b, raw: m === 'PUT' ? 'data:image/png;base64,AAAA' : undefined }); assert.equal(r.status, 401, m + ' ' + p);
  }
});
await t('garbage / tampered / expired / wrong-secret tokens rejected', async () => {
  const { api } = mk(); const tok = await setup(api);
  for (const bad of ['', 'abc', 'a.b', tok.slice(0, -2) + 'xx', tok.split('.')[0] + '.AAAA', signToken('another-secret-another-secret-another-secret!', { exp: clock + 1e6, pv: 'x' })]) assert.equal((await call(api, 'GET', 'data', { token: bad })).status, 401);
  const expired = signToken(SECRET, { iat: 1, exp: clock - 1, pv: 'x' }); assert.equal((await call(api, 'GET', 'data', { token: expired })).status, 401);
  assert.equal(verifyToken(SECRET, tok, clock) !== null, true); assert.equal(verifyToken(SECRET, tok, clock + 31 * 864e5), null);
  const fake = signToken(SECRET, { iat: clock, exp: clock + 1e6, pv: 'wrongpv' }); assert.equal((await call(api, 'GET', 'data', { token: fake })).status, 401); // valid signature, wrong PIN version
});
await t('without IGG_SECRET a random signing key is generated once, stored privately, and survives restarts; env secret overrides', async () => {
  const { api, getStore } = mk({}); const tok = await setup(api); assert(tok);
  const key = (await getStore('igg-auth').get('secret', { type: 'json' })).key; assert(key.length >= 48);
  const api2 = createApi({ getStore, env: {}, now: () => clock }); assert.equal((await call(api2, 'GET', 'data', { token: tok })).status, 200, 'fresh instance (cold start) accepts the same token');
  assert.equal((await call(api2, 'GET', 'data')).status, 401);
  const withEnv = createApi({ getStore, env: { IGG_SECRET: SECRET }, now: () => clock }); assert.equal((await call(withEnv, 'GET', 'data', { token: tok })).status, 401, 'switching to an env secret invalidates old tokens (sign in again)');
  const short = mk({ IGG_SECRET: 'short' }); const st = await setup(short.api); assert((await getStore('igg-auth').get('secret', { type: 'json' })).key !== 'short'); assert(st);
  const e = await call(api, 'GET', 'img/abcdef12', { token: tok }); assert(!JSON.stringify(e.json).includes(key));
});
await t('IGG_SETUP_CODE_HASH (scrypt) gate works like the plain setup code', async () => {
  const h = await hashPin('hash-code-1234567', 1024); const { api } = mk({ IGG_SETUP_CODE_HASH: h });
  assert.equal((await call(api, 'GET', 'status')).json.setupCodeRequired, true);
  assert.equal((await call(api, 'POST', 'setup', { body: { pin: TEST_PIN } })).status, 403); assert.equal((await call(api, 'POST', 'setup', { body: { pin: TEST_PIN, setupCode: 'nope' } })).status, 403);
  assert.equal((await call(api, 'POST', 'setup', { body: { pin: TEST_PIN, setupCode: 'hash-code-1234567' } })).status, 200);
  assert.equal((await call(api, 'POST', 'login', { body: { pin: TEST_PIN } })).status, 200, 'login does not need the setup code');
});
await t('setup: weak PIN rejected, works once, second setup 409; PIN stored only as salted scrypt hash', async () => {
  const { api, getStore } = mk(); assert.equal((await call(api, 'POST', 'setup', { body: { pin: '123' } })).status, 400);
  const r = await call(api, 'POST', 'setup', { body: { pin: TEST_PIN } }); assert.equal(r.status, 200); assert(r.json.token);
  assert.equal((await call(api, 'POST', 'setup', { body: { pin: 'another-pin-999' } })).status, 409);
  const stored = (await getStore('igg-auth').get('pin', { type: 'json' })).hash; assert.match(stored, /^scrypt\$\d+\$[\w-]+\$[\w-]+$/); assert(!JSON.stringify(getStore('igg-auth')._dump()).includes(TEST_PIN));
});
await t('setup race: two simultaneous setups -> exactly one wins', async () => {
  const { api } = mk(undefined, { yieldMs: 5 }); const rs = await Promise.all([call(api, 'POST', 'setup', { body: { pin: 'first-pin-111' } }), call(api, 'POST', 'setup', { body: { pin: 'second-pin-222' }, ip: '2.2.2.2' })]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
});
await t('IGG_SETUP_CODE gate', async () => {
  const { api } = mk({ IGG_SECRET: SECRET, IGG_SETUP_CODE: 'letmein-code' });
  assert.equal((await call(api, 'GET', 'status')).json.setupCodeRequired, true);
  assert.equal((await call(api, 'POST', 'setup', { body: { pin: TEST_PIN } })).status, 403); assert.equal((await call(api, 'POST', 'setup', { body: { pin: TEST_PIN, setupCode: 'wrong' } })).status, 403);
  assert.equal((await call(api, 'POST', 'setup', { body: { pin: TEST_PIN, setupCode: 'letmein-code' } })).status, 200);
});
await t('login: wrong PIN 401, right PIN 200, no PIN yet 409', async () => {
  const { api } = mk(); assert.equal((await call(api, 'POST', 'login', { body: { pin: TEST_PIN } })).status, 409);
  await setup(api); assert.equal((await call(api, 'POST', 'login', { body: { pin: 'nope-nope-nope' } })).status, 401);
  const r = await call(api, 'POST', 'login', { body: { pin: TEST_PIN } }); assert.equal(r.status, 200); assert.equal((await call(api, 'GET', 'data', { token: r.json.token })).status, 200);
});
await t('rate limit: 5 wrong PINs lock that IP (429, even for the right PIN); other IPs unaffected; unlocks later', async () => {
  const { api } = mk(); await setup(api);
  for (let i = 0; i < 5; i++) assert.equal((await call(api, 'POST', 'login', { body: { pin: 'wrong-wrong-' + i }, ip: '9.9.9.9' })).status, 401);
  const locked = await call(api, 'POST', 'login', { body: { pin: TEST_PIN }, ip: '9.9.9.9' }); assert.equal(locked.status, 429); assert(locked.json.retryAfter > 0);
  assert.equal((await call(api, 'POST', 'login', { body: { pin: TEST_PIN }, ip: '8.8.8.8' })).status, 200);
  clock += 16 * 60_000; assert.equal((await call(api, 'POST', 'login', { body: { pin: TEST_PIN }, ip: '9.9.9.9' })).status, 200);
  const burst = async () => { for (let i = 0; i < 5; i++) await call(api, 'POST', 'login', { body: { pin: 'wrong-again-' + i }, ip: '7.7.7.7' }); };
  await burst(); clock += 16 * 60_000; await burst(); // second lock is longer (30 min)
  clock += 16 * 60_000; assert.equal((await call(api, 'POST', 'login', { body: { pin: TEST_PIN }, ip: '7.7.7.7' })).status, 429);
  clock += 16 * 60_000; assert.equal((await call(api, 'POST', 'login', { body: { pin: TEST_PIN }, ip: '7.7.7.7' })).status, 200);
});
await t('change-pin invalidates old tokens', async () => {
  const { api } = mk(); const tok = await setup(api);
  assert.equal((await call(api, 'POST', 'change-pin', { token: tok, body: { pin: 'bad-current-pin', newPin: 'new-pin-654321' } })).status, 401);
  const r = await call(api, 'POST', 'change-pin', { token: tok, body: { pin: TEST_PIN, newPin: 'new-pin-654321' } }); assert.equal(r.status, 200);
  assert.equal((await call(api, 'GET', 'data', { token: tok })).status, 401); assert.equal((await call(api, 'GET', 'data', { token: r.json.token })).status, 200);
  assert.equal((await call(api, 'POST', 'login', { body: { pin: TEST_PIN } })).status, 401); assert.equal((await call(api, 'POST', 'login', { body: { pin: 'new-pin-654321' } })).status, 200);
});
await t('IGG_PIN_HASH env var is honoured (and blocks setup)', async () => {
  const h = await hashPin(TEST_PIN, 1024); const { api } = mk({ IGG_SECRET: SECRET, IGG_PIN_HASH: h });
  assert.equal((await call(api, 'GET', 'status')).json.pinSet, true); assert.equal((await call(api, 'POST', 'setup', { body: { pin: TEST_PIN } })).status, 409);
  assert.equal((await call(api, 'POST', 'login', { body: { pin: TEST_PIN } })).status, 200); assert.equal(await verifyPin(TEST_PIN, h), true); assert.equal(await verifyPin('x'.repeat(8), h), false);
});
await t('mergeRecords: last write wins, ties keep existing, tombstones win when newer', () => {
  const a = { r1: rec('r1', 10, { n: 'old' }), r2: rec('r2', 10, { n: 'keep' }) };
  const { records, changed } = mergeRecords(a, [rec('r1', 20, { n: 'new' }), rec('r2', 10, { n: 'tie' }), rec('r3', 5, { deleted: true })]);
  assert(changed); assert.equal(records.r1.n, 'new'); assert.equal(records.r2.n, 'keep'); assert.equal(records.r3.deleted, true);
  assert.equal(mergeRecords(records, [rec('r1', 19, { n: 'stale' })]).changed, false);
  assert.equal(mergeRecords(records, [rec('r1', 30, { deleted: true })]).records.r1.deleted, true);
});
await t('sync: stores data, returns full merged state to a second device', async () => {
  const { api } = mk(); const tok = await setup(api);
  const r = await call(api, 'POST', 'sync', { token: tok, body: { changes: { clients: [rec('c1', 100, { name: 'A' })], invoices: [rec('i1', 100, { number: 'INV-0001' })], settings: [rec('settings', 100, { name: 'James' })], imported: [rec('2026-11-09|09:30|17:00', 100, { invoiceId: 'i1' })] } } });
  assert.equal(r.status, 200); assert.equal(r.json.collections.clients.length, 1);
  const d = await call(api, 'GET', 'data', { token: tok }); assert.equal(d.json.collections.invoices[0].number, 'INV-0001'); assert.equal(d.json.collections.imported[0].invoiceId, 'i1'); assert.equal(d.json.collections.expenses.length, 0);
  const r2 = await call(api, 'POST', 'sync', { token: tok, body: { changes: { clients: [rec('c1', 50, { name: 'STALE' }), rec('c2', 60, { name: 'B' })] } } });
  const names = r2.json.collections.clients.map(c => c.name).sort(); assert.deepEqual(names, ['A', 'B']);
  const del = await call(api, 'POST', 'sync', { token: tok, body: { changes: { clients: [rec('c1', 200, { deleted: true })] } } }); assert.equal(del.json.collections.clients.find(c => c.id === 'c1').deleted, true);
});
await t('sync: concurrent writers to the same collection lose nothing (compare-and-set retries)', async () => {
  const { api } = mk(undefined, { yieldMs: 4 }); const tok = await setup(api);
  const N = 12; const rs = await Promise.all(Array.from({ length: N }, (_, i) => call(api, 'POST', 'sync', { token: tok, body: { changes: { invoices: [rec('inv' + i, 1000 + i, { n: i })] } } })));
  assert(rs.every(r => r.status === 200), JSON.stringify(rs.map(r => r.status))); const d = await call(api, 'GET', 'data', { token: tok }); assert.equal(d.json.collections.invoices.length, N);
});
await t('sync: validation (unknown collection, bad record, oversize body)', async () => {
  const { api } = mk(); const tok = await setup(api);
  assert.equal((await call(api, 'POST', 'sync', { token: tok, body: { changes: { evil: [rec('a', 1)] } } })).status, 400);
  assert.equal((await call(api, 'POST', 'sync', { token: tok, body: { changes: { clients: [{ id: 'x' }] } } })).status, 400);
  assert.equal((await call(api, 'POST', 'sync', { token: tok, body: { changes: { clients: [rec('a', 1, { big: 'x'.repeat(300_000) })] } } })).status, 400);
  assert.equal((await call(api, 'POST', 'sync', { token: tok, raw: 'x'.repeat(5_000_000) })).status, 413); assert.equal((await call(api, 'POST', 'sync', { token: tok, raw: '{bad' })).status, 400);
});
await t('images: upload/download roundtrip, validation, auth', async () => {
  const { api } = mk(); const tok = await setup(api); const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal((await call(api, 'PUT', 'img/receipt_01', { token: tok, raw: png })).status, 200);
  const g = await call(api, 'GET', 'img/receipt_01', { token: tok }); assert.equal(g.status, 200); assert.equal(g.text, png);
  assert.equal((await call(api, 'GET', 'img/missing_01', { token: tok })).status, 404);
  assert.equal((await call(api, 'PUT', 'img/receipt_02', { token: tok, raw: '<script>alert(1)</script>' })).status, 400);
  assert.equal((await call(api, 'PUT', 'img/receipt_03', { token: tok, raw: 'data:image/png;base64,' + 'A'.repeat(1_700_000) })).status, 413);
  assert.equal((await call(api, 'PUT', 'img/../etc', { token: tok, raw: png })).status, 404); assert.equal((await call(api, 'GET', 'img/receipt_01')).status, 401);
});
await t('unknown route 404 (authed) and no secrets echoed in errors', async () => {
  const { api } = mk(); const tok = await setup(api); const r = await call(api, 'GET', 'nope', { token: tok }); assert.equal(r.status, 404); assert(!r.text.includes(SECRET));
});
console.log(pass + ' server tests passed');
