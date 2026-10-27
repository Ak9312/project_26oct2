// Runs the whole audit pipeline with every outside service faked:
// Groq, SerpAPI, Copyscape, the article site and competitor pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAudit, auditConfig, normalizeInput, summarize, upsertEntry, toCsv } from '../api/_engine.js';

const groqReply = (obj) => ({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(obj) } }] });

const ARTICLE = [
  'Composting at home turns kitchen scraps into rich soil for your garden. ' + 'It is simple and cheap. '.repeat(10),
  '## What is composting',
  'Composting is the natural breakdown of food and garden waste. Microbes do the work when air and water are present.',
  '## Greens and browns',
  'Greens are wet scraps like peels. Browns are dry leaves and cardboard. Use a compost bin to hold them.',
  '## Common mistakes',
  'Meat and dairy are fine in any home bin. Too much water makes the pile smell.',
  '## Conclusion',
  'Start small and keep going.',
].join('\n');

const COMPETITOR_HTML = '<html><title>Guide</title><body><article><h1>Guide</h1><p>' + 'word '.repeat(900) + '</p>' +
  '<h2>What to compost</h2><p>x</p><h2>Troubleshooting smells</h2><p>y</p><h2>FAQ</h2><p>z</p></article></body></html>';

function response(status, body, headers) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headers || {})[k.toLowerCase()] ?? null },
    text: async () => text,
  };
}

// handlers: { groq: [fn per call in order] | fn, serp, copyscape, page }
function fakeWorld(h) {
  const calls = [];
  let t = 0;
  let groqN = 0;
  const deps = {
    now: () => t,
    sleep: async (ms) => { calls.push({ kind: 'sleep', ms }); t += ms; },
    fetch: async (url, opts) => {
      t += 500;
      if (url.startsWith('https://api.groq.com/')) {
        const body = JSON.parse(opts.body);
        calls.push({ kind: 'groq', body, auth: opts.headers.Authorization });
        const fn = Array.isArray(h.groq) ? h.groq[groqN] : h.groq;
        groqN += 1;
        return fn(body, groqN);
      }
      if (url.startsWith('https://serpapi.com/')) {
        const q = new URL(url).searchParams;
        calls.push({ kind: 'serp', q: q.get('q'), gl: q.get('gl'), key: q.get('api_key') });
        return h.serp(q);
      }
      if (url.startsWith('https://www.copyscape.com/')) {
        const q = new URL(url).searchParams;
        calls.push({ kind: 'copyscape', q: Object.fromEntries(q), body: opts.body });
        return h.copyscape(q, opts.body);
      }
      calls.push({ kind: 'page', url });
      return h.page(url);
    },
  };
  return { deps, calls, elapsed: () => t };
}

const analysisOk = (body) => {
  assert.equal(body.model, 'openai/gpt-oss-120b');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.reasoning_effort, 'low');
  return response(200, groqReply({
    sections: [{ index: 0, score: 9 }, { index: 1, score: 8 }, { index: 2, score: 5, note: 'drifts' }, { index: 3, score: 7 }],
    title_promise: { score: 3 }, freshness: { score: 5 },
    claims: [
      { claim: 'Meat and dairy are fine in any home bin', search_query: 'can you compost meat dairy home bin' },
      { claim: 'Microbes break down compost', search_query: 'microbes compost breakdown' },
    ],
    related_terms: ['compost bin', 'vermicomposting'],
    intent: { expected: 'informational', score: 3 },
  }));
};
const verifyOk = (body) => {
  const items = JSON.parse(body.messages[1].content.split('<results>\n')[1].split('\n</results>')[0]);
  return response(200, groqReply({ claims: [
    { i: 0, status: 'false', source_url: items[0].search_results[0].url, evidence: 'Not in standard bins' },
    { i: 1, status: 'verified', source_url: items[1].search_results[0].url },
  ] }));
};
const gapOk = () => response(200, groqReply({ topics: [
  { subtopic: 'Troubleshooting smells', found_in: 3, coverage: 'missing' },
  { subtopic: 'What to compost', found_in: 3, coverage: 'thin' },
] }));

function world(over) {
  return fakeWorld(Object.assign({
    groq: [analysisOk, verifyOk, gapOk],
    serp: (q) => (q.get('q') === 'composting at home'
      ? response(200, { organic_results: [1, 2, 3].map((i) => ({ link: 'https://comp' + i + '.example/guide', title: 'Comp ' + i })) })
      : response(200, { organic_results: [{ link: 'https://src.example/' + encodeURIComponent(q.get('q')), title: 'Source', snippet: 'info' }] })),
    copyscape: () => response(200, { querywords: 120, count: 1, allpercentmatched: 4, result: [{ url: 'https://copy.example', title: 'Copy', minwordsmatched: 12, percentmatched: 4 }] }),
    page: () => response(200, COMPETITOR_HTML),
  }, over || {}));
}

const ENV = { GROQ_API_KEY: 'gsk_test', SERPAPI_KEY: 'serp_test', COPYSCAPE_USERNAME: 'me', COPYSCAPE_API_KEY: 'cs_test' };
function job(body) {
  const { errors, input } = normalizeInput(Object.assign({ heading: 'Composting at home', content: ARTICLE, keyword: 'composting at home', market: 'in-en' }, body || {}));
  assert.deepEqual(errors, []);
  return { audit_id: 'aud_test_000001', created_at: '2026-10-27T10:00:00Z', input };
}

test('full audit with every service working', async () => {
  const w = world();
  const r = await runAudit(job(), auditConfig(ENV), w.deps);
  const p = r.parameters;
  assert.equal(r.total, p.accuracy.score + p.readability.score + p.keywords.score + p.sections.score + p.plagiarism.score);
  assert.equal(p.accuracy.claim_counts.false, 1);
  assert.equal(p.accuracy.claim_counts.verified, 1);
  assert.equal(p.sections.competitor_count, 3);
  assert.equal(p.sections.points.coverage, 3); // 0 covered + 0.5 thin of 2 topics → 12*0.25
  assert.equal(p.plagiarism.percent, 4);
  assert.equal(r.status, 'needs_review'); // false claim is a hard flag
  const groq = w.calls.filter((c) => c.kind === 'groq');
  assert.equal(groq.length, 3);
  assert.equal(groq[0].auth, 'Bearer gsk_test');
  assert.deepEqual(w.calls.filter((c) => c.kind === 'sleep').map((c) => c.ms), [15000, 15000]);
  const cs = w.calls.find((c) => c.kind === 'copyscape');
  assert.deepEqual([cs.q.o, cs.q.c, cs.q.f, cs.q.u, cs.q.k], ['csearch', '3', 'json', 'me', 'cs_test']);
  assert.match(cs.body, /Composting at home/);
  assert.ok(w.elapsed() < 270000);
});

test('Groq 429 is retried after retry-after, then succeeds', async () => {
  let first = true;
  const w = world({
    groq: [
      () => { if (first) { first = false; return response(429, { error: { message: 'Rate limit reached for model', code: 'rate_limit_exceeded' } }, { 'retry-after': '7' }); } },
      analysisOk, verifyOk, gapOk,
    ],
  });
  const r = await runAudit(job(), auditConfig(ENV), w.deps);
  assert.equal(w.calls.filter((c) => c.kind === 'sleep')[0].ms, 7000);
  assert.equal(r.parameters.accuracy.claim_counts.total, 2);
  assert.ok(!r.flags.some((f) => f.code === 'step_error'));
});

test('Groq rate limit that never clears ends with a clear error, not a hang', async () => {
  const w = world({ groq: () => response(429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '3' }) });
  const r = await runAudit(job(), auditConfig(ENV), w.deps);
  assert.equal(r.status, 'error');
  assert.match(r.review_reasons.join(' '), /Groq rate limit reached \(429\)/);
  assert.equal(w.calls.filter((c) => c.kind === 'groq' && c.body.max_completion_tokens === 2500).length, 4);
  assert.ok(r.parameters.readability.score > 0, 'code-based checks still run');
});

test('a wrong Groq key is not retried', async () => {
  const w = world({ groq: () => response(401, { error: { message: 'Invalid API Key' } }) });
  const r = await runAudit(job(), auditConfig(ENV), w.deps);
  assert.match(r.review_reasons.join(' '), /Groq rejected the API key/);
  assert.equal(w.calls.filter((c) => c.kind === 'groq').length, 2); // analysis + gaps, once each
});

test('missing GROQ_API_KEY explains itself', async () => {
  const w = world();
  const r = await runAudit(job(), auditConfig(Object.assign({}, ENV, { GROQ_API_KEY: '' })), w.deps);
  assert.equal(r.status, 'error');
  assert.match(r.review_reasons.join(' '), /GROQ_API_KEY is not set/);
  assert.equal(w.calls.filter((c) => c.kind === 'groq').length, 0);
});

test('without SerpAPI and Copyscape keys the audit still finishes and says what was skipped', async () => {
  const w = world();
  const r = await runAudit(job(), auditConfig({ GROQ_API_KEY: 'gsk_test' }), w.deps);
  const reasons = r.review_reasons.join(' ');
  assert.match(reasons, /SERPAPI_KEY is not set/);
  assert.match(reasons, /Copyscape is not set up/);
  assert.equal(r.parameters.accuracy.claim_counts.unverified, 2);
  assert.equal(w.calls.filter((c) => c.kind === 'serp' || c.kind === 'copyscape').length, 0);
  assert.equal(r.status, 'needs_review');
});

test('a blocked URL gives a failed report straight away', async () => {
  const w = world({ page: () => response(403, 'Forbidden') });
  const r = await runAudit(job({ url: 'https://blocked.example/post', heading: '', content: '' }), auditConfig(ENV), w.deps);
  assert.equal(r.status, 'error');
  assert.equal(r.parameters, null);
  assert.match(r.error, /Couldn't fetch https:\/\/blocked\.example\/post \(HTTP 403\)/);
  assert.equal(w.calls.filter((c) => c.kind === 'groq').length, 0);
});

test('a URL article is fetched and parsed', async () => {
  const html = '<html><head><title>Composting at home guide</title><meta name="description" content="Composting at home basics"></head><body><article><h1>Composting at home</h1><p>' +
    ARTICLE.split('\n')[0] + '</p><h2>What is composting</h2><p>Composting is breakdown of waste by microbes in air and water.</p></article></body></html>';
  const w = world({ page: (url) => response(200, url === 'https://mysite.example/compost' ? html : COMPETITOR_HTML) });
  const r = await runAudit(job({ url: 'https://mysite.example/compost', heading: '', content: '' }), auditConfig(ENV), w.deps);
  assert.equal(r.article.title, 'Composting at home guide');
  assert.equal(r.article.source, 'url');
  assert.ok(r.parameters.keywords.placement.find((x) => x.id === 'meta').pass);
});

test('slow services: the audit stops itself before the 5-minute limit', async () => {
  const slow = () => new Promise(() => {}); // never answers; the timeout is simulated below
  const w = world();
  const deps = Object.assign({}, w.deps, {
    fetch: async (url, opts) => {
      if (url.startsWith('https://api.groq.com/')) {
        // Simulate each Groq call using 80 s of the budget, then a 500.
        w.deps.sleep(80000);
        return response(500, { error: { message: 'Service unavailable' } });
      }
      return w.deps.fetch(url, opts);
    },
  });
  void slow;
  const r = await runAudit(job(), auditConfig(ENV), deps);
  assert.ok(w.elapsed() < 300000, 'elapsed ' + w.elapsed());
  assert.equal(r.status, 'error');
  assert.ok(r.review_reasons.join(' ').length > 0);
});

test('summary, index and CSV export', async () => {
  const w = world();
  const r = await runAudit(job(), auditConfig(ENV), w.deps);
  const idx = upsertEntry({ audits: [] }, summarize(r));
  assert.equal(idx.audits[0].total, r.total);
  const csv = toCsv(idx);
  assert.match(csv, /^﻿audit_id,created_at,status/);
  assert.match(csv, /aud_test_000001/);
  assert.equal(csv.trim().split('\r\n').length, 2);
});
