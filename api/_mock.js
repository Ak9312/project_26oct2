// MOCK_MODE=1: serves sample data from memory so the app can be previewed
// without n8n. State resets whenever the function restarts.
import { SHEETS } from './_mock-data.js';
import { handleApi } from './_mock-handler.js';

const state = globalThis.__cqaMock || (globalThis.__cqaMock = {
  sheets: JSON.parse(JSON.stringify(SHEETS)),
  pending: new Map(),
});

function applyWrites(data) {
  for (const d of data) {
    const m = d.range.match(/^(\w+)!([A-Z]+)(\d+):([A-Z]+)\d+$/);
    const tab = state.sheets[m[1]];
    const col = m[2].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const row = Number(m[3]) - 1;
    while (tab.length <= row) tab.push([]);
    d.values[0].forEach((v, i) => { tab[row][col + i] = v; });
  }
}

function finishPending() {
  const now = Date.now();
  for (const [id, p] of state.pending) {
    if (now - p.started < 6000) continue;
    state.pending.delete(id);
    const src = state.sheets.Results[1].slice();
    const report = JSON.parse(src[14]);
    report.audit_id = id;
    report.created_at = new Date(p.started).toISOString();
    report.article.title = p.title || report.article.title;
    report.input.keyword = p.keyword || report.input.keyword;
    src[0] = id; src[1] = report.created_at; src[3] = report.article.title; src[4] = p.url || ''; src[5] = report.input.keyword;
    src[14] = JSON.stringify(report);
    state.sheets.Results.push(src);
    if (report.status === 'needs_review') {
      state.sheets.Review.push([id, report.created_at, report.article.title, p.url || '', report.total, report.review_reasons.join(' | '), '', 'pending', '', '']);
    }
  }
}

export function mockAudit(body) {
  if (!body.keyword) return { status: 400, data: { error: 'Primary keyword is required' } };
  if (!body.url && !body.content) return { status: 400, data: { error: 'Give either a URL or the article content' } };
  const id = 'aud_mock_' + Date.now().toString(36);
  state.pending.set(id, { started: Date.now(), title: body.heading || body.url, keyword: body.keyword, url: body.url });
  return { status: 202, data: { audit_id: id, status: 'running' } };
}

export function mockData(body) {
  finishPending();
  const out = handleApi(body, state.sheets, { pass_mark: 70 });
  if (out.write) applyWrites(out.write.data);
  return { status: out.status_code, data: out.response };
}
