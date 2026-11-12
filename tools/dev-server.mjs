// Local dev/test server: serves the static app AND the /api function (same handler as Netlify) backed by an in-memory blob store.
// Usage: node tools/dev-server.mjs [port]      (IGG_SECRET is generated per run; IGG_SETUP_CODE optional via env)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { createApi } from '../netlify/lib/handler.mjs'; import { createMockBlobs } from '../tests/mock-blobs.mjs';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const port = +process.argv[2] || 8765;
export function startDevServer({ port = 8765, env = {} } = {}) {
  const getStore = createMockBlobs(); const secret = crypto.randomBytes(40).toString('base64url');
  const api = createApi({ getStore, env: { IGG_SECRET: secret, ...env } });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.csv': 'text/csv' };
  const reqLog = []; // every /api request the server sees: { t, method, path } – lets tests prove nothing hits the API in the background
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost:' + port);
      if (url.pathname.startsWith('/api')) {
        reqLog.push({ t: Date.now(), method: req.method, path: url.pathname });
        const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
        const r = await api(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { ip: req.socket.remoteAddress + (req.headers['x-test-ip'] || '') });
        res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
      }
      let f = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(fs.readFileSync(f));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise(r => server.listen(port, () => r({ server, getStore, secret, reqLog, close: () => new Promise(c => server.close(c)) })));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { await startDevServer({ port, env: process.env.IGG_SETUP_CODE ? { IGG_SETUP_CODE: process.env.IGG_SETUP_CODE } : {} }); console.log('dev server on http://localhost:' + port); }
