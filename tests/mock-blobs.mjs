// In-memory stand-in for @netlify/blobs getStore(). Conditional writes return {modified:false} (they do not throw), like the real thing.
export function createMockBlobs({ yieldMs = 0 } = {}) {
  const stores = new Map(); let etagN = 0;
  const tick = () => new Promise(r => (yieldMs ? setTimeout(r, Math.random() * yieldMs) : setImmediate(r)));
  return function getStore(name) {
    if (!stores.has(name)) stores.set(name, new Map()); const m = stores.get(name);
    const parse = (v, type) => (type === 'json' ? JSON.parse(v) : v);
    return {
      async get(key, o = {}) { await tick(); return m.has(key) ? parse(m.get(key).v, o.type) : null; },
      async getWithMetadata(key, o = {}) { await tick(); if (!m.has(key)) return null; const e = m.get(key); return { data: parse(e.v, o.type), etag: e.etag, metadata: {} }; },
      async set(key, data, o = {}) {
        await tick(); const e = m.get(key);
        if (o.onlyIfNew && e) return { modified: false };
        if (o.onlyIfMatch !== undefined && (!e || e.etag !== o.onlyIfMatch)) return { modified: false };
        const etag = '"' + (++etagN) + '"'; m.set(key, { v: typeof data === 'string' ? data : String(data), etag }); return { modified: true, etag };
      },
      async setJSON(key, data, o) { return this.set(key, JSON.stringify(data), o); },
      async delete(key) { m.delete(key); },
      _dump: () => Object.fromEntries([...m].map(([k, v]) => [k, v.v]))
    };
  };
}
