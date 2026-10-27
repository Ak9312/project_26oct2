// GET /api/health — which settings are present (never their values).
// GET /api/health?check=storage — also writes and reads back one small file
// to prove the Blob store works (costs one Blob write).
import { send, MOCK } from './_lib.js';
import { storageConfigured, getStore } from './_store.js';

export default async function handler(req, res) {
  const has = (k) => Boolean((process.env[k] || '').trim());
  const out = {
    ok: true,
    mock: MOCK,
    password_required: has('APP_PASSWORD'),
    required: {
      GROQ_API_KEY: has('GROQ_API_KEY'),
      STORAGE: storageConfigured(),
    },
    optional: {
      SERPAPI_KEY: has('SERPAPI_KEY'),
      COPYSCAPE: has('COPYSCAPE_USERNAME') && has('COPYSCAPE_API_KEY'),
    },
  };
  const url = new URL(req.url || '/', 'http://x');
  if (url.searchParams.get('check') === 'storage') {
    const store = getStore();
    if (!store) {
      out.storage_check = 'not connected';
    } else {
      try {
        const stamp = new Date().toISOString();
        await store.putRecord({ audit_id: 'health_check', report: { stamp } });
        const back = await store.getRecord('health_check');
        out.storage_check = back && back.report && back.report.stamp === stamp ? 'ok' : 'read-back mismatch';
      } catch (e) {
        out.storage_check = 'failed: ' + String((e && e.message) || e).slice(0, 160);
      }
    }
  }
  send(res, 200, out);
}
