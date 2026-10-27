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
// not set, the app is open to anyone with the link (the owner's choice).
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

export function validAuditId(id) {
  return typeof id === 'string' && /^aud_[a-z0-9_]{6,60}$/.test(id);
}

export const NO_STORAGE = 'Storage is not connected. In Vercel, open the project → Storage, and connect the Blob store, then redeploy.';
