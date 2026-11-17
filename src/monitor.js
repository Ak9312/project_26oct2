// Monitoring (AIOps): a run log for every audit, API health, numbers and
// alerts. Pure functions plus a "tracer" the pipeline calls as it works:
//   begin(step) / end(step) → time and result of each pipeline step
//   wrapFetch(fetch)        → every outside call, sorted by API
//   retry() / aiFailed()    → what the Groq retry logic did
// The finished run log is saved with the report and in monitor/runs.json.
// Depends on nothing else in src/ (it comes before pipeline.js).

export const MONITOR_LIMIT = 300;   // run logs kept in storage
export const WINDOW = 50;           // numbers are worked out over the latest 50 audits
export const THRESHOLDS = {
  slow_ms: 180000,          // an audit normally takes 1–3 min, so over 3 min is slow
  ai_failure_rate: 0.2,     // alert when more than 20% of audits had an AI call fail
  accuracy: 0.8,            // slide 134: accuracy under 80%
  accuracy_min_scored: 5,   // need at least 5 articles you scored yourself
  cost_spike: 2,            // an audit using over 2× the usual AI tokens
};

export const STEPS = [
  { name: 'fetch', label: 'Fetch article page' },
  { name: 'ai_analysis', label: 'AI analysis (Groq)' },
  { name: 'claim_check', label: 'Claim verification' },
  { name: 'section_gaps', label: 'Top-10 Google pages' },
  { name: 'originality', label: 'Originality check' },
];
export const APIS = [
  { name: 'groq', label: 'Groq (AI)' },
  { name: 'serpapi', label: 'SerpAPI (Google results)' },
  { name: 'page', label: 'Page fetch' },
  { name: 'copyscape', label: 'Copyscape' },
];

const stepLabel = (name) => (STEPS.find((s) => s.name === name) || { label: name }).label;

// Never let a key reach the logs, even inside an error message.
export function redact(s) {
  return String(s == null ? '' : s)
    .replace(/((?:api_key|key|k|u|token|password)=)[^&\s"']+/gi, '$1•••')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer •••')
    .replace(/\b(gsk|sk-or|sk)[-_][A-Za-z0-9_-]{6,}/g, '$1_•••')
    .slice(0, 300);
}

// Which API a URL belongs to. Pages read during the top-10 step are
// competitor pages: many sites block robots, so those don't count against
// the "Page fetch" health.
function apiOf(url, step) {
  const u = String(url);
  if (u.startsWith('https://api.groq.com/')) return 'groq';
  if (u.startsWith('https://serpapi.com/')) return 'serpapi';
  if (u.startsWith('https://www.copyscape.com/')) return 'copyscape';
  return step === 'section_gaps' ? 'competitor_pages' : 'page';
}

export function makeTracer(now) {
  const t0 = now();
  const steps = [];
  const apis = {};
  let current = null;
  let tokens = 0;
  let aiCalls = 0;
  let aiFailures = 0;
  let crash = '';

  const api = (name) => apis[name] || (apis[name] = { calls: 0, failed: 0, ms: 0, last_error: '' });

  const tr = {
    begin(name) {
      if (current) tr.end();
      current = { name, label: stepLabel(name), start_ms: now() - t0, ms: 0, status: 'ok', error: '', note: '', retries: 0, retry_reasons: [], recovered: false };
    },
    // status: ok | failed | skipped
    end(status, error, note) {
      if (!current) return;
      current.ms = Math.max(0, now() - t0 - current.start_ms);
      if (status) current.status = status;
      if (error) current.error = redact(error);
      if (note) current.note = redact(note).slice(0, 200);
      current.recovered = current.retries > 0 && current.status === 'ok';
      steps.push(current);
      current = null;
    },
    skip(name, note) { tr.begin(name); tr.end('skipped', '', note); },
    retry(reason) {
      if (!current) return;
      current.retries += 1;
      if (current.retry_reasons.length < 5) current.retry_reasons.push(String(reason).slice(0, 120));
    },
    aiCall() { aiCalls += 1; },
    aiFailed() { aiFailures += 1; },
    tokens(n) { if (Number.isFinite(Number(n))) tokens += Number(n); },
    wrapFetch(fetch) {
      return async (url, opts) => {
        const a = api(apiOf(url, current && current.name));
        const s = now();
        a.calls += 1;
        try {
          const r = await fetch(url, opts);
          a.ms += now() - s;
          if (!r.ok) { a.failed += 1; a.last_error = 'HTTP ' + r.status; }
          return r;
        } catch (e) {
          a.ms += now() - s;
          a.failed += 1;
          a.last_error = redact((e && e.message) || e);
          throw e;
        }
      };
    },
    crashed(e) {
      crash = redact((e && e.message) || e);
      if (current) tr.end('failed', 'Crashed: ' + crash);
    },
    finish(report, job, cfg) {
      if (current) tr.end();
      const total = Math.max(0, now() - t0);
      const failedStep = steps.find((s) => s.status === 'failed');
      const failed = report.status === 'error';
      const inp = (job && job.input) || {};
      return {
        audit_id: report.audit_id,
        at: report.created_at,
        title: (report.article && (report.article.title || report.article.url)) || inp.heading || inp.url || '',
        url: inp.url || '',
        source: inp.url ? 'url' : 'paste',
        keyword: inp.keyword || '',
        model: (cfg && cfg.model) || report.model || '',
        total_ms: total,
        outcome: failed ? 'failed' : failedStep ? 'partial' : 'ok',
        score: failed ? null : report.total,
        status: report.status,
        failed_step: failedStep ? failedStep.name : failed ? 'unknown' : '',
        error: failedStep && failedStep.error ? failedStep.error : failed ? redact(report.error || 'The audit could not finish') : '',
        crashed: Boolean(crash),
        retries: steps.reduce((n, s) => n + s.retries, 0),
        recovered: steps.some((s) => s.recovered),
        ai_calls: aiCalls,
        ai_failed: aiFailures > 0,
        tokens,
        slow: total > THRESHOLDS.slow_ms,
        steps,
        apis,
      };
    },
  };
  return tr;
}

// A run log for an audit that crashed before the tracer could finish.
export function crashRunLog(job, error, model) {
  const tr = makeTracer(() => 0);
  tr.crashed(error);
  return tr.finish({ audit_id: job.audit_id, created_at: job.created_at, status: 'error', error: 'Unexpected error: ' + redact(error), model }, job, { model });
}

// ---- Stored document: { runs: [newest first], api_check }
export function emptyMonitor() { return { runs: [], api_check: null }; }

export function addRun(doc, run) {
  const d = doc && Array.isArray(doc.runs) ? doc : emptyMonitor();
  const runs = [run].concat(d.runs.filter((r) => r.audit_id !== run.audit_id)).slice(0, MONITOR_LIMIT);
  return { runs, api_check: d.api_check || null };
}

export function withApiCheck(doc, check) {
  const d = doc && Array.isArray(doc.runs) ? doc : emptyMonitor();
  return { runs: d.runs, api_check: check };
}

function monMedian(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const monPct = (a, b) => (b ? a / b : null);

// Accuracy = how often the auditor's pass/fail agrees with yours, from the
// articles you scored on the Validation page.
export function accuracyFromIndex(index, passMark) {
  const pairs = ((index && index.audits) || []).filter((e) => e.validation && e.total != null && e.validation.my_total != null);
  const agree = pairs.filter((e) => (e.total >= passMark) === (Number(e.validation.my_total) >= passMark)).length;
  return { scored: pairs.length, agree, rate: monPct(agree, pairs.length) };
}

export function monitorSummary(runs, accuracy) {
  const w = runs.slice(0, WINDOW);
  const done = w.filter((r) => r.outcome !== 'failed');
  const aiRuns = w.filter((r) => r.ai_calls > 0);
  const withTokens = done.filter((r) => r.tokens > 0);
  return {
    audits: w.length,
    completed: done.length,
    clean: w.filter((r) => r.outcome === 'ok').length,
    success_rate: monPct(done.length, w.length),
    avg_ms: done.length ? Math.round(done.reduce((n, r) => n + r.total_ms, 0) / done.length) : null,
    slowest_ms: done.length ? Math.max.apply(null, done.map((r) => r.total_ms)) : null,
    slow: w.filter((r) => r.slow).length,
    ai_runs: aiRuns.length,
    ai_failed: aiRuns.filter((r) => r.ai_failed).length,
    ai_failure_rate: monPct(aiRuns.filter((r) => r.ai_failed).length, aiRuns.length),
    retries: w.reduce((n, r) => n + (r.retries || 0), 0),
    recovered: w.filter((r) => r.recovered).length,
    avg_tokens: withTokens.length ? Math.round(withTokens.reduce((n, r) => n + r.tokens, 0) / withTokens.length) : null,
    accuracy: accuracy || { scored: 0, agree: 0, rate: null },
  };
}

// Health of each API: the latest "Check APIs now" result, plus what the
// latest audits saw. Down = the check failed, or its last 3 audits' calls all failed.
export function apiHealth(runs, check) {
  return APIS.map(({ name, label }) => {
    const c = check && check.results ? check.results[name] : null;
    const seen = runs.filter((r) => r.apis && r.apis[name] && r.apis[name].calls > 0);
    const lastFail = seen.find((r) => r.apis[name].failed > 0);
    const recent = seen.slice(0, 3);
    const recentAllFailed = recent.length === 3 && recent.every((r) => r.apis[name].failed >= r.apis[name].calls);
    const lastRunOk = seen.length ? seen[0].apis[name].failed < seen[0].apis[name].calls : null;
    let status = 'unknown';
    if (c && c.status === 'not_set_up') status = 'not_set_up';
    else if ((c && c.status === 'down') || recentAllFailed) status = 'down';
    else if ((c && c.status === 'ok') || lastRunOk) status = 'ok';
    else if (lastRunOk === false) status = 'warn';
    return {
      name,
      label,
      status,
      check: c || null,
      checked_at: check ? check.at : null,
      calls: seen.slice(0, WINDOW).reduce((n, r) => n + r.apis[name].calls, 0),
      failed_calls: seen.slice(0, WINDOW).reduce((n, r) => n + r.apis[name].failed, 0),
      last_error: lastFail ? lastFail.apis[name].last_error : '',
      last_error_at: lastFail ? lastFail.at : null,
    };
  });
}

export function monitorAlerts(summary, health, runs) {
  const alerts = [];
  const T = THRESHOLDS;
  for (const h of health) {
    if (h.status === 'down') {
      alerts.push({ level: 'bad', key: 'api_' + h.name, title: h.label + ' is down', detail: (h.check && h.check.error) || h.last_error || 'Its last 3 calls failed.' });
    }
  }
  if (summary.ai_runs >= 3 && summary.ai_failure_rate > T.ai_failure_rate) {
    alerts.push({ level: 'bad', key: 'ai_failures', title: 'AI failure rate ' + Math.round(summary.ai_failure_rate * 100) + '%', detail: summary.ai_failed + ' of the last ' + summary.ai_runs + ' audits had a Groq call fail even after retries (limit 20%).' });
  }
  const last10 = runs.slice(0, 10);
  const slow10 = last10.filter((r) => r.slow).length;
  if (slow10) {
    alerts.push({ level: 'warn', key: 'slow', title: slow10 + ' slow audit' + (slow10 > 1 ? 's' : ''), detail: slow10 + ' of the last ' + last10.length + ' audits took over 3 minutes (normal is 1–3 min).' });
  }
  const latest = runs.find((r) => r.tokens > 0);
  if (latest) {
    const prev = runs.filter((r) => r.tokens > 0 && r !== latest).slice(0, 10).map((r) => r.tokens);
    const usual = monMedian(prev);
    if (prev.length >= 3 && usual && latest.tokens > usual * T.cost_spike) {
      alerts.push({ level: 'warn', key: 'cost', title: 'Cost spike', detail: 'The latest audit used ' + latest.tokens.toLocaleString('en-IN') + ' AI tokens, over 2× the usual ' + Math.round(usual).toLocaleString('en-IN') + '.' });
    }
  }
  const acc = summary.accuracy;
  if (acc && acc.scored >= T.accuracy_min_scored && acc.rate < T.accuracy) {
    alerts.push({ level: 'warn', key: 'accuracy', title: 'Accuracy ' + Math.round(acc.rate * 100) + '%', detail: 'The auditor agreed with your pass/fail on ' + acc.agree + ' of ' + acc.scored + ' articles you scored (limit 80%).' });
  }
  return alerts;
}

function failureList(runs) {
  return runs.filter((r) => r.outcome !== 'ok').slice(0, 30).map((r) => {
    const s = (r.steps || []).find((x) => x.status === 'failed');
    return {
      audit_id: r.audit_id,
      at: r.at,
      title: r.title,
      url: r.url,
      outcome: r.outcome,
      step: r.failed_step || (s && s.name) || '',
      step_label: stepLabel(r.failed_step || (s && s.name) || ''),
      error: r.error || (s && s.error) || '',
      retries: s ? s.retries : r.retries,
      retry_saved: r.recovered,
    };
  });
}

export function monitorResponse(doc, index, passMark) {
  const runs = (doc && Array.isArray(doc.runs) ? doc.runs : []);
  const summary = monitorSummary(runs, accuracyFromIndex(index, passMark));
  const health = apiHealth(runs, doc && doc.api_check);
  return {
    summary,
    health,
    alerts: monitorAlerts(summary, health, runs),
    failures: failureList(runs),
    runs: runs.slice(0, 100),
    thresholds: THRESHOLDS,
    window: WINDOW,
    steps: STEPS,
  };
}

// ---- "Check APIs now": free endpoints only, so no searches or AI credits
// are used. deps: { fetch, now }.
async function probe(deps, url, opts, ms) {
  const s = deps.now();
  try {
    const r = await deps.fetch(url, Object.assign({}, opts || {}, { signal: AbortSignal.timeout(ms || 10000) }));
    let text = '';
    try { text = await r.text(); } catch (e) { text = ''; }
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    return { status: r.status, ok: r.ok, json, text, ms: deps.now() - s, error: '' };
  } catch (e) {
    return { status: 0, ok: false, json: null, text: '', ms: deps.now() - s, error: redact((e && e.message) || e) };
  }
}

export async function checkApis(cfg, deps) {
  const at = new Date(deps.now()).toISOString();
  const res = {};
  const jobs = [];

  if (cfg.groqKeyProblem) {
    res.groq = { status: 'down', ms: 0, error: cfg.groqKeyProblem, detail: '' };
  } else {
    jobs.push(probe(deps, 'https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + cfg.groqKey } }).then((r) => {
      if (!r.ok) {
        const msg = (r.json && r.json.error && r.json.error.message) || r.error || ('HTTP ' + r.status);
        res.groq = { status: 'down', ms: r.ms, error: redact((r.status === 401 ? 'Key rejected (401). ' : '') + msg), detail: '' };
        return;
      }
      const ids = ((r.json && r.json.data) || []).map((m) => m.id);
      const has = !ids.length || ids.indexOf(cfg.model) >= 0;
      res.groq = has
        ? { status: 'ok', ms: r.ms, error: '', detail: 'Key works; model ' + cfg.model + ' is available' }
        : { status: 'down', ms: r.ms, error: 'Key works, but model ' + cfg.model + ' is not in your Groq model list', detail: '' };
    }));
  }

  if (!cfg.serpKey) {
    res.serpapi = { status: 'down', ms: 0, error: 'SERPAPI_KEY is not set', detail: '' };
  } else {
    // The Account API is free: it doesn't use a search.
    jobs.push(probe(deps, 'https://serpapi.com/account.json?api_key=' + encodeURIComponent(cfg.serpKey)).then((r) => {
      const j = r.json || {};
      if (!r.ok || j.error) {
        res.serpapi = { status: 'down', ms: r.ms, error: redact(j.error || r.error || ('HTTP ' + r.status)), detail: '' };
        return;
      }
      const left = j.total_searches_left != null ? j.total_searches_left : j.plan_searches_left;
      res.serpapi = left === 0
        ? { status: 'down', ms: r.ms, error: 'No searches left this month', detail: '', searches_left: 0 }
        : { status: 'ok', ms: r.ms, error: '', detail: left != null ? left + ' searches left this month' : 'Key works', searches_left: left != null ? left : null };
    }));
  }

  jobs.push(probe(deps, 'https://example.com/', { headers: { 'User-Agent': 'ContentQualityAuditor/1.0 health check' } }).then((r) => {
    res.page = r.ok && r.text.length > 100
      ? { status: 'ok', ms: r.ms, error: '', detail: 'The server can read web pages (test page: example.com)' }
      : { status: 'down', ms: r.ms, error: r.error || ('HTTP ' + r.status), detail: '' };
  }));

  if (!(cfg.copyscapeUser && cfg.copyscapeKey)) {
    res.copyscape = { status: 'not_set_up', ms: 0, error: '', detail: 'Not set up: originality uses the free exact-sentence search through SerpAPI' };
  } else {
    const url = 'https://www.copyscape.com/api/?u=' + encodeURIComponent(cfg.copyscapeUser) + '&k=' + encodeURIComponent(cfg.copyscapeKey) + '&o=balance&f=json';
    jobs.push(probe(deps, url).then((r) => {
      const j = r.json || {};
      const err = j.error || (!r.ok ? r.error || 'HTTP ' + r.status : '') || (/<error>/i.test(r.text) ? r.text.replace(/<[^>]+>/g, ' ').trim() : '');
      res.copyscape = err
        ? { status: 'down', ms: r.ms, error: redact(err), detail: '' }
        : { status: 'ok', ms: r.ms, error: '', detail: j.total != null ? 'Credit: ' + j.total : 'Key works' };
    }));
  }

  await Promise.all(jobs);
  const results = {};
  for (const a of APIS) results[a.name] = res[a.name];
  return { at, results, ok: APIS.every((a) => ['ok', 'not_set_up'].indexOf(results[a.name].status) >= 0) };
}

// ---- MOCK_MODE: believable run logs for the sample audits.
export function sampleRunLog(report, variant) {
  let t = 0;
  const tr = makeTracer(() => t);
  const v = variant || 'ok';
  const fetchApi = tr.wrapFetch(async (url) => ({ ok: !(v === 'failed' && url === 'page'), status: v === 'failed' && url === 'page' ? 403 : 200 }));
  const step = async (name, ms, calls, status, error) => {
    tr.begin(name);
    for (const c of calls) { await fetchApi(c); }
    t += ms;
    tr.end(status || 'ok', error || '');
  };
  return (async () => {
    if (v === 'failed') {
      await step('fetch', 1200, ['page'], 'failed', report.error);
    } else {
      if (report.article && report.article.source === 'url') await step('fetch', 1400, ['page']);
      else tr.skip('fetch', 'Pasted text, nothing to fetch');
      tr.begin('ai_analysis'); tr.aiCall(); await fetchApi('https://api.groq.com/x');
      if (v === 'retry') { tr.retry('Bad JSON from Groq: retried with double tokens'); tr.aiCall(); await fetchApi('https://api.groq.com/x'); }
      t += v === 'retry' ? 48000 : 24000; tr.tokens(v === 'retry' ? 9100 : 5200); tr.end('ok');
      await step('claim_check', 31000, ['https://serpapi.com/a', 'https://serpapi.com/b', 'https://api.groq.com/x']);
      tr.tokens(1800);
      await step('section_gaps', 42000, ['https://serpapi.com/c', 'page', 'page', 'https://api.groq.com/x']);
      tr.tokens(2100);
      await step('originality', 6000, ['https://serpapi.com/d', 'https://serpapi.com/e']);
    }
    return tr.finish(report, { input: report.input ? { url: report.article && report.article.url, keyword: report.input.keyword } : {} }, { model: report.model });
  })();
}
