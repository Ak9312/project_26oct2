// POST /api/audit — starts an audit and answers at once with its ID. The
// audit keeps running in the background (waitUntil) for up to 5 minutes,
// then saves its report. The report page polls /api/data until it appears.
import { waitUntil } from '@vercel/functions';
import { send, requireAuth, readBody, NO_STORAGE } from './_lib.js';
import { getStore } from './_store.js';
import { normalizeInput, makeAuditId, runAudit, auditConfig, buildErrorReport, summarize, upsertEntry } from './_engine.js';

const FIELDS = ['url', 'heading', 'content', 'meta_description', 'keyword', 'secondary', 'target_grade', 'market'];

async function runAndSave(job, store) {
  const cfg = auditConfig(process.env);
  let report;
  try {
    report = await runAudit(job, cfg, {
      fetch: globalThis.fetch,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
    });
  } catch (e) {
    console.error('Audit crashed', job.audit_id, e);
    report = buildErrorReport({
      audit_id: job.audit_id,
      created_at: job.created_at,
      input: job.input,
      error: 'Unexpected error while auditing: ' + String((e && e.message) || e).slice(0, 200),
      config: { pass_mark: cfg.passMark, model: cfg.model },
    });
  }
  try {
    await store.putRecord({ audit_id: job.audit_id, report });
    await store.updateIndex((idx) => ({ index: upsertEntry(idx, summarize(report)) }));
  } catch (e) {
    console.error('Saving the audit failed', job.audit_id, e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!requireAuth(req, res)) return;
  const body = readBody(req);
  const payload = {};
  for (const f of FIELDS) if (body[f] !== undefined) payload[f] = body[f];
  const { errors, input } = normalizeInput(payload);
  if (errors.length) return send(res, 400, { error: errors.join('. ') });

  const store = getStore();
  if (!store) return send(res, 500, { error: NO_STORAGE });

  const now = new Date();
  const job = { audit_id: makeAuditId(now), created_at: now.toISOString(), input };
  if (store.kind === 'memory') {
    await store.mockAudit(job);
  } else {
    waitUntil(runAndSave(job, store));
  }
  return send(res, 202, { audit_id: job.audit_id, status: 'running' });
}
