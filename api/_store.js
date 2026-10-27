// Where audits are saved.
// - Real use: a private Vercel Blob store (connected in the Vercel dashboard,
//   which adds BLOB_READ_WRITE_TOKEN). One JSON file per report, plus
//   index.json with every audit's summary, review and validation scores.
// - MOCK_MODE=1: an in-memory store seeded with sample audits.
// Free Hobby plans include 2,000 Blob writes a month, so an audit costs two
// writes (its report and one index update) and reviews/validation one each.
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
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

const blobStore = {
  kind: 'blob',
  async getIndex() {
    const r = await readJson(INDEX_PATH);
    return r && Array.isArray(r.data.audits) ? r.data : { audits: [] };
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
  async updateIndex(fn) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const cur = await readJson(INDEX_PATH);
      const out = fn(cur && Array.isArray(cur.data.audits) ? cur.data : { audits: [] });
      if (!out.index) return out;
      try {
        await writeJson(INDEX_PATH, out.index, cur ? { ifMatch: cur.etag } : { allowOverwrite: false });
        return out;
      } catch (e) {
        const conflict = e instanceof BlobPreconditionFailedError || /already exists|precondition/i.test(String(e && e.message));
        if (!conflict) throw e;
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
