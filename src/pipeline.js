// The audit pipeline: fetch → readability → Groq analysis → claim search and
// verification → competitor gaps → plagiarism → score. Runs inside one Vercel
// Function (Hobby plan allows 5 minutes), so every step watches a deadline
// and a failed step is recorded instead of stopping the audit.
// Depends on text.js, parse.js, readability.js, keywords.js, llm.js,
// scoring.js, input.js, external.js and phrasecheck.js. Network access and timers come in
// through `deps` so the tests can run it without the internet.

const AUDIT_UA = 'Mozilla/5.0 (compatible; ContentQualityAuditor/1.0; +https://github.com/Ak9312/project_26oct2)';

// Removes spaces and wrapping quotes people often paste along with a key.
export function cleanKey(v) {
  return String(v || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

// Plain-language problem with the Groq key, or '' if it looks usable.
export function groqKeyProblem(raw) {
  const key = cleanKey(raw);
  if (!key) return 'GROQ_API_KEY is not set in the Vercel project settings.';
  if (/[•●*·…]/.test(key) || /^[^\x21-\x7e]/.test(key)) {
    return 'GROQ_API_KEY contains hidden-placeholder dots (•••) instead of the real key. Copy the key again from console.groq.com/keys (create a new one if needed), paste it into the variable, then redeploy.';
  }
  if (/[^\x21-\x7e]/.test(key)) {
    return 'GROQ_API_KEY contains spaces or unusual characters. Paste the key exactly as Groq shows it (it starts with gsk_), then redeploy.';
  }
  return '';
}

export function auditConfig(env) {
  const e = env || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);
  return {
    groqKey: cleanKey(e.GROQ_API_KEY),
    groqKeyProblem: groqKeyProblem(e.GROQ_API_KEY),
    model: (e.GROQ_MODEL || '').trim() || 'openai/gpt-oss-120b',
    reasoningEffort: (e.GROQ_REASONING_EFFORT || '').trim() || 'low',
    maxPromptChars: num(e.MAX_PROMPT_CHARS, 14000),
    pauseSeconds: num(e.LLM_PAUSE_SECONDS, 15),
    passMark: num(e.PASS_MARK, 70),
    competitorPages: Math.min(10, Math.max(1, num(e.COMPETITOR_PAGES, 6))),
    serpKey: cleanKey(e.SERPAPI_KEY),
    copyscapeUser: cleanKey(e.COPYSCAPE_USERNAME),
    copyscapeKey: cleanKey(e.COPYSCAPE_API_KEY),
    // SerpAPI's free plan is small (about 250 searches a month), so each
    // audit uses at most: claims searched + 1 keyword search + phrases.
    maxClaimSearches: Math.min(8, Math.max(0, num(e.MAX_CLAIM_SEARCHES, 5))),
    plagiarismPhrases: Math.min(6, Math.max(0, num(e.PLAGIARISM_PHRASES, 3))),
    deadlineMs: num(e.AUDIT_DEADLINE_MS, 270000),
  };
}

async function fetchWithTimeout(deps, url, opts, ms) {
  const o = Object.assign({}, opts || {});
  o.signal = AbortSignal.timeout(Math.max(1000, ms));
  return deps.fetch(url, o);
}

async function fetchText(deps, url, opts, ms) {
  try {
    const res = await fetchWithTimeout(deps, url, opts, ms);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, headers: res.headers };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: String((e && e.message) || e) };
  }
}

async function fetchJson(deps, url, opts, ms) {
  const r = await fetchText(deps, url, opts, ms);
  let json = null;
  try { json = r.text ? JSON.parse(r.text) : null; } catch (e) { json = null; }
  return Object.assign(r, { json });
}

// One Groq call with retries. Honors Groq's retry-after header on 429,
// never waits past the audit deadline. Returns { error, data }.
export async function callGroq(deps, cfg, prompt, maxTokens, timeLeft) {
  const keyProblem = cfg.groqKeyProblem !== undefined ? cfg.groqKeyProblem : groqKeyProblem(cfg.groqKey);
  if (keyProblem) return { error: keyProblem, data: {} };
  const body = JSON.stringify(groqBody(cfg.model, prompt, maxTokens, cfg.reasoningEffort));
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const budget = timeLeft() - 20000;
    if (budget < 5000) break;
    const r = await fetchJson(deps, GROQ_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.groqKey, 'Content-Type': 'application/json' },
      body,
    }, Math.min(90000, budget));
    if (r.status === 200 && r.json) {
      const failure = llmFailure(r.json);
      if (failure) return { error: failure, data: {} };
      try { return { error: '', data: extractJson(llmText(r.json)) }; }
      catch (e) { return { error: 'Groq answered, but not with valid JSON. Try again, or set GROQ_REASONING_EFFORT to "medium".', data: {} }; }
    }
    const message = (r.json && r.json.error && r.json.error.message) || r.error || ('HTTP ' + r.status);
    last = { error: { message: message, httpCode: String(r.status || '') } };
    const retryable = r.status === 429 || r.status >= 500 || r.status === 0;
    if (!retryable || attempt === 3) break;
    const header = r.headers && typeof r.headers.get === 'function' ? Number(r.headers.get('retry-after')) : NaN;
    const waitS = Math.min(20, Math.max(2, Number.isFinite(header) && header > 0 ? header : 5 * (attempt + 1)));
    if (timeLeft() - waitS * 1000 < 30000) break;
    await deps.sleep(waitS * 1000);
  }
  if (!last) return { error: 'Ran out of time before Groq could answer (Vercel allows 5 minutes per audit).', data: {} };
  return { error: llmFailure(last), data: {} };
}

async function serpSearch(deps, cfg, q, inp, num) {
  const url = 'https://serpapi.com/search.json?' + [
    ['engine', 'google'], ['q', q], ['gl', inp.gl], ['hl', inp.hl], ['num', String(num)], ['api_key', cfg.serpKey],
  ].map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const r = await fetchJson(deps, url, {}, 30000);
  if (!r.ok || !r.json) return { json: null, error: (r.json && r.json.error) || r.error || ('HTTP ' + r.status) };
  if (r.json.error) return { json: null, error: String(r.json.error) };
  return { json: r.json, error: '' };
}

// Free check through SerpAPI: exact-sentence Google searches.
async function phraseCheck(deps, cfg, article, inp) {
  const phrases = pickPhrases(article, cfg.plagiarismPhrases);
  if (!phrases.length) return { checked: false, method: 'phrase', percent: null, sources: [], error: 'no sentences long enough to check' };
  const results = await Promise.all(phrases.map(async (ph) => {
    const s = await serpSearch(deps, cfg, '"' + ph + '"', inp, 10);
    return s.error ? { error: s.error, matches: [] } : { error: '', matches: phraseMatches(s.json, ph, inp.url) };
  }));
  return summarizePhraseCheck(results, phrases);
}

// Copyscape if its keys are set; otherwise the free Google phrase check.
async function plagiarismCheck(deps, cfg, article, inp) {
  if (cfg.copyscapeUser && cfg.copyscapeKey) return copyscapeCheck(deps, cfg, [article.h1, article.body_text].join('\n'));
  if (cfg.serpKey && cfg.plagiarismPhrases > 0) return phraseCheck(deps, cfg, article, inp);
  return { checked: false, percent: null, sources: [], error: 'needs SERPAPI_KEY (free Google phrase check) or Copyscape keys' };
}

async function copyscapeCheck(deps, cfg, text) {
  // Raw POST: every parameter except the text goes in the URL.
  const url = 'https://www.copyscape.com/api/?' + [
    ['u', cfg.copyscapeUser], ['k', cfg.copyscapeKey], ['o', 'csearch'], ['e', 'UTF-8'], ['c', '3'], ['f', 'json'],
  ].map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const r = await fetchJson(deps, url, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=UTF-8' }, body: text }, 90000);
  if (!r.json) return { checked: false, percent: null, sources: [], error: r.error ? 'Copyscape did not respond (' + r.error.slice(0, 80) + ')' : 'Copyscape returned an unexpected reply' };
  return parseCopyscape(r.json);
}

export async function runAudit(job, cfg, deps) {
  const start = deps.now();
  const timeLeft = () => cfg.deadlineMs - (deps.now() - start);
  const pause = async () => {
    const ms = Math.max(0, cfg.pauseSeconds) * 1000;
    if (ms && timeLeft() - ms > 60000) await deps.sleep(ms);
  };
  const inp = job.input;
  const errors = [];
  const config = { pass_mark: cfg.passMark, model: cfg.model };
  const fail = (error) => buildErrorReport({ audit_id: job.audit_id, created_at: job.created_at, input: inp, error, config });

  // 1. Read the article
  let article;
  if (inp.url) {
    const r = await fetchText(deps, inp.url, { headers: { 'User-Agent': AUDIT_UA, Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' }, 20000);
    if (!r.ok || r.text.length < 200) {
      const why = r.error || ('HTTP ' + r.status);
      return fail("Couldn't fetch " + inp.url + ' (' + why.slice(0, 120) + '). The site may block automated requests; paste the content instead.');
    }
    article = parseHtml(r.text, inp.url);
    if (inp.meta_description && !article.meta_description) article.meta_description = inp.meta_description;
  } else {
    article = parsePasted(inp.heading, inp.content, inp.meta_description);
  }
  if (article.word_count < 50) {
    return fail('Found only ' + article.word_count + ' words of article text. If this is a URL, the page may load its text with JavaScript; paste the content instead.');
  }
  const truncated = budgetArticle(article, cfg.maxPromptChars).truncated;

  // 2. Groq: relevancy, claims, related terms, intent
  const a = await callGroq(deps, cfg, buildAnalysisPrompt(article, inp, cfg.maxPromptChars), 2500, timeLeft);
  const analysis = normalizeAnalysis(a.data, article);
  // Only the first few claims are searched, to save SerpAPI searches.
  analysis.claims = analysis.claims.slice(0, cfg.maxClaimSearches);
  if (a.error) errors.push('Article analysis: ' + a.error);
  const keywords = analyzeKeywords(article, inp.keyword, inp.secondary, analysis.related_terms, analysis.intent);

  // 3. Search each claim, then let Groq judge it from those results only
  let verification = [];
  if (!a.error && analysis.claims.length) {
    const blank = analysis.claims.map((c) => ({ claim: c.claim, results: [] }));
    if (!cfg.serpKey) {
      verification = normalizeVerification({}, blank);
      errors.push('Claim check: SERPAPI_KEY is not set, so claims could not be searched');
    } else {
      const serps = await Promise.all(analysis.claims.map((c) => serpSearch(deps, cfg, c.search_query, inp, 5)));
      const items = analysis.claims.map((c, i) => ({ claim: c.claim, results: serpOrganic(serps[i].json, 3) }));
      await pause();
      const v = await callGroq(deps, cfg, buildVerifyPrompt(items), 1500, timeLeft);
      if (v.error) errors.push('Claim check: ' + v.error);
      verification = normalizeVerification(v.data, items);
    }
  }

  // 4. Compare the outline with the top-ranking pages
  let competitors = [];
  let gap = [];
  let gapFailed = false;
  if (!cfg.serpKey) {
    errors.push('Section gaps: SERPAPI_KEY is not set, so top-ranking pages could not be fetched');
  } else if (timeLeft() < 90000) {
    errors.push('Section gaps: skipped to stay inside the 5-minute limit');
  } else {
    const s = await serpSearch(deps, cfg, inp.keyword, inp, 10);
    if (s.error) errors.push('Section gaps: SerpAPI search failed (' + String(s.error).slice(0, 100) + ')');
    const picks = s.json ? competitorUrls(s.json, inp.url, cfg.competitorPages) : [];
    const pages = await Promise.all(picks.map((p) => fetchText(deps, p.url, { headers: { 'User-Agent': AUDIT_UA, Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' }, 12000)));
    competitors = picks
      .map((p, i) => competitorOutline(pages[i].ok ? pages[i].text : '', p.url, p.title))
      .filter((c) => c.word_count >= 200 || c.headings.length >= 3);
    if (competitors.length) {
      await pause();
      const g = await callGroq(deps, cfg, buildGapPrompt(article, competitors, inp.keyword), 1500, timeLeft);
      if (g.error) { gapFailed = true; errors.push('Section gaps: ' + g.error); }
      else gap = normalizeGap(g.data, competitors.length);
    }
  }

  // Readability, with the target grade taken from the top-ranking pages
  const target = readabilityTarget(competitors.map((c) => c.grade), inp);
  const readability = analyzeReadability(article.body_text, target.target);
  readability.target_source = target.source;
  if (target.source === 'competitors') {
    readability.competitor_median_grade = target.competitor_median;
    readability.competitor_pages = target.pages;
  }

  // 5. Plagiarism
  const plagiarism = timeLeft() > 30000
    ? await plagiarismCheck(deps, cfg, article, inp)
    : { checked: false, percent: null, sources: [], error: 'skipped to stay inside the 5-minute limit' };

  return buildReport({
    audit_id: job.audit_id,
    created_at: job.created_at,
    input: inp,
    article,
    readability,
    keywords,
    analysis,
    verification,
    competitors,
    gap,
    plagiarism,
    errors,
    analysis_failed: Boolean(a.error),
    gap_failed: gapFailed,
    prompt_truncated: truncated,
    config,
  });
}
