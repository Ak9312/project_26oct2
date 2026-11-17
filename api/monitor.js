// POST /api/monitor — the Monitoring page (AIOps backend).
//   { action: 'get' }        → run logs, numbers, API health, failures, alerts
//   { action: 'check_apis' } → pings Groq, SerpAPI, a test page and Copyscape
//                              on free endpoints, saves and returns the result
import { send, requireAuth, readBody, MOCK, NO_STORAGE } from './_lib.js';
import { getStore } from './_store.js';
import { auditConfig, monitorResponse, checkApis, withApiCheck } from './_engine.js';

function mockCheck() {
  const ok = (detail, ms) => ({ status: 'ok', ms, error: '', detail });
  return {
    at: new Date().toISOString(),
    ok: true,
    results: {
      groq: ok('Key works; model openai/gpt-oss-120b is available (sample)', 310),
      serpapi: Object.assign(ok('212 searches left this month (sample)', 420), { searches_left: 212 }),
      page: ok('The server can read web pages (sample)', 180),
      copyscape: { status: 'not_set_up', ms: 0, error: '', detail: 'Not set up: originality uses the free exact-sentence search through SerpAPI' },
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!requireAuth(req, res)) return;
  const body = readBody(req);
  const store = getStore();
  if (!store) return send(res, 500, { error: NO_STORAGE });
  const cfg = auditConfig(process.env);

  try {
    if (body.action === 'get') {
      const [doc, index] = await Promise.all([store.getMonitor(), store.getIndex()]);
      return send(res, 200, monitorResponse(doc, index, cfg.passMark));
    }
    if (body.action === 'check_apis') {
      const check = MOCK ? mockCheck() : await checkApis(cfg, { fetch: globalThis.fetch, now: () => Date.now() });
      try {
        await store.updateMonitor((doc) => ({ monitor: withApiCheck(doc, check) }));
      } catch (e) {
        console.error('Saving the API check failed', e);
      }
      return send(res, 200, check);
    }
    return send(res, 400, { error: 'Unknown action' });
  } catch (e) {
    console.error('Monitor request failed', body.action, e);
    return send(res, 502, { error: "Couldn't read the monitoring logs from storage. Try again in a moment." });
  }
}
