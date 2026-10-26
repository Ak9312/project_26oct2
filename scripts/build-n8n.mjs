// Generates the two importable n8n workflows in n8n/ from src/.
// Run: npm run build:n8n
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inlineSources } from './inline.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'n8n');

function uuid(seed) {
  const h = createHash('sha256').update(seed).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

const CREDS = {
  webhook: { type: 'httpHeaderAuth', name: 'Content Auditor webhook secret' },
  anthropic: { type: 'httpHeaderAuth', name: 'Anthropic API key' },
  serpapi: { type: 'httpQueryAuth', name: 'SerpAPI key' },
  copyscape: { type: 'httpQueryAuth', name: 'Copyscape API key' },
  sheets: { type: 'googleSheetsOAuth2Api', name: 'Google Sheets account' },
  gmail: { type: 'gmailOAuth2', name: 'Gmail account' },
};

function cred(key) {
  const c = CREDS[key];
  return { [c.type]: { name: c.name } };
}

class Flow {
  constructor(name) {
    this.name = name;
    this.nodes = [];
    this.connections = {};
  }
  add(node, pos) {
    node.id = uuid(this.name + '/' + node.name);
    node.position = pos;
    this.nodes.push(node);
    return node.name;
  }
  link(from, to, output) {
    const o = output || 0;
    this.connections[from] = this.connections[from] || { main: [] };
    const main = this.connections[from].main;
    while (main.length <= o) main.push([]);
    main[o].push({ node: to, type: 'main', index: 0 });
  }
  toJSON() {
    return {
      name: this.name,
      nodes: this.nodes,
      connections: this.connections,
      active: false,
      settings: { executionOrder: 'v1', saveManualExecutions: true },
      pinData: {},
      meta: { templateCredsSetupCompleted: false },
    };
  }
}

function webhook(name, path) {
  return {
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    webhookId: uuid('webhook/' + path),
    parameters: { httpMethod: 'POST', path, authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: cred('webhook'),
  };
}

function code(name, libs, glue) {
  const header = '// Generated from src/ by scripts/build-n8n.mjs. Edit src/ and rebuild instead of editing here.\n';
  const lib = libs.length ? inlineSources(libs) + '\n\n// ---- node logic\n' : '';
  return {
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    parameters: { mode: 'runOnceForAllItems', jsCode: header + lib + glue.trim() + '\n' },
  };
}

function configNode(name, fields, note) {
  const lines = Object.entries(fields).map(([k, v]) => '  ' + k + ': ' + JSON.stringify(v) + ',');
  return {
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode:
        '// ' + note + '\n' +
        '// EDIT THE VALUES BELOW once after importing this workflow.\n' +
        'const CONFIG = {\n' + lines.join('\n') + '\n};\n\n' +
        'return [{ json: { config: CONFIG, body: $input.first().json.body || {} } }];\n',
    },
  };
}

function ifNode(name, boolExpr) {
  return {
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          id: uuid('if/' + name),
          leftValue: '={{ ' + boolExpr + ' }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
  };
}

function respond(name, bodyExpr, codeExpr) {
  return {
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    parameters: { respondWith: 'json', responseBody: '={{ ' + bodyExpr + ' }}', options: { responseCode: codeExpr } },
  };
}

function http(name, o) {
  const p = { method: o.method || 'GET', url: o.url };
  if (o.auth) {
    const c = CREDS[o.auth];
    if (c.type === 'httpHeaderAuth' || c.type === 'httpQueryAuth') {
      p.authentication = 'genericCredentialType';
      p.genericAuthType = c.type;
    } else {
      p.authentication = 'predefinedCredentialType';
      p.nodeCredentialType = c.type;
    }
  }
  if (o.query) {
    p.sendQuery = true;
    p.queryParameters = { parameters: Object.entries(o.query).map(([n, v]) => ({ name: n, value: v })) };
  }
  if (o.headers) {
    p.sendHeaders = true;
    p.headerParameters = { parameters: Object.entries(o.headers).map(([n, v]) => ({ name: n, value: v })) };
  }
  if (o.jsonBody) {
    p.sendBody = true;
    p.specifyBody = 'json';
    p.jsonBody = '={{ ' + o.jsonBody + ' }}';
  }
  if (o.rawBody) {
    p.sendBody = true;
    p.contentType = 'raw';
    p.rawContentType = o.rawContentType || 'text/plain';
    p.body = '={{ ' + o.rawBody + ' }}';
  }
  p.options = { timeout: o.timeout || 60000 };
  if (o.text) p.options.response = { response: { responseFormat: 'text', outputPropertyName: 'data' } };
  const node = { name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, parameters: p };
  if (o.auth) node.credentials = cred(o.auth);
  if (o.continueOnError) node.onError = 'continueRegularOutput';
  if (o.retry) Object.assign(node, { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 });
  return node;
}

const UA = 'Mozilla/5.0 (compatible; ContentQualityAuditor/1.0; +https://github.com/Ak9312/project_26oct2)';
const V = "$('Validate input').first().json";
const CFG = "$('Config').first().json.config";
const anthropic = (name, bodyExpr) => http(name, {
  method: 'POST',
  url: 'https://api.anthropic.com/v1/messages',
  auth: 'anthropic',
  headers: { 'anthropic-version': '2023-06-01' },
  jsonBody: bodyExpr,
  timeout: 180000,
  retry: true,
});
const serp = (name, qExpr, num) => http(name, {
  url: 'https://serpapi.com/search.json',
  auth: 'serpapi',
  query: {
    engine: 'google',
    q: '={{ ' + qExpr + ' }}',
    gl: '={{ ' + V + '.input.gl }}',
    hl: '={{ ' + V + '.input.hl }}',
    num: String(num),
  },
  timeout: 60000,
  continueOnError: true,
});

// ------------------------------------------------------------------ audit
function buildAudit() {
  const f = new Flow('Content Auditor · audit pipeline');
  let x = 0;
  const at = (y) => [(x += 240), y || 300];

  const wh = f.add(webhook('Audit request', 'content-auditor/audit'), at());
  const cfg = f.add(configNode('Config', {
    SPREADSHEET_ID: 'PASTE_YOUR_GOOGLE_SHEET_ID',
    REVIEW_EMAIL: 'you@example.com',
    APP_URL: 'https://your-app.vercel.app',
    MODEL: 'claude-sonnet-5-5',
    PASS_MARK: 70,
    COMPETITOR_PAGES: 8,
    COPYSCAPE_USERNAME: 'your-copyscape-username',
  }, 'Settings for the audit pipeline. Keep PASS_MARK and SPREADSHEET_ID the same as in the API workflow.'), at());
  const val = f.add(code('Validate input', ['text.js', 'input.js'], `
const body = $input.first().json.body;
const out = normalizeInput(body);
const now = new Date();
return [{ json: { ok: out.errors.length === 0, errors: out.errors, audit_id: makeAuditId(now), created_at: now.toISOString(), input: out.input } }];
`), at());
  const okIf = f.add(ifNode('Input valid?', '$json.ok === true'), at());
  const accepted = f.add(respond('Respond: accepted', 'JSON.stringify({ audit_id: ' + V + '.audit_id, status: "running" })', 202), [x + 240, 200]);
  const rejected = f.add(respond('Respond: invalid input', 'JSON.stringify({ error: ' + V + '.errors.join(". ") })', 400), [x + 240, 420]);
  x += 240;
  const hasUrl = f.add(ifNode('Has URL?', V + '.input.url !== ""'), at(200));
  const fetchA = f.add(http('Fetch article', {
    url: '={{ ' + V + '.input.url }}',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    text: true,
    timeout: 30000,
    continueOnError: true,
  }), [x + 240, 100]);
  x += 240;
  const parse = f.add(code('Parse article', ['text.js', 'parse.js', 'readability.js', 'llm.js'], `
const v = ${V};
const inp = v.input;
const cfg = ${CFG};
let article;
if (inp.url) {
  const got = $input.first().json;
  const html = got.data;
  if (typeof html !== 'string' || html.length < 200) {
    const why = got.error ? (got.error.message || 'request failed') : 'no HTML returned';
    throw new Error('Could not fetch ' + inp.url + ' (' + why + '). The site may block bots; paste the content instead.');
  }
  article = parseHtml(html, inp.url);
  if (inp.meta_description && !article.meta_description) article.meta_description = inp.meta_description;
} else {
  article = parsePasted(inp.heading, inp.content, inp.meta_description);
}
if (article.word_count < 50) throw new Error('Found only ' + article.word_count + ' words of article text.');
const readability = analyzeReadability(article.body_text, inp.target_grade);
const request = anthropicBody(cfg.MODEL, buildAnalysisPrompt(article, inp), 4000);
return [{ json: { article, readability, request } }];
`), at(200));
  const claudeA = f.add(anthropic('Claude: analyse article', 'JSON.stringify($json.request)'), at(200));
  const readA = f.add(code('Read analysis', ['text.js', 'llm.js', 'keywords.js'], `
const parsed = $('Parse article').first().json;
const inp = ${V}.input;
const analysis = normalizeAnalysis(extractJson(anthropicText($input.first().json)), parsed.article);
const keywords = analyzeKeywords(parsed.article, inp.keyword, inp.secondary, analysis.related_terms, analysis.intent);
const out = analysis.claims.map((c, i) => ({ json: { i, claim: c.claim, q: c.search_query } }));
if (!out.length) out.push({ json: { i: -1, skip: true, q: inp.keyword } });
out[0].json.analysis = analysis;
out[0].json.keywords = keywords;
return out;
`), at(200));
  const anyClaims = f.add(ifNode('Any claims?', "$('Read analysis').first().json.i >= 0"), at(200));
  const serpClaims = f.add(serp('SerpAPI: search each claim', '$json.q', 5), [x + 240, 100]);
  const verifyPrompt = f.add(code('Verify prompt', ['text.js', 'parse.js', 'external.js', 'llm.js'], `
const cfg = ${CFG};
const claims = $('Read analysis').all();
const serps = $input.all();
const items = claims.map((c, idx) => ({ claim: c.json.claim, results: serpOrganic(serps[idx] && serps[idx].json, 5) }));
return [{ json: { items, request: anthropicBody(cfg.MODEL, buildVerifyPrompt(items), 3000) } }];
`), [x + 480, 100]);
  const claudeV = f.add(anthropic('Claude: verify claims', 'JSON.stringify($json.request)'), [x + 720, 100]);
  x += 720;
  const readV = f.add(code('Read verification', ['text.js', 'llm.js'], `
const first = $input.first().json;
let verification = [];
if (Array.isArray(first.content)) {
  const items = $('Verify prompt').first().json.items;
  verification = normalizeVerification(extractJson(anthropicText(first)), items);
}
return [{ json: { verification } }];
`), at(200));
  const serpKw = f.add(serp('SerpAPI: top results for keyword', V + '.input.keyword', 10), at(200));
  const pick = f.add(code('Pick competitors', ['text.js', 'parse.js', 'external.js'], `
const inp = ${V}.input;
const cfg = ${CFG};
const picks = competitorUrls($input.first().json, inp.url, cfg.COMPETITOR_PAGES);
if (!picks.length) return [{ json: { skip: true, url: '', title: '' } }];
return picks.map((p) => ({ json: p }));
`), at(200));
  const haveComp = f.add(ifNode('Have competitors?', "$('Pick competitors').first().json.skip !== true"), at(200));
  const fetchC = f.add(http('Fetch competitor pages', {
    url: '={{ $json.url }}',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    text: true,
    timeout: 20000,
    continueOnError: true,
  }), [x + 240, 100]);
  const gapPrompt = f.add(code('Gap prompt', ['text.js', 'parse.js', 'external.js', 'llm.js'], `
const cfg = ${CFG};
const inp = ${V}.input;
const article = $('Parse article').first().json.article;
const picks = $('Pick competitors').all();
const pages = $input.all();
const competitors = picks
  .map((p, i) => competitorOutline(pages[i] && pages[i].json && pages[i].json.data, p.json.url, p.json.title))
  .filter((c) => c.word_count >= 200 || c.headings.length >= 3);
return [{ json: {
  usable: competitors.length > 0,
  competitors,
  request: competitors.length ? anthropicBody(cfg.MODEL, buildGapPrompt(article, competitors, inp.keyword), 3000) : null,
} }];
`), [x + 480, 100]);
  const usable = f.add(ifNode('Usable competitors?', '$json.usable === true'), [x + 720, 100]);
  const claudeG = f.add(anthropic('Claude: section gaps', 'JSON.stringify($json.request)'), [x + 960, 0]);
  x += 960;
  const readG = f.add(code('Read gaps', ['text.js', 'llm.js'], `
const first = $input.first().json;
let competitors = [];
let gap = [];
if (Array.isArray(first.content)) {
  competitors = $('Gap prompt').first().json.competitors;
  gap = normalizeGap(extractJson(anthropicText(first)), competitors.length);
}
const article = $('Parse article').first().json.article;
return [{ json: { competitors, gap, text: [article.h1, article.body_text].join('\\n') } }];
`), at(200));
  const copyscape = f.add(http('Copyscape: plagiarism', {
    method: 'POST',
    url: 'https://www.copyscape.com/api/',
    auth: 'copyscape',
    query: { u: '={{ ' + CFG + '.COPYSCAPE_USERNAME }}', o: 'csearch', e: 'UTF-8', c: '3', f: 'json' },
    rawBody: '$json.text',
    rawContentType: 'text/plain; charset=UTF-8',
    timeout: 120000,
    continueOnError: true,
  }), at(200));
  const build = f.add(code('Build report', ['text.js', 'parse.js', 'external.js', 'scoring.js', 'email.js'], `
const v = ${V};
const cfg = ${CFG};
const parsed = $('Parse article').first().json;
const ra = $('Read analysis').first().json;
const verification = $('Read verification').first().json.verification;
const g = $('Read gaps').first().json;
let cs = $input.first().json;
if (typeof cs.data === 'string') {
  try { cs = JSON.parse(cs.data); } catch (e) { cs = { error: 'Copyscape returned an unexpected reply' }; }
}
if (cs.error && typeof cs.error === 'object') cs = { error: cs.error.message || 'Copyscape request failed' };
const report = buildReport({
  audit_id: v.audit_id,
  created_at: v.created_at,
  input: v.input,
  article: parsed.article,
  readability: parsed.readability,
  keywords: ra.keywords,
  analysis: ra.analysis,
  verification,
  competitors: g.competitors,
  gap: g.gap,
  plagiarism: parseCopyscape(cs),
  config: { pass_mark: cfg.PASS_MARK, model: cfg.MODEL },
});
const email = buildAlertEmail(report, cfg.REVIEW_EMAIL, cfg.APP_URL);
return [{ json: {
  audit_id: report.audit_id,
  status: report.status,
  total: report.total,
  needs_review: report.status === 'needs_review',
  results_row: resultsRow(report),
  review_row: reviewRow(report),
  email_raw: email.raw,
} }];
`), at(200));
  const sheetsUrl = (tab) => '=https://sheets.googleapis.com/v4/spreadsheets/{{ ' + CFG + '.SPREADSHEET_ID }}/values/' + tab + '!A1:append';
  const appendR = f.add(http('Sheets: add to Results', {
    method: 'POST',
    url: sheetsUrl('Results'),
    auth: 'sheets',
    query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
    jsonBody: "JSON.stringify({ values: [$('Build report').first().json.results_row] })",
    retry: true,
  }), at(200));
  const needs = f.add(ifNode('Needs review?', "$('Build report').first().json.needs_review === true"), at(200));
  const appendRev = f.add(http('Sheets: add to Review', {
    method: 'POST',
    url: sheetsUrl('Review'),
    auth: 'sheets',
    query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
    jsonBody: "JSON.stringify({ values: [$('Build report').first().json.review_row] })",
    retry: true,
  }), at(100));
  const gmail = f.add(http('Gmail: email reviewer', {
    method: 'POST',
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    auth: 'gmail',
    jsonBody: "JSON.stringify({ raw: $('Build report').first().json.email_raw })",
    retry: true,
  }), at(100));

  f.link(wh, cfg);
  f.link(cfg, val);
  f.link(val, okIf);
  f.link(okIf, accepted, 0);
  f.link(okIf, rejected, 1);
  f.link(accepted, hasUrl);
  f.link(hasUrl, fetchA, 0);
  f.link(hasUrl, parse, 1);
  f.link(fetchA, parse);
  f.link(parse, claudeA);
  f.link(claudeA, readA);
  f.link(readA, anyClaims);
  f.link(anyClaims, serpClaims, 0);
  f.link(anyClaims, readV, 1);
  f.link(serpClaims, verifyPrompt);
  f.link(verifyPrompt, claudeV);
  f.link(claudeV, readV);
  f.link(readV, serpKw);
  f.link(serpKw, pick);
  f.link(pick, haveComp);
  f.link(haveComp, fetchC, 0);
  f.link(haveComp, readG, 1);
  f.link(fetchC, gapPrompt);
  f.link(gapPrompt, usable);
  f.link(usable, claudeG, 0);
  f.link(usable, readG, 1);
  f.link(claudeG, readG);
  f.link(readG, copyscape);
  f.link(copyscape, build);
  f.link(build, appendR);
  f.link(appendR, needs);
  f.link(needs, appendRev, 0);
  f.link(appendRev, gmail);
  return f;
}

// ------------------------------------------------------------------ api
function buildApi() {
  const f = new Flow('Content Auditor · app API');
  const wh = f.add(webhook('App request', 'content-auditor/api'), [240, 300]);
  const cfg = f.add(configNode('Config', {
    SPREADSHEET_ID: 'PASTE_YOUR_GOOGLE_SHEET_ID',
    PASS_MARK: 70,
  }, 'Settings for the app API. Use the same values as the audit pipeline.'), [480, 300]);
  const read = f.add(http('Sheets: read tabs', {
    url: '=https://sheets.googleapis.com/v4/spreadsheets/{{ ' + CFG + '.SPREADSHEET_ID }}/values:batchGet?ranges=Results!A%3AO&ranges=Review!A%3AJ&ranges=Validation!A%3AH',
    auth: 'sheets',
    continueOnError: true,
  }), [720, 300]);
  const handle = f.add(code('Handle request', ['text.js', 'parse.js', 'external.js', 'scoring.js', 'api.js'], `
const cfg = ${CFG};
const body = $('Config').first().json.body;
const got = $input.first().json;
if (got.error || !Array.isArray(got.valueRanges)) {
  const msg = got.error ? (got.error.message || JSON.stringify(got.error)) : 'Unexpected reply from Google Sheets';
  return [{ json: { status_code: 502, needs_write: false, response: { error: "Couldn't read the Google Sheet. Check the sheet ID, the tab names (Results, Review, Validation) and the Google credential. " + String(msg).slice(0, 200) } } }];
}
const tabs = got.valueRanges.map((r) => r.values || []);
const out = handleApi(body, { Results: tabs[0] || [], Review: tabs[1] || [], Validation: tabs[2] || [] }, { pass_mark: cfg.PASS_MARK });
return [{ json: { status_code: out.status_code, response: out.response, needs_write: Boolean(out.write), write: out.write } }];
`), [960, 300]);
  const needsWrite = f.add(ifNode('Needs write?', '$json.needs_write === true'), [1200, 300]);
  const write = f.add(http('Sheets: save', {
    method: 'POST',
    url: '=https://sheets.googleapis.com/v4/spreadsheets/{{ ' + CFG + '.SPREADSHEET_ID }}/values:batchUpdate',
    auth: 'sheets',
    jsonBody: "JSON.stringify({ valueInputOption: 'RAW', data: $('Handle request').first().json.write.data })",
    continueOnError: true,
  }), [1440, 200]);
  const check = f.add(code('Check save', [], `
const h = $('Handle request').first().json;
const w = $input.first().json;
if (w.error) {
  return [{ json: { status_code: 502, response: { error: "Couldn't save to the Google Sheet. " + String(w.error.message || '').slice(0, 200) } } }];
}
return [{ json: { status_code: h.status_code, response: h.response } }];
`), [1680, 200]);
  const resp = f.add(respond('Respond', 'JSON.stringify($json.response)', '={{ $json.status_code }}'), [1920, 300]);

  f.link(wh, cfg);
  f.link(cfg, read);
  f.link(read, handle);
  f.link(handle, needsWrite);
  f.link(needsWrite, write, 0);
  f.link(needsWrite, resp, 1);
  f.link(write, check);
  f.link(check, resp);
  return f;
}

// ------------------------------------------------------------------ checks + write
const N8N_GLOBALS = ['$input', '$', '$json', '$node', '$now', '$execution', '$vars', '$workflow', 'items'];

function check(flow) {
  const names = new Set(flow.nodes.map((n) => n.name));
  if (names.size !== flow.nodes.length) throw new Error(flow.name + ': duplicate node names');
  for (const [from, c] of Object.entries(flow.connections)) {
    if (!names.has(from)) throw new Error(flow.name + ': connection from unknown node ' + from);
    c.main.flat().forEach((l) => { if (!names.has(l.node)) throw new Error(flow.name + ': connection to unknown node ' + l.node); });
  }
  for (const n of flow.nodes) {
    if (n.type === 'n8n-nodes-base.code') {
      try {
        // Syntax check: n8n runs the code as an async function body.
        new Function(...N8N_GLOBALS, 'return (async () => {' + n.parameters.jsCode + '\n})');
      } catch (e) {
        throw new Error(flow.name + ' / ' + n.name + ': ' + e.message);
      }
    }
    const refs = JSON.stringify(n.parameters).match(/\$\('([^']+)'\)/g) || [];
    refs.forEach((r) => {
      const target = r.slice(3, -2);
      if (!names.has(target)) throw new Error(flow.name + ' / ' + n.name + ' references missing node ' + target);
    });
  }
}

mkdirSync(outDir, { recursive: true });
for (const [file, flow] of [['content-auditor-audit.json', buildAudit()], ['content-auditor-api.json', buildApi()]]) {
  check(flow);
  writeFileSync(join(outDir, file), JSON.stringify(flow.toJSON(), null, 2) + '\n');
  console.log('wrote n8n/' + file + ' (' + flow.nodes.length + ' nodes)');
}
