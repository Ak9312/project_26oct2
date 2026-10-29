// GET /api/export — every audit as a CSV file (opens in Google Sheets or
// Excel): scores, review decisions and your validation scores.
import { send, requireAuth, NO_STORAGE } from './_lib.js';
import { getStore } from './_store.js';
import { toCsv } from './_engine.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Use GET' });
  if (!requireAuth(req, res)) return;
  const store = getStore();
  if (!store) return send(res, 500, { error: NO_STORAGE });
  try {
    const csv = toCsv(await store.getIndexSynced());
    const day = new Date().toISOString().slice(0, 10);
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="content-audits-' + day + '.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(csv);
  } catch (e) {
    console.error('Export failed', e);
    send(res, 502, { error: "Couldn't read audits from storage." });
  }
}
