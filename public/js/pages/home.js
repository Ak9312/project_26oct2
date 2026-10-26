import { mountHeader, setPendingCount, data, api, esc, fmtDate, statusPill, showError, bar } from '../app.js';
import { PARAMS } from '../validation.js';

mountHeader('home');

document.getElementById('weights').innerHTML = PARAMS.map((p) => `
  <div><div class="line"><span>${esc(p.label)}</span><span class="mono">${p.max}</span></div>${bar(p.max, 30)}</div>`).join('');

let mode = 'url';
const form = document.getElementById('audit-form');
const errBox = document.getElementById('form-error');

function setMode(m) {
  mode = m;
  form.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== m; });
}
form.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

const content = document.getElementById('content');
content.addEventListener('input', () => {
  const n = (content.value.match(/[\p{L}\p{N}]+/gu) || []).length;
  document.getElementById('content-count').textContent = n.toLocaleString() + ' words';
});

function fail(msg) {
  errBox.innerHTML = `<div class="form-error" role="alert">${esc(msg)}</div>`;
  errBox.hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.hidden = true;
  const f = new FormData(form);
  const body = {
    keyword: String(f.get('keyword') || '').trim(),
    secondary: String(f.get('secondary') || ''),
    target_grade: Number(f.get('target_grade')),
    market: f.get('market'),
  };
  if (mode === 'url') {
    body.url = String(f.get('url') || '').trim();
    if (!/^https?:\/\/\S+\.\S+/.test(body.url)) return fail('Enter the full article URL, starting with https://');
  } else {
    body.heading = String(f.get('heading') || '').trim();
    body.content = String(f.get('content') || '');
    body.meta_description = String(f.get('meta_description') || '').trim();
    if (!body.heading) return fail('Add the article heading.');
    if (body.content.trim().split(/\s+/).length < 50) return fail('Paste the full article — at least 50 words.');
  }
  if (!body.keyword) return fail('Add the primary keyword.');

  const btn = document.getElementById('run');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try {
    const r = await api('audit', body);
    location.href = '/report.html?id=' + encodeURIComponent(r.audit_id);
  } catch (err) {
    if (err.status !== 401) fail(err.message);
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  }
});

async function loadRecent() {
  const box = document.getElementById('recent');
  try {
    const r = await data('list');
    setPendingCount(r.pending_reviews);
    document.getElementById('pass-mark').textContent = r.pass_mark;
    if (!r.audits.length) {
      box.innerHTML = '<div class="empty">No audits yet. Run your first one above.</div>';
      return;
    }
    document.getElementById('recent-note').textContent = 'Latest ' + Math.min(r.audits.length, 20) + ' of ' + r.audits.length;
    box.innerHTML = `<div class="table-wrap"><table style="min-width:720px">
      <thead><tr><th>Article</th><th>Primary keyword</th><th>Score</th><th>Status</th><th>Audited</th></tr></thead>
      <tbody>${r.audits.slice(0, 20).map((a) => `
        <tr>
          <td><a href="/report.html?id=${encodeURIComponent(a.audit_id)}" style="text-decoration:none;font-weight:500">${esc(a.title || a.url || a.audit_id)}</a></td>
          <td style="color:var(--ink-2)">${esc(a.keyword)}</td>
          <td class="mono" style="font-weight:500">${esc(a.total)}</td>
          <td>${statusPill(a.status)}</td>
          <td class="muted">${fmtDate(a.created_at)}</td>
        </tr>`).join('')}</tbody></table></div>`;
  } catch (err) {
    showError(box, err);
  }
}
loadRecent();
