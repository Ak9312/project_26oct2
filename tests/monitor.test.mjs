// Monitoring page logic: numbers, alerts, API health and "Check APIs now".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRun, emptyMonitor, withApiCheck, monitorResponse, checkApis, redact, auditConfig, THRESHOLDS } from '../api/_engine.js';

let n = 0;
function run(over) {
  n += 1;
  return Object.assign({
    audit_id: 'aud_t_' + String(n).padStart(6, '0'),
    at: new Date(Date.UTC(2026, 10, 17, 10, n)).toISOString(),
    title: 'Article ' + n, url: '', keyword: 'k', model: 'm',
    total_ms: 90000, outcome: 'ok', score: 80, status: 'passed', failed_step: '', error: '',
    crashed: false, retries: 0, recovered: false, ai_calls: 3, ai_failed: false, tokens: 8000, slow: false,
    steps: [{ name: 'ai_analysis', label: 'AI analysis (Groq)', status: 'ok', error: '', retries: 0 }],
    apis: { groq: { calls: 3, failed: 0, ms: 1, last_error: '' }, serpapi: { calls: 5, failed: 0, ms: 1, last_error: '' } },
  }, over || {});
}
const docOf = (runs) => runs.slice().reverse().reduce((d, r) => addRun(d, r), emptyMonitor());

test('addRun keeps newest first, replaces the same audit and caps the list', () => {
  let d = emptyMonitor();
  const a = run();
  d = addRun(d, a);
  d = addRun(d, run());
  d = addRun(d, Object.assign({}, a, { score: 10 }));
  assert.equal(d.runs.length, 2);
  assert.equal(d.runs[0].audit_id, a.audit_id);
  assert.equal(d.runs[0].score, 10);
  for (let i = 0; i < 320; i++) d = addRun(d, run());
  assert.equal(d.runs.length, 300);
});

test('all healthy: numbers add up and there are no alerts', () => {
  const m = monitorResponse(docOf([run(), run(), run(), run()]), { audits: [] }, 70);
  assert.equal(m.summary.audits, 4);
  assert.equal(m.summary.success_rate, 1);
  assert.equal(m.summary.avg_ms, 90000);
  assert.equal(m.summary.ai_failure_rate, 0);
  assert.equal(m.summary.slow, 0);
  assert.deepEqual(m.alerts, []);
  assert.equal(m.health.find((h) => h.name === 'groq').status, 'ok');
  assert.equal(m.health.find((h) => h.name === 'copyscape').status, 'unknown');
});

test('AI failure rate over 20% raises an alert', () => {
  const fail = { ai_failed: true, outcome: 'failed', status: 'error', failed_step: 'ai_analysis', error: 'Groq rate limit reached (429)', score: null };
  const m = monitorResponse(docOf([run(fail), run(), run(), run(fail)]), { audits: [] }, 70);
  assert.equal(m.summary.ai_failure_rate, 0.5);
  const a = m.alerts.find((x) => x.key === 'ai_failures');
  assert.ok(a);
  assert.equal(a.level, 'bad');
  assert.equal(m.summary.success_rate, 0.5);
  assert.equal(m.failures.length, 2);
  assert.equal(m.failures[0].step_label, 'AI analysis (Groq)');
});

test('exactly 20% AI failures is not an alert (the limit is "over 20%")', () => {
  const runs = [run({ ai_failed: true }), run(), run(), run(), run()];
  const m = monitorResponse(docOf(runs), { audits: [] }, 70);
  assert.equal(m.summary.ai_failure_rate, 0.2);
  assert.ok(!m.alerts.find((x) => x.key === 'ai_failures'));
});

test('slow audits (over 3 min) are counted and flagged', () => {
  const m = monitorResponse(docOf([run({ total_ms: 200000, slow: true }), run()]), { audits: [] }, 70);
  assert.equal(m.summary.slow, 1);
  assert.ok(m.alerts.find((x) => x.key === 'slow'));
  assert.equal(THRESHOLDS.slow_ms, 180000);
});

test('cost spike: the latest audit uses over 2× the usual tokens', () => {
  const runs = [run(), run(), run(), run({ tokens: 20000 })]; // last one is newest
  const m = monitorResponse(docOf(runs.slice().reverse()), { audits: [] }, 70);
  assert.ok(m.alerts.find((x) => x.key === 'cost'));
  const calm = monitorResponse(docOf([run({ tokens: 9000 }), run(), run(), run()]), { audits: [] }, 70);
  assert.ok(!calm.alerts.find((x) => x.key === 'cost'));
});

test('accuracy under 80% against your own scores raises an alert', () => {
  const e = (total, mine) => ({ audit_id: 'x' + total + mine, total, validation: { my_total: mine } });
  const index = { audits: [e(80, 80), e(75, 60), e(60, 80), e(90, 90), e(50, 50)] }; // 3 of 5 agree
  const m = monitorResponse(docOf([run()]), index, 70);
  assert.equal(m.summary.accuracy.scored, 5);
  assert.equal(m.summary.accuracy.rate, 0.6);
  assert.ok(m.alerts.find((x) => x.key === 'accuracy'));
  const few = monitorResponse(docOf([run()]), { audits: index.audits.slice(0, 4) }, 70);
  assert.ok(!few.alerts.find((x) => x.key === 'accuracy')); // too few scored yet
});

test('an API is "down" when the check fails or its last 3 audits all failed on it', () => {
  const dead = { apis: { serpapi: { calls: 2, failed: 2, ms: 1, last_error: 'HTTP 401' } } };
  const m = monitorResponse(docOf([run(dead), run(dead), run(dead)]), { audits: [] }, 70);
  const serp = m.health.find((h) => h.name === 'serpapi');
  assert.equal(serp.status, 'down');
  assert.equal(serp.last_error, 'HTTP 401');
  assert.ok(m.alerts.find((x) => x.key === 'api_serpapi'));

  const check = { at: '2026-11-17T10:00:00Z', ok: false, results: { groq: { status: 'down', error: 'Key rejected (401).' }, serpapi: { status: 'ok' }, page: { status: 'ok' }, copyscape: { status: 'not_set_up' } } };
  const m2 = monitorResponse(withApiCheck(docOf([run()]), check), { audits: [] }, 70);
  assert.equal(m2.health.find((h) => h.name === 'groq').status, 'down');
  assert.equal(m2.health.find((h) => h.name === 'copyscape').status, 'not_set_up');
  assert.match(m2.alerts.find((x) => x.key === 'api_groq').detail, /401/);
});

test('failures list says whether a retry saved the audit', () => {
  const m = monitorResponse(docOf([
    run({ outcome: 'partial', failed_step: 'section_gaps', error: 'None of the top pages could be read', steps: [{ name: 'section_gaps', status: 'failed', error: 'x', retries: 0 }] }),
    run({ outcome: 'failed', failed_step: 'fetch', error: 'HTTP 403', steps: [{ name: 'fetch', status: 'failed', error: 'HTTP 403', retries: 0 }] }),
  ]), { audits: [] }, 70);
  assert.deepEqual(m.failures.map((f) => [f.step, f.outcome, f.retry_saved]), [['section_gaps', 'partial', false], ['fetch', 'failed', false]]);
});

function fakeFetch(routes) {
  const seen = [];
  return {
    seen,
    fetch: async (url, opts) => {
      seen.push({ url, opts });
      for (const [prefix, fn] of routes) if (url.startsWith(prefix)) return fn(url, opts);
      throw new Error('unexpected ' + url);
    },
  };
}
const reply = (status, body) => ({ ok: status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const deps = (f) => ({ fetch: f.fetch, now: () => 1763373600000 });

test('Check APIs now: all working, on free endpoints only', async () => {
  const f = fakeFetch([
    ['https://api.groq.com/openai/v1/models', () => reply(200, { data: [{ id: 'openai/gpt-oss-120b' }] })],
    ['https://serpapi.com/account.json', () => reply(200, { total_searches_left: 180 })],
    ['https://example.com/', () => reply(200, '<html>' + 'x'.repeat(500) + '</html>')],
  ]);
  const c = await checkApis(auditConfig({ GROQ_API_KEY: 'gsk_live', SERPAPI_KEY: 'serp_live' }), deps(f));
  assert.equal(c.ok, true);
  assert.equal(c.results.groq.status, 'ok');
  assert.equal(c.results.serpapi.searches_left, 180);
  assert.equal(c.results.copyscape.status, 'not_set_up');
  assert.ok(!f.seen.some((x) => /search\.json|chat\/completions/.test(x.url))); // no paid calls
  assert.ok(!JSON.stringify(c).includes('serp_live'));
  assert.ok(!JSON.stringify(c).includes('gsk_live'));
});

test('Check APIs now: bad Groq key, missing model, no searches left', async () => {
  const f = fakeFetch([
    ['https://api.groq.com/', () => reply(401, { error: { message: 'Invalid API Key' } })],
    ['https://serpapi.com/', () => reply(200, { total_searches_left: 0 })],
    ['https://example.com/', () => { throw new Error('getaddrinfo ENOTFOUND example.com'); }],
  ]);
  const c = await checkApis(auditConfig({ GROQ_API_KEY: 'gsk_live', SERPAPI_KEY: 'serp_live' }), deps(f));
  assert.equal(c.ok, false);
  assert.match(c.results.groq.error, /Key rejected \(401\)/);
  assert.match(c.results.serpapi.error, /No searches left/);
  assert.match(c.results.page.error, /ENOTFOUND/);

  const f2 = fakeFetch([
    ['https://api.groq.com/', () => reply(200, { data: [{ id: 'llama-3.1-8b-instant' }] })],
    ['https://serpapi.com/', () => reply(200, { error: 'Invalid API key.' })],
    ['https://example.com/', () => reply(200, 'x'.repeat(500))],
  ]);
  const c2 = await checkApis(auditConfig({ GROQ_API_KEY: 'gsk_live', SERPAPI_KEY: 'serp_live' }), deps(f2));
  assert.match(c2.results.groq.error, /not in your Groq model list/);
  assert.equal(c2.results.serpapi.status, 'down');
});

test('redact hides keys in URLs, headers and key-shaped strings', () => {
  const s = redact('GET https://serpapi.com/search.json?q=a&api_key=abc123 Bearer gsk_abcdefghijkl and sk-or-v1-zzzzzzzzzz &k=secret');
  for (const bad of ['abc123', 'gsk_abcdefghijkl', 'sk-or-v1-zzzzzzzzzz', 'secret']) assert.ok(!s.includes(bad), bad);
});

// ---- 👍 / 👎 feedback and "Download flagged entries"
import { applyFeedback, flaggedExport, upsertEntry, summarize, buildErrorReport, reviewListResponse, listResponse, getResponse, replaceEntry } from '../api/_engine.js';

const entry = (id, over) => Object.assign({ audit_id: id, created_at: '2026-11-17T10:00:00Z', status: 'passed', title: 'T ' + id, url: '', keyword: 'k', total: 80, accuracy: 25, readability: 15, keywords: 15, sections: 15, plagiarism: 10, review_reasons: [], review: null, validation: null, feedback: null }, over || {});

test('feedback: 👍, 👎 with a note, and clearing it', () => {
  let idx = { audits: [entry('aud_a'), entry('aud_b')] };
  const up = applyFeedback(idx, { audit_id: 'aud_a', vote: 'up', note: 'ignored' });
  assert.equal(up.feedback.vote, 'up');
  assert.equal(up.feedback.note, '');
  const down = applyFeedback(idx, { audit_id: 'aud_b', vote: 'down', note: '  score too low  ' + 'x'.repeat(600) });
  assert.equal(down.feedback.vote, 'down');
  assert.ok(down.feedback.note.startsWith('score too low'));
  assert.equal(down.feedback.note.length, 500);
  idx = replaceEntry(idx, down.entry);
  assert.equal(applyFeedback(idx, { audit_id: 'aud_b', vote: '' }).feedback, null);
  assert.equal(applyFeedback(idx, { audit_id: 'aud_b', vote: 'meh' }).status, 400);
  assert.equal(applyFeedback(idx, { audit_id: 'aud_zzz', vote: 'up' }).status, 404);
});

test('a 👎 sends a passed audit to the review queue, with the note as the reason', () => {
  let idx = { audits: [entry('aud_a'), entry('aud_b')] };
  idx = replaceEntry(idx, applyFeedback(idx, { audit_id: 'aud_b', vote: 'down', note: 'missed a section' }).entry);
  const q = reviewListResponse(idx).items;
  assert.deepEqual(q.map((i) => i.audit_id), ['aud_b']);
  assert.match(q[0].review_reasons.join(' '), /👎: missed a section/);
  assert.equal(listResponse(idx, 70).pending_reviews, 1);
  // the list doesn't leak feedback; the report response carries it
  assert.equal(listResponse(idx, 70).audits[0].feedback, undefined);
  const rec = { report: buildErrorReport({ audit_id: 'aud_b', created_at: 'x', input: { url: 'u', keyword: 'k' }, error: 'e' }) };
  assert.equal(getResponse(idx, rec, 'aud_b', 70).feedback.note, 'missed a section');
});

test('feedback survives the audit being saved again', () => {
  let idx = { audits: [entry('aud_a', { feedback: { vote: 'down', note: 'n', at: 'x' } })] };
  const rep = buildErrorReport({ audit_id: 'aud_a', created_at: '2026-11-17T10:00:00Z', input: { url: 'u', keyword: 'k' }, error: 'e' });
  idx = upsertEntry(idx, summarize(rep));
  assert.equal(idx.audits[0].feedback.vote, 'down');
});

test('Monitoring counts 👍/👎 and alerts when over 20% are 👎', () => {
  const fb = (v) => ({ vote: v, note: '', at: 'x' });
  const idx = { audits: [entry('a1', { feedback: fb('up') }), entry('a2', { feedback: fb('down') }), entry('a3', { feedback: fb('up') }), entry('a4')] };
  const m = monitorResponse(docOf([run()]), idx, 70);
  assert.deepEqual([m.summary.feedback.rated, m.summary.feedback.up, m.summary.feedback.down], [3, 2, 1]);
  assert.ok(m.alerts.find((a) => a.key === 'thumbs')); // 33% > 20%
  const few = monitorResponse(docOf([run()]), { audits: idx.audits.slice(0, 2) }, 70);
  assert.ok(!few.alerts.find((a) => a.key === 'thumbs')); // fewer than 3 rated
});

test('Download flagged entries: failed runs, 👎 audits, review queue and disagreements, without keys', () => {
  const doc = docOf([
    run({ outcome: 'failed', failed_step: 'fetch', error: 'HTTP 404', steps: [{ name: 'fetch', label: 'Fetch article page', status: 'failed', error: 'HTTP 404', retries: 0, retry_reasons: [] }] }),
    run({ steps: [{ name: 'ai_analysis', label: 'AI analysis (Groq)', status: 'ok', error: '', retries: 1, recovered: true, retry_reasons: ['Bad JSON'] }], retries: 1, recovered: true }),
    run(),
  ]);
  const idx = { audits: [
    entry('aud_d', { feedback: { vote: 'down', note: 'see https://x.test/?api_key=SECRET123', at: 'x' } }),
    entry('aud_r', { status: 'needs_review', total: 60, review_reasons: ['Total 60 is below 70'] }),
    entry('aud_v', { total: 80, validation: { my_total: 50 } }),
  ] };
  const f = flaggedExport(doc, idx, 70, Date.UTC(2026, 10, 17));
  assert.equal(f.filename, 'flagged-entries-2026-11-17.md');
  assert.deepEqual(f.counts, { failed: 2, thumbs_down: 1, review: 1, mismatched: 1 });
  assert.match(f.text, /Fetch article page: FAILED HTTP 404/);
  assert.match(f.text, /1 retry, saved by the retry \(Bad JSON\)/);
  assert.match(f.text, /auditor 80 vs mine 50/);
  assert.ok(!f.text.includes('SECRET123'));
  assert.match(f.text, /Please find the patterns/);
});
