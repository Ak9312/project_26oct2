// Combines every check into one report out of 100 and decides whether the
// article goes to human review.
// Depends on text.js.

export const RESULTS_COLUMNS = [
  'audit_id', 'created_at', 'status', 'title', 'url', 'keyword', 'total',
  'accuracy', 'readability', 'keywords', 'sections', 'plagiarism',
  'review_reasons', 'model', 'report_json',
];

export const REVIEW_COLUMNS = [
  'audit_id', 'created_at', 'title', 'url', 'total', 'review_reasons',
  'reviewer_score', 'decision', 'notes', 'reviewed_at',
];

export const VALIDATION_COLUMNS = [
  'audit_id', 'title', 'my_accuracy', 'my_readability', 'my_keywords',
  'my_sections', 'my_plagiarism', 'my_total',
];

const CONCLUSION_RE = /\b(conclusion|summary|final thoughts|wrapping up|key takeaways|bottom line|in short)\b/i;
const FAQ_RE = /\b(faqs?|frequently asked|common questions)\b/i;

export function plagiarismPoints(percent) {
  if (!Number.isFinite(percent)) return null;
  if (percent <= 5) return 10;
  if (percent <= 10) return 6;
  if (percent <= 15) return 2;
  return 0;
}

export function depthPoints(ratio) {
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= 0.9) return 4;
  if (ratio >= 0.7) return 3;
  if (ratio >= 0.5) return 2;
  if (ratio >= 0.3) return 1;
  return 0;
}

function accuracyBlock(analysis, verification) {
  const scored = analysis.sections.filter((s) => s.score !== null);
  const relevancy = scored.length
    ? Math.round(scored.reduce((n, s) => n + s.score, 0) / scored.length)
    : 0;
  const n = verification.length;
  const v = verification.filter((c) => c.status === 'verified').length;
  const u = verification.filter((c) => c.status === 'unverified').length;
  const f = verification.filter((c) => c.status === 'false').length;
  const claimsPts = n ? Math.round((12 * (v + 0.5 * u)) / n) : 12;
  const points = {
    relevancy,
    claims: claimsPts,
    freshness: analysis.freshness.score,
    title_promise: analysis.title_promise.score,
  };
  return {
    points,
    score: points.relevancy + points.claims + points.freshness + points.title_promise,
    max: 30,
    sections: analysis.sections,
    claims: verification,
    claim_counts: { total: n, verified: v, unverified: u, false: f },
    freshness_note: analysis.freshness.note,
    title_note: analysis.title_promise.note,
  };
}

function sectionsBlock(article, competitors, topics, gapFailed) {
  const usable = competitors.filter((c) => c.word_count >= 200);
  const med = median(usable.map((c) => c.word_count));
  const ratio = med ? article.word_count / med : NaN;

  let coverage = null;
  // If the AI step failed, coverage is unknown: no points, never full marks.
  if (competitors.length && !gapFailed) {
    if (!topics.length) coverage = 12;
    else {
      const covered = topics.filter((t) => t.coverage === 'covered').length;
      const thin = topics.filter((t) => t.coverage === 'thin').length;
      coverage = Math.round((12 * (covered + 0.5 * thin)) / topics.length);
    }
  }

  const introWords = tokenizeWords(article.intro).length;
  const structure = {
    intro: introWords >= 40,
    conclusion: article.sections.some((s) => CONCLUSION_RE.test(s.heading)),
    faq: article.sections.some((s) => FAQ_RE.test(s.heading)),
    enough_h2: article.h2_count >= 3,
  };
  const structurePts = [structure.intro, structure.conclusion, structure.faq, structure.enough_h2].filter(Boolean).length;
  const depth = depthPoints(ratio);

  const points = { coverage, structure: structurePts, depth };
  return {
    points,
    score: (coverage || 0) + structurePts + (depth || 0),
    max: 20,
    topics,
    structure,
    competitor_count: competitors.length,
    word_count: article.word_count,
    competitor_median_words: med ? Math.round(med) : null,
    competitors: competitors.slice(0, 10).map((c) => ({ url: c.url, title: c.title, word_count: c.word_count })),
  };
}

function plagiarismBlock(p) {
  const percent = p && p.checked && Number.isFinite(Number(p.percent)) ? Number(p.percent) : null;
  const pts = percent === null ? null : plagiarismPoints(percent);
  return {
    checked: percent !== null,
    percent,
    sources: ((p && p.sources) || []).slice(0, 5),
    error: (p && p.error) || '',
    points: { match: pts },
    score: pts || 0,
    max: 10,
  };
}

export function buildReport(ctx) {
  const passMark = Number(ctx.config && ctx.config.pass_mark) || 70;
  const accuracy = accuracyBlock(ctx.analysis, ctx.verification || []);
  const readability = ctx.readability;
  const keywords = ctx.keywords;
  const sections = sectionsBlock(ctx.article, ctx.competitors || [], ctx.gap || [], ctx.gap_failed === true);
  const plagiarism = plagiarismBlock(ctx.plagiarism);

  const total = accuracy.score + readability.score + keywords.score + sections.score + plagiarism.score;

  const flags = [];
  if (accuracy.claim_counts.false > 0) {
    flags.push({ code: 'false_claim', hard: true, message: accuracy.claim_counts.false + ' claim(s) contradicted by search results' });
  }
  if (plagiarism.checked && plagiarism.percent > 15) {
    flags.push({ code: 'plagiarism_over_15', hard: true, message: 'Plagiarism match ' + plagiarism.percent + '% (over 15%)' });
  }
  if (!plagiarism.checked) {
    flags.push({ code: 'plagiarism_not_checked', hard: true, message: 'Plagiarism check did not run' + (plagiarism.error ? ': ' + plagiarism.error : '') });
  }
  if (!sections.competitor_count) {
    flags.push({ code: 'serp_unavailable', hard: true, message: 'No competitor pages fetched, so missing sections could not be checked' });
  }
  if (!ctx.article.sections.length) {
    flags.push({ code: 'no_sections', hard: false, message: 'No H2/H3 headings found' });
  }
  if (ctx.prompt_truncated) {
    flags.push({ code: 'prompt_truncated', hard: false, message: 'Long article: each section was shortened before it was sent to the AI (MAX_PROMPT_CHARS)' });
  }
  if (accuracy.claim_counts.unverified > 0) {
    flags.push({ code: 'unverified_claims', hard: false, message: accuracy.claim_counts.unverified + ' claim(s) could not be verified' });
  }
  (ctx.errors || []).forEach((e) => flags.push({ code: 'step_error', hard: true, message: String(e).slice(0, 200) }));

  const reasons = [];
  if (ctx.analysis_failed) reasons.push('AI analysis did not run, so accuracy and intent scores are incomplete');
  if (total < passMark) reasons.push('Total ' + total + ' is below ' + passMark);
  flags.filter((f) => f.hard).forEach((f) => reasons.push(f.message));

  let status = reasons.length ? 'needs_review' : 'passed';
  if (ctx.analysis_failed) status = 'error';

  return {
    audit_id: ctx.audit_id,
    created_at: ctx.created_at,
    status,
    pass_mark: passMark,
    total,
    review_reasons: reasons,
    flags,
    model: (ctx.config && ctx.config.model) || '',
    article: {
      title: ctx.article.title,
      h1: ctx.article.h1,
      url: ctx.article.url,
      source: ctx.article.source,
      word_count: ctx.article.word_count,
      meta_description: ctx.article.meta_description,
    },
    input: {
      keyword: ctx.input.keyword,
      secondary: ctx.input.secondary,
      target_grade: ctx.input.target_grade,
      market_label: ctx.input.market_label,
    },
    parameters: { accuracy, readability, keywords, sections, plagiarism },
    ai_detection: ctx.ai_detection || { checked: false },
  };
}

// Sheets cells hold at most 50,000 characters; keep a margin.
export function compactReportJson(report) {
  let json = JSON.stringify(report);
  if (json.length <= 45000 || !report.parameters) return json.slice(0, 45000);
  const r = JSON.parse(json);
  r.parameters.sections.competitors = [];
  r.parameters.accuracy.sections = r.parameters.accuracy.sections.slice(0, 15);
  json = JSON.stringify(r);
  if (json.length <= 45000) return json;
  r.parameters.accuracy.claims.forEach((c) => { c.evidence = ''; });
  r.parameters.readability.hardest_sentence = null;
  return JSON.stringify(r).slice(0, 45000);
}

// For audits that stop before scoring (article could not be fetched or read).
export function buildErrorReport(ctx) {
  return {
    audit_id: ctx.audit_id,
    created_at: ctx.created_at,
    status: 'error',
    error: String(ctx.error || 'The audit could not finish.').slice(0, 500),
    pass_mark: Number(ctx.config && ctx.config.pass_mark) || 70,
    total: null,
    review_reasons: [String(ctx.error || 'The audit could not finish.').slice(0, 300)],
    flags: [],
    model: (ctx.config && ctx.config.model) || '',
    article: { title: ctx.input.heading || ctx.input.url || '', h1: '', url: ctx.input.url || '', source: ctx.input.url ? 'url' : 'paste', word_count: 0, meta_description: '' },
    input: { keyword: ctx.input.keyword, secondary: ctx.input.secondary, target_grade: ctx.input.target_grade, market_label: ctx.input.market_label },
    parameters: null,
  };
}

export function resultsRow(report) {
  if (!report.parameters) {
    return [
      report.audit_id, report.created_at, report.status, report.article.title, report.article.url,
      report.input.keyword, '', '', '', '', '', '', report.review_reasons.join(' | '), report.model,
      compactReportJson(report),
    ];
  }
  const p = report.parameters;
  return [
    report.audit_id, report.created_at, report.status, report.article.title, report.article.url,
    report.input.keyword, report.total, p.accuracy.score, p.readability.score, p.keywords.score,
    p.sections.score, p.plagiarism.score, report.review_reasons.join(' | '), report.model,
    compactReportJson(report),
  ];
}

export function reviewRow(report) {
  return [
    report.audit_id, report.created_at, report.article.title, report.article.url, report.total,
    report.review_reasons.join(' | '), '', 'pending', '', '',
  ];
}
