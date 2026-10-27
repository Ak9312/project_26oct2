// Shared helpers for every page: API calls, password gate, header, formatting.

const PW_KEY = 'cqa_password';

export function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getPassword() {
  try { return sessionStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; }
}
function setPassword(v) {
  try { sessionStorage.setItem(PW_KEY, v); } catch (e) { /* private mode: ask again next time */ }
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, body) {
  let r;
  try {
    r = await fetch('/api/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-password': getPassword() },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  let data = {};
  try { data = await r.json(); } catch (e) { data = {}; }
  if (r.status === 401) {
    showGate(getPassword() ? 'That password was wrong. Try again.' : '');
    throw new ApiError('Password needed', 401);
  }
  if (!r.ok) throw new ApiError(data.error || 'Something went wrong (HTTP ' + r.status + ').', r.status);
  return data;
}

export function data(action, extra) {
  return api('data', Object.assign({ action }, extra || {}));
}

function showGate(message) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="gate">
      <form class="card" id="gate-form">
        <h1 style="margin:0;font-size:22px;font-weight:600">Enter the app password</h1>
        <p class="muted" style="margin:0">It's the APP_PASSWORD set in your Vercel project.</p>
        <div class="field">
          <label for="gate-pw">Password</label>
          <input id="gate-pw" type="password" autocomplete="current-password" required>
          ${message ? `<span class="field-error">${esc(message)}</span>` : ''}
        </div>
        <button class="btn primary" type="submit">Continue</button>
      </form>
    </div>`;
  const input = document.getElementById('gate-pw');
  input.focus();
  document.getElementById('gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setPassword(input.value);
    location.reload();
  });
}

const ICON_SHIELD = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2346D8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12l2 2 4-4"/><path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7z"/></svg>';

export function mountHeader(active) {
  const links = [
    ['home', '/', 'New audit'],
    ['review', '/review.html', 'Review queue <span class="count" id="pending-count" hidden></span>'],
    ['validation', '/review.html#validation', 'Validation'],
  ];
  document.getElementById('top').innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/">${ICON_SHIELD} Content Auditor</a>
        <nav class="nav" aria-label="Main">
          ${links.map(([id, href, label]) => `<a href="${href}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        </nav>
        <span class="status-dot" id="conn">Checking setup…</span>
      </div>
    </header>
    <div class="banner" id="setup-banner" hidden></div>`;
  fetch('/api/health').then((r) => r.json()).then((h) => {
    const el = document.getElementById('conn');
    if (h.mock) {
      el.textContent = 'Sample data (mock mode)';
      el.classList.add('mock');
      return;
    }
    const missing = Object.entries(h.configured || {}).filter(([, v]) => !v).map(([k]) => k);
    el.textContent = missing.length ? 'Setup incomplete' : 'n8n connected';
    if (missing.length) {
      el.classList.add('mock');
      const b = document.getElementById('setup-banner');
      b.innerHTML = `<div>Missing Vercel environment variables: ${missing.map(esc).join(', ')}. See the README.</div>`;
      b.hidden = false;
    }
  }).catch(() => { document.getElementById('conn').textContent = ''; });
}

export function setPendingCount(n) {
  const el = document.getElementById('pending-count');
  if (!el) return;
  el.textContent = n;
  el.hidden = !n;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function statusPill(status) {
  if (status === 'passed') return '<span class="pill ok">Passed</span>';
  if (status === 'needs_review') return '<span class="pill warn">Needs review</span>';
  if (status === 'error') return '<span class="pill bad">Failed</span>';
  return '<span class="pill neutral">' + esc(status || 'Running') + '</span>';
}

export function bar(score, max, warnBelow) {
  const pct = max ? Math.max(0, Math.min(100, (score / max) * 100)) : 0;
  const warn = warnBelow !== undefined && pct < warnBelow;
  return `<div class="bar${warn ? ' warn' : ''}" role="img" aria-label="${esc(score)} of ${esc(max)}"><i style="width:${pct.toFixed(1)}%"></i></div>`;
}

export function fmtNum(n, digits) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(digits === undefined ? 0 : digits);
}

export function showError(container, err) {
  if (err && err.status === 401) return;
  container.innerHTML = `<div class="form-error" role="alert">${esc(err && err.message ? err.message : err)}</div>`;
}
