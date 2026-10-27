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
  // n8n's built-in "Groq" credential: paste the API key, click Test.
  groq: { type: 'groqApi', name: 'Groq account' },
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
  if (o.retry) Object.assign(node, { retryOnFail: true, maxTries: typeof o.retry === 'number' ? o.retry : 3, waitBetweenTries: 5000 });
  return node;
}

function pause(name, secondsExpr) {
  return {
    name,
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    webhookId: uuid('wait/' + name),
    parameters: { resume: 'timeInterval', amount: '={{ ' + secondsExpr + ' }}', unit: 'seconds' },
  };
}

const UA = 'Mozilla/5.0 (compatible; ContentQualityAuditor/1.0; +https://github.com/Ak9312/project_26oct2)';
const V = "$('Validate input').first().json";
const CFG = "$('Config').first().json.config";
// Groq's free plan allows roughly 8,000 tokens per minute, so every Groq
// call retries (5 tries, 5 s apart — n8n's maximum) and the workflow pauses
// between calls. A call that still fails does not stop the audit: the
// error is recorded and shown on the report.
const groq = (name) => http(name, {
  method: 'POST',
  url: 'https://api.groq.com/openai/v1/chat/completions',
  auth: 'groq',
  jsonBody: 'JSON.stringify($json.request)',
  timeout: 120000,
  retry: 5,
  continueOnError: true,
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
const PAUSE = 'Math.max(1, Number(' + CFG + '.LLM_PAUSE_SECONDS) || 0)';
const sheetsUrl = (tab) => '=https://sheets.googleapis.com/v4/spreadsheets/{{ ' + CFG + '.SPREADSHEET_ID }}/values/' + tab + '!A1:append';
const appendTo = (name, tab, valuesExpr) => http(name, {
  method: 'POST',
  url: sheetsUrl(tab),
  auth: 'sheets',
  query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
  jsonBody: 'JSON.stringify({ values: [' + valuesExpr + '] })',
  retry: true,
});

// Reads one Groq reply into { error, data }. Shared by the three reader nodes.
const READ_GROQ = `
function readGroq(resp) {
  const failure = llmFailure(resp);
  if (failure) return { error: failure, data: {} };
  try { return { error: '', data: extractJson(llmText(resp)) }; }
  catch (e) { return { error: 'Groq answered, but not with valid JSON. Try again, or set REASONING_EFFORT to "medium".', data: {} }; }
}
`;

// ------------------------------------------------------------------ audit
function buildAudit() {
  const f = new Flow('Content Auditor · audit pipeline');
  let x = 0;
  const at = (y) => [(x += 240), y || 300];

  const wh = f.add(webhook('Audit request', 'content-auditor/audit'), at());
  const cfg = f.add(configNode('Config', {
    SPREADSHEET_ID: 'PASTE_YOUR_GOOGLE_SHEET_ID',
    REVIEW_EMAIL: 'you@example.com',
    APP_URL: 'https://content-quality-auditor.vercel.app',
    MODEL: 'openai/gpt-oss-120b',
    REASONING_EFFORT: 'low',
    MAX_PROMPT_CHARS: 14000,
    LLM_PAUSE_SECONDS: 20,
    PASS_MARK: 70,
    COMPETITOR_PAGES: 8,
    COPYSCAPE_USERNAME: 'your-copyscape-username',
  }, 'Settings for the audit pipeline. Keep PASS_MARK and SPREADSHEET_ID the same as in the API workflow.\n' +
     '// MODEL: any Groq chat model ID (console.groq.com/docs/models). MAX_PROMPT_CHARS and LLM_PAUSE_SECONDS keep each\n' +
     '// audit inside Groq\'s free-plan tokens-per-minute limit; on a paid Groq plan you can raise the first and set the second to 1.'), at());
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
let article = null;
let error = '';
if (inp.url) {
  const got = $input.first().json;
  const html = got.data;
  if (typeof html !== 'string' || html.length < 200) {
    const why = got.error ? (got.error.message || 'request failed') : 'no HTML returned';
    error = "Couldn't fetch " + inp.url + ' (' + String(why).slice(0, 120) + '). The site may block automated requests; paste the content instead.';
  } else {
    article = parseHtml(html, inp.url);
    if (inp.meta_description && !article.meta_description) article.meta_description = inp.meta_description;
  }
} else {
  article = parsePasted(inp.heading, inp.content, inp.meta_description);
}
if (!error && article.word_count < 50) {
  error = 'Found only ' + article.word_count + ' words of article text. If this is a URL, the page may load its text with JavaScript; paste the content instead.';
}
if (error) return [{ json: { ok: false, error } }];
const readability = analyzeReadability(article.body_text, inp.target_grade);
const request = groqBody(cfg.MODEL, buildAnalysisPrompt(article, inp, cfg.MAX_PROMPT_CHARS), 2500, cfg.REASONING_EFFORT);
const truncated = budgetArticle(article, cfg.MAX_PROMPT_CHARS).truncated;
return [{ json: { ok: true, article, readability, request, truncated } }];
`), at(200));
  const readable = f.add(ifNode('Article readable?', '$json.ok === true'), at(200));
  const failReport = f.add(code('Build error report', ['text.js', 'scoring.js'], `
const v = ${V};
const cfg = ${CFG};
const report = buildErrorReport({ audit_id: v.audit_id, created_at: v.created_at, input: v.input, error: $input.first().json.error, config: { pass_mark: cfg.PASS_MARK, model: cfg.MODEL } });
return [{ json: { results_row: resultsRow(report) } }];
`), [x + 240, 460]);
  const appendFail = f.add(appendTo('Sheets: add failed audit', 'Results', '$json.results_row'), [x + 480, 460]);
  const groqA = f.add(groq('Groq: analyse article'), at(200));
  const readA = f.add(code('Read analysis', ['text.js', 'llm.js', 'keywords.js'], READ_GROQ + `
const parsed = $('Parse article').first().json;
const inp = ${V}.input;
const got = readGroq($input.first().json);
const analysis = normalizeAnalysis(got.data, parsed.article);
const keywords = analyzeKeywords(parsed.article, inp.keyword, inp.secondary, analysis.related_terms, analysis.intent);
const out = got.error ? [] : analysis.claims.map((c, i) => ({ json: { i, claim: c.claim, q: c.search_query } }));
if (!out.length) out.push({ json: { i: -1, skip: true, q: inp.keyword } });
out[0].json.analysis = analysis;
out[0].json.keywords = keywords;
out[0].json.analysis_error = got.error;
return out;
`), at(200));
  const anyClaims = f.add(ifNode('Any claims?', "$('Read analysis').first().json.i >= 0"), at(200));
  const serpClaims = f.add(serp('SerpAPI: search each claim', '$json.q', 5), [x + 240, 100]);
  const verifyPrompt = f.add(code('Verify prompt', ['text.js', 'parse.js', 'external.js', 'llm.js'], `
const cfg = ${CFG};
const claims = $('Read analysis').all();
const serps = $input.all();
const items = claims.map((c, idx) => ({ claim: c.json.claim, results: serpOrganic(serps[idx] && serps[idx].json, 3) }));
return [{ json: { items, request: groqBody(cfg.MODEL, buildVerifyPrompt(items), 1500, cfg.REASONING_EFFORT) } }];
`), [x + 480, 100]);
  const pauseV = f.add(pause('Pause before claim check', PAUSE), [x + 720, 100]);
  const groqV = f.add(groq('Groq: verify claims'), [x + 960, 100]);
  x += 960;
  const readV = f.add(code('Read verification', ['text.js', 'llm.js'], READ_GROQ + `
const first = $input.first().json;
let verification = [];
let error = '';
if (!(first.skip === true && first.i === -1)) {
  const items = $('Verify prompt').first().json.items;
  const got = readGroq(first);
  error = got.error;
  // On failure every claim stays "unverified" (half credit) and is flagged.
  verification = normalizeVerification(got.data, items);
}
return [{ json: { verification, error } }];
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
  request: competitors.length ? groqBody(cfg.MODEL, buildGapPrompt(article, competitors, inp.keyword), 1500, cfg.REASONING_EFFORT) : null,
} }];
`), [x + 480, 100]);
  const usable = f.add(ifNode('Usable competitors?', '$json.usable === true'), [x + 720, 100]);
  const pauseG = f.add(pause('Pause before section gaps', PAUSE), [x + 960, 0]);
  const groqG = f.add(groq('Groq: section gaps'), [x + 1200, 0]);
  x += 1200;
  const readG = f.add(code('Read gaps', ['text.js', 'llm.js'], READ_GROQ + `
const first = $input.first().json;
let competitors = [];
let gap = [];
let error = '';
if (first.skip !== true && first.usable !== false) {
  competitors = $('Gap prompt').first().json.competitors;
  const got = readGroq(first);
  error = got.error;
  if (!error) gap = normalizeGap(got.data, competitors.length);
}
const article = $('Parse article').first().json.article;
return [{ json: { competitors, gap, error, text: [article.h1, article.body_text].join('\\n') } }];
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
const rv = $('Read verification').first().json;
const g = $('Read gaps').first().json;
let cs = $input.first().json;
if (typeof cs.data === 'string') {
  try { cs = JSON.parse(cs.data); } catch (e) { cs = { error: 'Copyscape returned an unexpected reply' }; }
}
if (cs.error && typeof cs.error === 'object') cs = { error: cs.error.message || 'Copyscape request failed' };
const errors = [];
if (ra.analysis_error) errors.push('Article analysis: ' + ra.analysis_error);
if (rv.error) errors.push('Claim check: ' + rv.error);
if (g.error) errors.push('Section gaps: ' + g.error);
const report = buildReport({
  audit_id: v.audit_id,
  created_at: v.created_at,
  input: v.input,
  article: parsed.article,
  readability: parsed.readability,
  keywords: ra.keywords,
  analysis: ra.analysis,
  verification: rv.verification,
  competitors: g.competitors,
  gap: g.gap,
  plagiarism: parseCopyscape(cs),
  errors,
  analysis_failed: Boolean(ra.analysis_error),
  gap_failed: Boolean(g.error),
  prompt_truncated: parsed.truncated === true,
  config: { pass_mark: cfg.PASS_MARK, model: cfg.MODEL },
});
const email = buildAlertEmail(report, cfg.REVIEW_EMAIL, cfg.APP_URL);
return [{ json: {
  audit_id: report.audit_id,
  status: report.status,
  total: report.total,
  needs_review: report.status !== 'passed',
  results_row: resultsRow(report),
  review_row: reviewRow(report),
  email_raw: email.raw,
} }];
`), at(200));
  const appendR = f.add(appendTo('Sheets: add to Results', 'Results', "$('Build report').first().json.results_row"), at(200));
  const needs = f.add(ifNode('Needs review?', "$('Build report').first().json.needs_review === true"), at(200));
  const appendRev = f.add(appendTo('Sheets: add to Review', 'Review', "$('Build report').first().json.review_row"), at(100));
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
  f.link(parse, readable);
  f.link(readable, groqA, 0);
  f.link(readable, failReport, 1);
  f.link(failReport, appendFail);
  f.link(groqA, readA);
  f.link(readA, anyClaims);
  f.link(anyClaims, serpClaims, 0);
  f.link(anyClaims, readV, 1);
  f.link(serpClaims, verifyPrompt);
  f.link(verifyPrompt, pauseV);
  f.link(pauseV, groqV);
  f.link(groqV, readV);
  f.link(readV, serpKw);
  f.link(serpKw, pick);
  f.link(pick, haveComp);
  f.link(haveComp, fetchC, 0);
  f.link(haveComp, readG, 1);
  f.link(fetchC, gapPrompt);
  f.link(gapPrompt, usable);
  f.link(usable, pauseG, 0);
  f.link(usable, readG, 1);
  f.link(pauseG, groqG);
  f.link(groqG, readG);
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
