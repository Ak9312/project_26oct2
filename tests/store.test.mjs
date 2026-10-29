// Blob store: index updates use head() ETags, and missing reports are added
// back to the list. @vercel/blob is replaced by an in-memory fake.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class BlobPreconditionFailedError extends Error {}
const files = new Map(); // path -> { body, etag }
let n = 0;
const fake = {
  BlobPreconditionFailedError,
  async head(path) { const f = files.get(path); if (!f) { const e = new Error('not found'); e.name = 'BlobNotFoundError'; throw e; } return { pathname: path, etag: f.etag }; },
  // get() reports a differently formatted ETag, like a CDN header would.
  async get(path) { const f = files.get(path); if (!f) return null; return { statusCode: 200, stream: new Blob([f.body]).stream(), blob: { etag: 'W/' + f.etag } }; },
  async put(path, body, opts) {
    const f = files.get(path);
    if (opts.ifMatch && (!f || f.etag !== opts.ifMatch)) throw new BlobPreconditionFailedError('precondition failed');
    if (f && opts.allowOverwrite === false) throw new Error('blob already exists');
    files.set(path, { body, etag: '"e' + (++n) + '"' });
    return {};
  },
  async list({ prefix }) { return { hasMore: false, blobs: [...files.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname })) }; },
};
mock.module('@vercel/blob', { namedExports: fake });
process.env.BLOB_READ_WRITE_TOKEN = 'test';
const { getStore } = await import('../api/_store.js');
const { buildErrorReport, summarize, upsertEntry } = await import('../api/_engine.js');

const rep = (id) => buildErrorReport({ audit_id: id, created_at: '2026-10-27T' + id.slice(-2) + ':00:00Z', input: { url: 'https://x.test/' + id, keyword: 'k' }, error: 'x' });

test('index updates succeed one after another', async () => {
  const s = getStore();
  for (const id of ['aud_test_000001', 'aud_test_000002', 'aud_test_000003']) {
    await s.putRecord({ audit_id: id, report: rep(id) });
    await s.updateIndex((idx) => ({ index: upsertEntry(idx, summarize(rep(id))) }));
  }
  assert.equal((await s.getIndex()).audits.length, 3);
});

test('reports missing from the list are added back', async () => {
  const s = getStore();
  await s.putRecord({ audit_id: 'aud_test_000009', report: rep('aud_test_000009') });
  const idx = await s.getIndexSynced();
  assert.ok(idx.audits.some((e) => e.audit_id === 'aud_test_000009'));
  assert.equal(idx.audits.length, 4);
});
