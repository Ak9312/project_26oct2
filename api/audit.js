// POST /api/audit — starts an audit. Forwards only the known fields to the
// n8n audit webhook, adding the shared secret server-side.
import { send, requireAuth, readBody, callN8n, MOCK } from './_lib.js';
import { mockAudit } from './_mock.js';

const FIELDS = ['url', 'heading', 'content', 'meta_description', 'keyword', 'secondary', 'target_grade', 'market'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!requireAuth(req, res)) return;
  const body = readBody(req);
  const payload = {};
  for (const f of FIELDS) if (body[f] !== undefined) payload[f] = body[f];
  if (typeof payload.content === 'string' && payload.content.length > 100000) {
    return send(res, 413, { error: 'Content is over 100,000 characters' });
  }
  const r = MOCK ? mockAudit(payload) : await callN8n('content-auditor/audit', payload);
  return send(res, r.status, r.data);
}
