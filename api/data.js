// POST /api/data — reads and saves app data through the n8n API workflow.
import { send, requireAuth, readBody, callN8n, MOCK } from './_lib.js';
import { mockData } from './_mock.js';

const ACTIONS = new Set(['list', 'get', 'review_list', 'review_save', 'validation', 'validation_save']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!requireAuth(req, res)) return;
  const body = readBody(req);
  if (!ACTIONS.has(body.action)) return send(res, 400, { error: 'Unknown action' });
  const r = MOCK ? mockData(body) : await callN8n('content-auditor/api', body);
  return send(res, r.status, r.data);
}
