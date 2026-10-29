// POST /api/data — reads and saves app data: audit list, one report, review
// queue and validation scores.
import { send, requireAuth, readBody, validAuditId, NO_STORAGE } from './_lib.js';
import { getStore } from './_store.js';
import {
  auditConfig, listResponse, getResponse, reviewListResponse, applyReview, applyValidation,
  replaceEntry, validationResponse,
} from './_engine.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!requireAuth(req, res)) return;
  const body = readBody(req);
  const store = getStore();
  if (!store) return send(res, 500, { error: NO_STORAGE });
  const passMark = auditConfig(process.env).passMark;
  const needsId = ['get', 'review_save', 'validation_save'].indexOf(body.action) >= 0;
  if (needsId && !validAuditId(body.audit_id)) return send(res, 400, { error: 'Missing or invalid audit ID' });

  try {
    switch (body.action) {
      case 'list':
        return send(res, 200, listResponse(await store.getIndexSynced(), passMark));
      case 'get': {
        // While an audit runs there is no report yet: one cheap read per poll.
        const record = await store.getRecord(body.audit_id);
        if (!record) return send(res, 200, getResponse({ audits: [] }, null, body.audit_id, passMark));
        return send(res, 200, getResponse(await store.getIndex(), record, body.audit_id, passMark));
      }
      case 'review_list':
        return send(res, 200, reviewListResponse(await store.getIndex()));
      case 'review_save': {
        const out = await store.updateIndex((idx) => {
          const r = applyReview(idx, body);
          return r.entry ? { index: replaceEntry(idx, r.entry) } : r;
        });
        return out.index ? send(res, 200, { saved: true }) : send(res, out.status, out.response);
      }
      case 'validation':
        return send(res, 200, validationResponse(await store.getIndex(), passMark));
      case 'validation_save': {
        const out = await store.updateIndex((idx) => {
          const r = applyValidation(idx, body);
          return r.entry ? { index: replaceEntry(idx, r.entry), my_total: r.my_total } : r;
        });
        return out.index ? send(res, 200, { saved: true, my_total: out.my_total }) : send(res, out.status, out.response);
      }
      default:
        return send(res, 400, { error: 'Unknown action' });
    }
  } catch (e) {
    console.error('Data request failed', body.action, e);
    return send(res, 502, { error: "Couldn't read or save audits in storage. Try again in a moment." });
  }
}
