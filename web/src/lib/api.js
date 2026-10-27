// Talks to the Vercel API routes in /api. Handles the optional app password.
const PW_KEY = 'cqa_password';
let onPasswordNeeded = () => {};

export function setPasswordHandler(fn) { onPasswordNeeded = fn; }
export function getPassword() {
  try { return sessionStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; }
}
export function savePassword(v) {
  try { sessionStorage.setItem(PW_KEY, v); } catch (e) { /* private mode */ }
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, init) {
  let r;
  try {
    r = await fetch('/api/' + path, Object.assign({}, init, {
      headers: Object.assign({ 'x-app-password': getPassword() }, init && init.headers),
    }));
  } catch (e) {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  if (r.status === 401) {
    onPasswordNeeded(Boolean(getPassword()));
    throw new ApiError('Password needed', 401);
  }
  return r;
}

export async function api(path, body) {
  const r = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  let data = {};
  try { data = await r.json(); } catch (e) { data = {}; }
  if (!r.ok) throw new ApiError(data.error || 'Something went wrong (HTTP ' + r.status + ').', r.status);
  return data;
}

export function data(action, extra) {
  return api('data', Object.assign({ action }, extra || {}));
}

export async function health() {
  const r = await fetch('/api/health');
  return r.json();
}

export async function downloadCsv() {
  const r = await request('export', { method: 'GET' });
  if (!r.ok) {
    let msg = 'Download failed (HTTP ' + r.status + ').';
    try { msg = (await r.json()).error || msg; } catch (e) { /* keep */ }
    throw new ApiError(msg, r.status);
  }
  const m = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = m ? m[1] : 'content-audits.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
