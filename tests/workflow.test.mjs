// Runs the generated n8n workflows end to end in a small simulator, with
// every HTTP node mocked. This checks the glue between nodes (node names,
// expressions, item pairing, branch handling) — not n8n itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL('../n8n/' + f, import.meta.url), 'utf8'));

function makeRunner(wf, mocks) {
  const nodes = new Map(wf.nodes.map((n) => [n.name, n]));
  const runData = {};
  const calls = [];
  const responses = [];

  const $ = (name) => {
    const items = runData[name];
    return {
      get isExecuted() { return Boolean(items); },
      first() { if (!items) throw new Error('Node not executed yet: ' + name); return items[0]; },
      all() { if (!items) throw new Error('Node not executed yet: ' + name); return items; },
    };
  };

  function evalExpr(value, item) {
    if (typeof value !== 'string' || !value.startsWith('=')) return value;
    const s = value.slice(1);
    const fn = (expr) => new Function('$', '$json', 'return (' + expr + ');')($, item ? item.json : {});
    const whole = s.match(/^\{\{([\s\S]*)\}\}$/);
    if (whole && !whole[1].includes('{{')) return fn(whole[1]);
    return s.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(fn(e)));
  }

  async function runCode(node, items) {
    const $input = { first: () => items[0], all: () => items };
    const f = new Function('$input', '$', '$json', 'return (async () => {' + node.parameters.jsCode + '\n})();');
    const out = await f($input, $, items[0] && items[0].json);
    return out;
  }

  async function runHttp(node, items) {
    const mock = mocks[node.name];
    if (!mock) throw new Error('No mock for ' + node.name);
    const out = [];
    for (const item of items) {
      const p = node.parameters;
      const req = {
        node: node.name,
        method: p.method,
        url: evalExpr(p.url, item),
        query: Object.fromEntries((p.queryParameters ? p.queryParameters.parameters : []).map((q) => [q.name, evalExpr(q.value, item)])),
        body: p.jsonBody ? JSON.parse(evalExpr(p.jsonBody, item)) : p.body ? evalExpr(p.body, item) : undefined,
      };
      calls.push(req);
      let json;
      try {
        json = await mock(req, item);
      } catch (e) {
        if (node.onError === 'continueRegularOutput') json = { error: { message: e.message } };
        else throw e;
      }
      out.push({ json });
    }
    return out;
  }

  function evalIf(node, item) {
    const c = node.parameters.conditions.conditions[0];
    const v = evalExpr(c.leftValue, item);
    if (typeof v !== 'boolean') throw new Error(node.name + ': condition is not boolean (strict type validation would fail)');
    return v;
  }

  async function execute(name, items) {
    const node = nodes.get(name);
    let outputs;
    switch (node.type) {
      case 'n8n-nodes-base.webhook': outputs = [items]; break;
      case 'n8n-nodes-base.code': outputs = [await runCode(node, items)]; break;
      case 'n8n-nodes-base.httpRequest': outputs = [await runHttp(node, items)]; break;
      case 'n8n-nodes-base.respondToWebhook':
        responses.push({ node: name, code: evalExpr(node.parameters.options.responseCode, items[0]), body: JSON.parse(evalExpr(node.parameters.responseBody, items[0])) });
        outputs = [items];
        break;
      case 'n8n-nodes-base.if': {
        const t = []; const f = [];
        items.forEach((it) => (evalIf(node, it) ? t : f).push(it));
        outputs = [t, f];
        break;
      }
      default: throw new Error('Unsupported node type ' + node.type);
    }
    runData[name] = outputs.flat();
    const conns = (wf.connections[name] || { main: [] }).main;
    for (let o = 0; o < conns.length; o++) {
      if (!outputs[o] || !outputs[o].length) continue;
      for (const link of conns[o]) await execute(link.node, outputs[o]);
    }
  }

  return { execute, runData, calls, responses };
}

const anthropicReply = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

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

function auditMocks(over) {
  return Object.assign({
    'Fetch article': () => { throw new Error('should not fetch for pasted content'); },
    'Claude: analyse article': (req) => {
      assert.equal(req.body.model, 'claude-sonnet-5-5');
      assert.match(req.body.messages[0].content, /What is composting/);
      return anthropicReply({
        sections: [{ index: 0, score: 9 }, { index: 1, score: 8 }, { index: 2, score: 5, note: 'drifts' }, { index: 3, score: 7 }],
        title_promise: { score: 3 }, freshness: { score: 5 },
        claims: [
          { claim: 'Meat and dairy are fine in any home bin', search_query: 'can you compost meat dairy home bin' },
          { claim: 'Microbes break down compost', search_query: 'microbes compost breakdown' },
        ],
        related_terms: ['compost bin', 'vermicomposting'],
        intent: { expected: 'informational', score: 3 },
      });
    },
    'SerpAPI: search each claim': (req) => ({
      organic_results: [{ link: 'https://src.example/' + encodeURIComponent(req.query.q), title: 'Source', snippet: 'info' }],
    }),
    'Claude: verify claims': (req) => {
      const items = JSON.parse(req.body.messages[0].content.split('<results>\n')[1].split('\n</results>')[0]);
      assert.equal(items.length, 2);
      return anthropicReply({ claims: [
        { i: 0, status: 'false', source_url: items[0].search_results[0].url, evidence: 'Not in standard bins' },
        { i: 1, status: 'verified', source_url: items[1].search_results[0].url },
      ] });
    },
    'SerpAPI: top results for keyword': (req) => {
      assert.equal(req.query.q, 'composting at home');
      assert.equal(req.query.gl, 'in');
      return { organic_results: [1, 2, 3].map((i) => ({ link: 'https://comp' + i + '.example/guide', title: 'Comp ' + i })) };
    },
    'Fetch competitor pages': (req) => ({
      data: '<html><title>' + req.url + '</title><body><article><h1>Guide</h1><p>' + 'word '.repeat(900) + '</p>' +
        '<h2>What to compost</h2><p>x</p><h2>Troubleshooting smells</h2><p>y</p><h2>FAQ</h2><p>z</p></article></body></html>',
    }),
    'Claude: section gaps': () => anthropicReply({ topics: [
      { subtopic: 'Troubleshooting smells', found_in: 3, coverage: 'missing' },
      { subtopic: 'What to compost', found_in: 3, coverage: 'thin' },
    ] }),
    'Copyscape: plagiarism': (req) => {
      assert.equal(req.query.o, 'csearch');
      assert.equal(req.query.c, '3');
      assert.equal(req.query.f, 'json');
      assert.match(req.body, /Composting at home/);
      return { querywords: 120, count: 1, allpercentmatched: 4, result: [{ url: 'https://copy.example', title: 'Copy', minwordsmatched: 12, percentmatched: 4 }] };
    },
    'Sheets: add to Results': (req) => { assert.match(req.url, /spreadsheets\/PASTE_YOUR_GOOGLE_SHEET_ID\/values\/Results!A1:append$/); return { updates: {} }; },
    'Sheets: add to Review': () => ({ updates: {} }),
    'Gmail: email reviewer': () => ({ id: 'msg1' }),
  }, over || {});
}

test('audit workflow: pasted article runs end to end and goes to review', async () => {
  const wf = load('content-auditor-audit.json');
  const r = makeRunner(wf, auditMocks());
  await r.execute('Audit request', [{ json: { body: { heading: 'Composting at home', content: ARTICLE, keyword: 'composting at home', secondary: 'compost bin', market: 'in-en' } } }]);

  assert.equal(r.responses[0].code, 202);
  assert.match(r.responses[0].body.audit_id, /^aud_/);

  const resultsCall = r.calls.find((c) => c.node === 'Sheets: add to Results');
  const row = resultsCall.body.values[0];
  assert.equal(row.length, 15);
  assert.equal(row[0], r.responses[0].body.audit_id);
  const report = JSON.parse(row[14]);
  const p = report.parameters;
  assert.equal(report.total, p.accuracy.score + p.readability.score + p.keywords.score + p.sections.score + p.plagiarism.score);
  assert.equal(p.accuracy.claim_counts.false, 1);
  assert.equal(p.plagiarism.percent, 4);
  assert.equal(p.sections.competitor_count, 3);
  assert.equal(report.status, 'needs_review');

  // false claim => review branch ran
  assert.ok(r.calls.find((c) => c.node === 'Sheets: add to Review'));
  const mail = r.calls.find((c) => c.node === 'Gmail: email reviewer');
  const mime = Buffer.from(mail.body.raw, 'base64url').toString('utf8');
  assert.match(mime, /^To: you@example.com/);
});

test('audit workflow: clean article passes and skips the review branch', async () => {
  const wf = load('content-auditor-audit.json');
  const mocks = auditMocks({
    'Claude: analyse article': () => anthropicReply({
      sections: [0, 1, 2, 3].map((i) => ({ index: i, score: 10 })), title_promise: { score: 3 }, freshness: { score: 5 },
      claims: [], related_terms: ['compost bin'], intent: { score: 4 },
    }),
    'Claude: verify claims': () => { throw new Error('should not verify when there are no claims'); },
    'Claude: section gaps': () => anthropicReply({ topics: [] }),
    'Copyscape: plagiarism': () => ({ querywords: 120, count: 0 }),
  });
  const r = makeRunner(wf, mocks);
  await r.execute('Audit request', [{ json: { body: { heading: 'Composting at home', content: ARTICLE, keyword: 'composting at home' } } }]);
  const report = JSON.parse(r.calls.find((c) => c.node === 'Sheets: add to Results').body.values[0][14]);
  assert.ok(!r.calls.find((c) => c.node === 'SerpAPI: search each claim'));
  assert.equal(report.parameters.accuracy.points.claims, 12);
  if (report.total >= 70) {
    assert.equal(report.status, 'passed');
    assert.ok(!r.calls.find((c) => c.node === 'Sheets: add to Review'));
  }
});

test('audit workflow: failing outside services are flagged, not crashed', async () => {
  const wf = load('content-auditor-audit.json');
  const mocks = auditMocks({
    'SerpAPI: top results for keyword': () => { throw new Error('quota'); },
    'Copyscape: plagiarism': () => { throw new Error('timeout'); },
  });
  const r = makeRunner(wf, mocks);
  await r.execute('Audit request', [{ json: { body: { heading: 'Composting at home', content: ARTICLE, keyword: 'composting at home' } } }]);
  const report = JSON.parse(r.calls.find((c) => c.node === 'Sheets: add to Results').body.values[0][14]);
  const codes = report.flags.map((f) => f.code);
  assert.ok(codes.includes('serp_unavailable'));
  assert.ok(codes.includes('plagiarism_not_checked'));
  assert.equal(report.status, 'needs_review');
});

test('audit workflow: URL input is fetched and parsed', async () => {
  const wf = load('content-auditor-audit.json');
  const html = '<html><head><title>Composting at home guide</title><meta name="description" content="Composting at home basics"></head><body><article><h1>Composting at home</h1><p>' +
    ARTICLE.split('\n')[0] + '</p><h2>What is composting</h2><p>Composting is breakdown of waste by microbes in air and water.</p></article></body></html>';
  const mocks = auditMocks({
    'Fetch article': (req) => { assert.equal(req.url, 'https://mysite.example/compost'); return { data: html }; },
  });
  const r = makeRunner(wf, mocks);
  await r.execute('Audit request', [{ json: { body: { url: 'https://mysite.example/compost', keyword: 'composting at home' } } }]);
  const report = JSON.parse(r.calls.find((c) => c.node === 'Sheets: add to Results').body.values[0][14]);
  assert.equal(report.article.title, 'Composting at home guide');
  assert.equal(report.article.source, 'url');
  assert.ok(report.parameters.keywords.placement.find((x) => x.id === 'meta').pass);
});

test('audit workflow: bad input is rejected with 400 and nothing runs', async () => {
  const wf = load('content-auditor-audit.json');
  const r = makeRunner(wf, auditMocks());
  await r.execute('Audit request', [{ json: { body: { content: 'x' } } }]);
  assert.equal(r.responses.length, 1);
  assert.equal(r.responses[0].code, 400);
  assert.match(r.responses[0].body.error, /heading/);
  assert.equal(r.calls.length, 0);
});

test('api workflow: list and review_save', async () => {
  const wf = load('content-auditor-api.json');
  const sheets = {
    valueRanges: [
      { values: [['audit_id', 'created_at', 'status', 'title', 'url', 'keyword', 'total', 'accuracy', 'readability', 'keywords', 'sections', 'plagiarism', 'review_reasons', 'model', 'report_json'], ['aud_1', '2026-10-26T10:00:00Z', 'needs_review', 'T', '', 'kw', '60', '20', '10', '10', '10', '10', 'Total 60 is below 70', 'm', '{}']] },
      { values: [['audit_id', 'created_at', 'title', 'url', 'total', 'review_reasons', 'reviewer_score', 'decision', 'notes', 'reviewed_at'], ['aud_1', '2026-10-26T10:00:00Z', 'T', '', '60', 'x', '', 'pending', '', '']] },
      {},
    ],
  };
  let r = makeRunner(wf, { 'Sheets: read tabs': (req) => { assert.match(req.url, /values:batchGet\?ranges=Results/); return sheets; } });
  await r.execute('App request', [{ json: { body: { action: 'list' } } }]);
  assert.equal(r.responses[0].code, 200);
  assert.equal(r.responses[0].body.audits[0].audit_id, 'aud_1');
  assert.equal(r.responses[0].body.pending_reviews, 1);

  let saved;
  r = makeRunner(wf, {
    'Sheets: read tabs': () => sheets,
    'Sheets: save': (req) => { saved = req.body; return { totalUpdatedCells: 4 }; },
  });
  await r.execute('App request', [{ json: { body: { action: 'review_save', audit_id: 'aud_1', decision: 'approved', reviewer_score: 62 } } }]);
  assert.equal(r.responses[0].code, 200);
  assert.deepEqual(r.responses[0].body, { saved: true });
  assert.equal(saved.data[0].range, 'Review!G2:J2');

  r = makeRunner(wf, { 'Sheets: read tabs': () => { throw new Error('403 PERMISSION_DENIED'); } });
  await r.execute('App request', [{ json: { body: { action: 'list' } } }]);
  assert.equal(r.responses[0].code, 502);
  assert.match(r.responses[0].body.error, /Couldn't read the Google Sheet/);
});
