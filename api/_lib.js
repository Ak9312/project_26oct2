// Shared helpers for the Vercel API routes. Files starting with "_" are not
// exposed as routes.
import { timingSafeEqual, createHash } from 'node:crypto';

export const MOCK = process.env.MOCK_MODE === '1';

export function send(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sameSecret(a, b) {
  // Hash first so lengths always match for timingSafeEqual.
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

// APP_PASSWORD is optional. When it's set, every route needs it. When it's
// not set, the app is open to anyone with the link (the owner's choice); the
// n8n webhook secret still keeps n8n itself from being called directly.
export function requireAuth(req, res) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  const given = req.headers['x-app-password'] || '';
  if (!given || !sameSecret(given, expected)) {
    send(res, 401, { error: 'Wrong or missing password.' });
    return false;
  }
  return true;
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return {};
}

export async function callN8n(path, payload) {
  const base = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const secret = process.env.N8N_WEBHOOK_SECRET || '';
  if (!base || !secret) {
    return { status: 500, data: { error: 'N8N_BASE_URL and N8N_WEBHOOK_SECRET must be set in the Vercel project settings.' } };
  }
  let r;
  try {
    r = await fetch(base + '/webhook/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auditor-secret': secret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    return { status: 502, data: { error: "Couldn't reach n8n. Check N8N_BASE_URL and that both workflows are active." } };
  }
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: 'n8n returned a non-JSON reply (HTTP ' + r.status + ').' }; }
  if (r.status === 403 || r.status === 401) data = { error: 'n8n rejected the webhook secret. N8N_WEBHOOK_SECRET must match the n8n header credential.' };
  if (r.status === 404) data = { error: 'n8n webhook not found. Activate both workflows in n8n.' };
  return { status: r.status, data };
}
