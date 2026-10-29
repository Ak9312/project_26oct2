// Where audits are saved.
// - Real use: a private Vercel Blob store (connected in the Vercel dashboard,
//   which adds BLOB_READ_WRITE_TOKEN). One JSON file per report, plus
//   index.json with every audit's summary, review and validation scores.
// - MOCK_MODE=1: an in-memory store seeded with sample audits.
// Free Hobby plans include 2,000 Blob writes a month, so an audit costs two
// writes (its report and one index update) and reviews/validation one each.
import { get, put, head, list, BlobPreconditionFailedError } from '@vercel/blob';
import { RECORDS, INDEX } from './_mock-data.js';
import { upsertEntry, summarize } from './_engine.js';

const INDEX_PATH = 'index.json';
const recordPath = (id) => 'audits/' + id + '.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function storageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

async function readJson(path) {
  let r;
  try {
    r = await get(path, { access: 'private', useCache: false });
  } catch (e) {
    if (e && /not ?found/i.test(String(e.name) + ' ' + String(e.message))) return null;
    throw e;
  }
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  const text = await new Response(r.stream).text();
  return { data: JSON.parse(text), etag: r.blob.etag };
}

function writeJson(path, data, extra) {
  return put(path, JSON.stringify(data), Object.assign({
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  }, extra || {}));
}

// The ETag that put({ ifMatch }) compares against comes from head(), as in
// Vercel's docs. (The ETag header on a get() response is not guaranteed to
// be the same value, which made index updates fail as "conflicts".)
async function headEtag(path) {
  try {
    const m = await head(path);
    return m && m.etag ? m.etag : null;
  } catch (e) {
    if (e && /not ?found/i.test(String(e.name) + ' ' + String(e.message))) return null;
    throw e;
  }
}

const asIndex = (r) => (r && Array.isArray(r.data.audits) ? r.data : { audits: [] });
const isConflict = (e) => e instanceof BlobPreconditionFailedError || /already exists|precondition/i.test(String(e && e.message));

// Reports whose index entry is missing (an index update that failed) are
// added back when the audit list is opened. Listing the store is an
// "advanced" Blob operation, so it runs at most once every 2 minutes per
// function instance.
const SYNC_EVERY_MS = 2 * 60 * 1000;
const syncState = globalThis.__cqaSync || (globalThis.__cqaSync = { at: 0 });

async function storedAuditIds() {
  const ids = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const r = await list({ prefix: 'audits/', limit: 1000, cursor });
    for (const b of r.blobs) {
      const m = /^audits\/(aud_[a-z0-9_]+)\.json$/.exec(b.pathname);
      if (m) ids.push(m[1]);
    }
    if (!r.hasMore) break;
    cursor = r.cursor;
  }
  return ids;
}

const blobStore = {
  kind: 'blob',
  async getIndex() {
    return asIndex(await readJson(INDEX_PATH));
  },
  // Index for the audit list, with any missing reports added back.
  async getIndexSynced() {
    const index = await this.getIndex();
    if (Date.now() - syncState.at < SYNC_EVERY_MS) return index;
    syncState.at = Date.now();
    try {
      const known = new Set(index.audits.map((e) => e.audit_id));
      const missing = (await storedAuditIds()).filter((id) => !known.has(id)).sort().reverse().slice(0, 25);
      if (!missing.length) return index;
      const entries = [];
      for (const id of missing) {
        const rec = await this.getRecord(id);
        if (rec && rec.report) entries.push(summarize(rec.report));
      }
      if (!entries.length) return index;
      const out = await this.updateIndex((idx) => ({ index: entries.reduce((acc, en) => upsertEntry(acc, en), idx) }));
      console.log('Added ' + entries.length + ' missing audit(s) back to the list');
      return out.index;
    } catch (e) {
      console.error('Audit list sync failed', e);
      return index;
    }
  },
  async getRecord(id) {
    const r = await readJson(recordPath(id));
    return r ? r.data : null;
  },
  async putRecord(record) {
    await writeJson(recordPath(record.audit_id), record);
  },
  // fn(index) returns { index, ...extra } to save, or { status, response }
  // to stop. Retries when another request changed the index meanwhile.
  // The last attempt writes without the ETag check, so a change is never
  // lost to repeated conflicts (it re-reads and merges into the latest index).
  async updateIndex(fn) {
    const ATTEMPTS = 5;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const last = attempt === ATTEMPTS - 1;
      const etag = last ? null : await headEtag(INDEX_PATH);
      const cur = await readJson(INDEX_PATH);
      const out = fn(asIndex(cur));
      if (!out.index) return out;
      let opts = {};
      if (!last) opts = etag ? { ifMatch: etag } : cur ? {} : { allowOverwrite: false };
      try {
        await writeJson(INDEX_PATH, out.index, opts);
        return out;
      } catch (e) {
        if (!isConflict(e) || last) throw e;
        console.warn('Index update conflict, retrying', attempt + 1);
        await sleep(150 + Math.random() * 350 * (attempt + 1));
      }
    }
    throw new Error('The audit list is busy. Try again in a moment.');
  },
};

// ---- MOCK_MODE: sample data in memory, reset when the function restarts.
const mem = globalThis.__cqaMem || (globalThis.__cqaMem = {
  records: JSON.parse(JSON.stringify(RECORDS)),
  index: JSON.parse(JSON.stringify(INDEX)),
  pending: new Map(),
});

function materialize() {
  for (const [id, p] of mem.pending) {
    if (Date.now() < p.ready_at) continue;
    mem.pending.delete(id);
    mem.records[id] = p.record;
    mem.index = upsertEntry(mem.index, summarize(p.record.report));
  }
}

const memoryStore = {
  kind: 'memory',
  async getIndex() { materialize(); return JSON.parse(JSON.stringify(mem.index)); },
  async getIndexSynced() { return this.getIndex(); },
  async getRecord(id) { materialize(); return mem.records[id] ? JSON.parse(JSON.stringify(mem.records[id])) : null; },
  async putRecord(record) { mem.records[record.audit_id] = JSON.parse(JSON.stringify(record)); },
  async updateIndex(fn) {
    materialize();
    const out = fn(JSON.parse(JSON.stringify(mem.index)));
    if (out.index) mem.index = out.index;
    return out;
  },
  // Sample audit: copies the first sample report and "finishes" after 6 s.
  async mockAudit(job) {
    const sample = JSON.parse(JSON.stringify(Object.values(RECORDS)[0].report));
    sample.audit_id = job.audit_id;
    sample.created_at = job.created_at;
    sample.article.title = job.input.heading || job.input.url || sample.article.title;
    sample.article.url = job.input.url || '';
    sample.input.keyword = job.input.keyword || sample.input.keyword;
    mem.pending.set(job.audit_id, { ready_at: Date.now() + 6000, record: { audit_id: job.audit_id, report: sample } });
  },
};

export function getStore() {
  if (process.env.MOCK_MODE === '1') return memoryStore;
  if (storageConfigured()) return blobStore;
  return null;
}
