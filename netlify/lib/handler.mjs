// Invoice GoGo API – pure request handler (no Netlify globals) so it can be unit-tested with a mock blob store.
// Routes (all under /api): GET status · POST setup · POST login · POST change-pin · GET data · POST sync · PUT|GET img/:id
import crypto from 'node:crypto';

export const COLLECTIONS = ['clients', 'invoices', 'items', 'expenses', 'projects', 'settings', 'imported'];
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_BODY = 4 * 1024 * 1024, MAX_RECORD = 250 * 1024, MAX_IMG = 1_600_000;
const scrypt = (pw, salt, N) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, { N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
const b64u = b => Buffer.from(b).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const err = (status, message, extra) => json({ error: message, ...(extra || {}) }, status);

export async function hashPin(pin, N = 16384) {
  const salt = crypto.randomBytes(16).toString('base64url');
  return `scrypt$${N}$${salt}$${(await scrypt(pin, salt, N)).toString('base64url')}`;
}
export async function verifyPin(pin, stored) {
  const [alg, N, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  return safeEq((await scrypt(pin, salt, +N)).toString('base64url'), hash);
}
export function signToken(secret, payload) { const body = b64u(JSON.stringify(payload)); return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url'); }
export function verifyToken(secret, token, now = Date.now()) {
  if (!secret || typeof token !== 'string') return null;
  const [body, sig] = token.split('.'); if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEq(sig, good)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p && p.exp > now ? p : null; } catch { return null; }
}

/** Last-write-wins per record. Returns {records, changed}. Ties keep the existing record. */
export function mergeRecords(existing, incoming) {
  const out = { ...(existing || {}) }; let changed = false;
  for (const r of incoming) {
    const cur = out[r.id];
    if (!cur || r.updatedAt > cur.updatedAt) { out[r.id] = r; changed = true; }
  }
  return { records: out, changed };
}
const validRecord = r => r && typeof r === 'object' && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 120 && Number.isFinite(r.updatedAt) && JSON.stringify(r).length <= MAX_RECORD;

export function createApi({ getStore, env = {}, now = () => Date.now() }) {
  const auth = () => getStore('igg-auth'), data = () => getStore('igg-data'), imgs = () => getStore('igg-img');
  // Signing key: IGG_SECRET env var if set (preferred); otherwise a random 48-byte key generated once and kept in the private auth blob store.
  let secretCache = null;
  async function secret() {
    if (env.IGG_SECRET && String(env.IGG_SECRET).length >= 32) return env.IGG_SECRET;
    if (secretCache) return secretCache;
    let r = await auth().get('secret', { type: 'json', consistency: 'strong' });
    if (!r || !r.key) { const key = crypto.randomBytes(48).toString('base64url'); await auth().setJSON('secret', { key, created: now() }, { onlyIfNew: true }); r = await auth().get('secret', { type: 'json', consistency: 'strong' }); }
    return (secretCache = r && r.key ? r.key : null);
  }
  const setupCodeRequired = () => !!(env.IGG_SETUP_CODE || env.IGG_SETUP_CODE_HASH);
  async function setupCodeOk(code) {
    code = String(code || '');
    if (env.IGG_SETUP_CODE) return safeEq(code, env.IGG_SETUP_CODE);
    return verifyPin(code, env.IGG_SETUP_CODE_HASH);
  }

  async function getPinRecord() {
    if (env.IGG_PIN_HASH) return { hash: env.IGG_PIN_HASH, fromEnv: true };
    const r = await auth().get('pin', { type: 'json', consistency: 'strong' });
    return r ? { hash: r.hash, fromEnv: false } : null;
  }
  const pv = hash => sha(hash).slice(0, 10);
  async function requireAuth(req) {
    const s = await secret(); if (!s) return { res: err(500, 'Server is not configured (no signing key).') };
    const h = req.headers.get('authorization') || ''; const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    const p = verifyToken(s, tok, now()); if (!p) return { res: err(401, 'Not signed in') };
    const pin = await getPinRecord(); if (!pin || p.pv !== pv(pin.hash)) return { res: err(401, 'Session expired – sign in again') };
    return { ok: true, token: p };
  }

  /* ---- rate limiting (per client IP, plus a global brake) ---- */
  async function limitState(key) { return (await auth().get('rl/' + key, { type: 'json', consistency: 'strong' })) || { fails: 0, lockUntil: 0, locks: 0, windowStart: 0 }; }
  async function checkLimit(ip) {
    const t = now(); const g = await limitState('_global'), i = await limitState(sha(ip));
    const until = Math.max(g.lockUntil || 0, i.lockUntil || 0);
    return until > t ? Math.ceil((until - t) / 1000) : 0;
  }
  async function recordFailure(ip) {
    const t = now(); const key = sha(ip); const i = await limitState(key);
    i.fails = (i.fails || 0) + 1;
    if (i.fails >= 5) { i.lockUntil = t + Math.min(15 * 60_000 * 2 ** (i.locks || 0), 24 * 3600_000); i.locks = (i.locks || 0) + 1; i.fails = 0; }
    await auth().setJSON('rl/' + key, i);
    const g = await limitState('_global');
    if (!g.windowStart || t - g.windowStart > 15 * 60_000) { g.windowStart = t; g.fails = 0; }
    g.fails = (g.fails || 0) + 1; if (g.fails >= 40) { g.lockUntil = t + 15 * 60_000; g.fails = 0; g.windowStart = t; }
    await auth().setJSON('rl/_global', g);
  }
  async function recordSuccess(ip) { await auth().setJSON('rl/' + sha(ip), { fails: 0, lockUntil: 0, locks: 0, windowStart: 0 }); }

  const issue = async hash => ({ token: signToken(await secret(), { iat: now(), exp: now() + TOKEN_TTL_MS, pv: pv(hash) }), expires: now() + TOKEN_TTL_MS });
  const pinOk = p => typeof p === 'string' && p.length >= 6 && p.length <= 128;
  async function body(req, limit = MAX_BODY) {
    const txt = await req.text(); if (txt.length > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    return txt;
  }
  async function jsonBody(req) { try { return JSON.parse(await body(req) || '{}'); } catch (e) { if (e.status) throw e; throw Object.assign(new Error('Bad JSON'), { status: 400 }); } }

  async function loadCollection(name) { const r = await data().get('col/' + name, { type: 'json', consistency: 'strong' }); return r || {}; }
  async function fullState() {
    const collections = {};
    for (const c of COLLECTIONS) collections[c] = Object.values(await loadCollection(c));
    return { serverTime: now(), collections };
  }
  async function mergeCollection(name, incoming) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const cur = await data().getWithMetadata('col/' + name, { type: 'json', consistency: 'strong' });
      const { records, changed } = mergeRecords(cur ? cur.data : {}, incoming);
      if (!changed) return;
      const w = cur ? await data().setJSON('col/' + name, records, { onlyIfMatch: cur.etag }) : await data().setJSON('col/' + name, records, { onlyIfNew: true });
      if (w.modified !== false) return;
    }
    throw Object.assign(new Error('Busy – please retry'), { status: 503 });
  }

  return async function handle(req, ctx = {}) {
    const url = new URL(req.url); const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, ''); const m = req.method;
    const ip = ctx.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
    try {
      if (path === 'status' && m === 'GET') {
        const pin = await getPinRecord();
        return json({ app: 'invoice-gogo', pinSet: !!pin, configured: true, setupCodeRequired: setupCodeRequired() });
      }
      if ((path === 'setup' || path === 'login') && m === 'POST') {
        if (!(await secret())) return err(500, 'Server is not configured (no signing key).');
        const wait = await checkLimit(ip); if (wait) return err(429, 'Too many attempts – try again later.', { retryAfter: wait });
        const b = await jsonBody(req);
        if (path === 'setup') {
          if (await getPinRecord()) return err(409, 'A PIN is already set.');
          if (setupCodeRequired() && !(await setupCodeOk(b.setupCode))) { await recordFailure(ip); return err(403, 'Wrong setup code.'); }
          if (!pinOk(b.pin)) return err(400, 'Choose a PIN/password of at least 6 characters.');
          const hash = await hashPin(b.pin);
          const w = await auth().setJSON('pin', { hash, created: now() }, { onlyIfNew: true });
          if (w.modified === false) return err(409, 'A PIN is already set.');
          return json(await issue(hash));
        }
        const pin = await getPinRecord(); if (!pin) return err(409, 'No PIN set yet – create one first.', { setup: true });
        if (!pinOk(b.pin) || !(await verifyPin(b.pin, pin.hash))) { await recordFailure(ip); return err(401, 'Wrong PIN.'); }
        await recordSuccess(ip); return json(await issue(pin.hash));
      }
      const a = await requireAuth(req); if (a.res) return a.res;

      if (path === 'change-pin' && m === 'POST') {
        const b = await jsonBody(req); const pin = await getPinRecord();
        if (pin.fromEnv) return err(409, 'The PIN is set by the IGG_PIN_HASH environment variable – change it there.');
        const wait = await checkLimit(ip); if (wait) return err(429, 'Too many attempts – try again later.', { retryAfter: wait });
        if (!(await verifyPin(b.pin || '', pin.hash))) { await recordFailure(ip); return err(401, 'Current PIN is wrong.'); }
        if (!pinOk(b.newPin)) return err(400, 'New PIN must be at least 6 characters.');
        const hash = await hashPin(b.newPin); await auth().setJSON('pin', { hash, created: now() }); return json(await issue(hash));
      }
      if (path === 'data' && m === 'GET') return json(await fullState());
      if (path === 'sync' && m === 'POST') {
        const b = await jsonBody(req); const ch = b.changes || {};
        for (const c of Object.keys(ch)) {
          if (!COLLECTIONS.includes(c) || !Array.isArray(ch[c])) return err(400, 'Unknown collection ' + c);
          if (!ch[c].every(validRecord)) return err(400, 'Invalid record in ' + c);
        }
        for (const c of Object.keys(ch)) if (ch[c].length) await mergeCollection(c, ch[c]);
        return json(await fullState());
      }
      const im = /^img\/([A-Za-z0-9_-]{6,64})$/.exec(path);
      if (im && m === 'PUT') {
        const txt = await body(req, MAX_IMG + 100);
        if (txt.length > MAX_IMG || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(txt)) return err(400, 'Not a valid image (png/jpeg/webp/gif data URL, max ~1.5 MB).');
        await imgs().set(im[1], txt); return json({ ok: true });
      }
      if (im && m === 'GET') {
        const v = await imgs().get(im[1], { type: 'text', consistency: 'strong' }); if (!v) return err(404, 'No such image');
        return new Response(v, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, max-age=31536000, immutable' } });
      }
      return err(404, 'Not found');
    } catch (e) {
      if (e && e.status) return err(e.status, e.message);
      console.error('api error', e && e.stack || e); return err(500, 'Server error');
    }
  };
}
