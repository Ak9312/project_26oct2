// App data: one index of audit summaries (plus each audit's review and
// validation scores) drives the audit list, review queue, validation page
// and CSV export. Full reports are stored separately, one per audit.
// Pure functions: storage happens in api/_store.js. Depends on text.js.

export const INDEX_LIMIT = 1000;

export function summarize(report) {
  const p = report.parameters;
  return {
    audit_id: report.audit_id,
    created_at: report.created_at,
    status: report.status,
    title: report.article.title || report.article.url || '',
    url: report.article.url || '',
    keyword: report.input.keyword || '',
    total: p ? report.total : null,
    accuracy: p ? p.accuracy.score : null,
    readability: p ? p.readability.score : null,
    keywords: p ? p.keywords.score : null,
    sections: p ? p.sections.score : null,
    plagiarism: p ? p.plagiarism.score : null,
    review_reasons: report.review_reasons || [],
    review: null,
    validation: null,
  };
}

function byNewest(a, b) {
  return String(b.created_at).localeCompare(String(a.created_at));
}

export function upsertEntry(index, entry) {
  const list = (index && Array.isArray(index.audits) ? index.audits : []).filter((e) => e.audit_id !== entry.audit_id);
  const old = (index && Array.isArray(index.audits) ? index.audits : []).find((e) => e.audit_id === entry.audit_id);
  const merged = Object.assign({}, entry, old ? { review: old.review, validation: old.validation } : {});
  list.push(merged);
  list.sort(byNewest);
  return { audits: list.slice(0, INDEX_LIMIT) };
}

function publicSummary(e) {
  const out = Object.assign({}, e);
  delete out.review;
  delete out.validation;
  return out;
}

function needsReview(e) {
  return e.status === 'needs_review' || e.status === 'error';
}

export function listResponse(index, passMark) {
  const audits = (index.audits || []).slice().sort(byNewest);
  return {
    audits: audits.slice(0, 100).map(publicSummary),
    total_audits: audits.length,
    pending_reviews: audits.filter((e) => needsReview(e) && (!e.review || e.review.decision === 'pending')).length,
    pass_mark: passMark,
  };
}

export function getResponse(index, record, auditId, passMark) {
  const entry = (index.audits || []).find((e) => e.audit_id === auditId) || null;
  if (!record) return { audit: null, state: 'running_or_unknown' };
  return {
    audit: entry ? publicSummary(entry) : summarize(record.report),
    report: record.report,
    review: entry && entry.review ? entry.review : null,
    validation: entry && entry.validation ? entry.validation : null,
    pass_mark: passMark,
  };
}

export function reviewListResponse(index) {
  const items = (index.audits || []).filter(needsReview).map((e) => {
    const r = e.review || {};
    return {
      audit_id: e.audit_id,
      created_at: e.created_at,
      title: e.title,
      url: e.url,
      total: e.total,
      review_reasons: e.review_reasons || [],
      reviewer_score: Number.isFinite(r.reviewer_score) ? r.reviewer_score : null,
      decision: r.decision || 'pending',
      notes: r.notes || '',
      reviewed_at: r.reviewed_at || '',
      scores: publicSummary(e),
    };
  });
  items.sort((x, y) => (x.decision === 'pending' ? 0 : 1) - (y.decision === 'pending' ? 0 : 1) || byNewest(x, y));
  return { items };
}

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Returns { status, response } on a bad request, or { entry } to save.
export function applyReview(index, body) {
  const id = String((body && body.audit_id) || '');
  const e = (index.audits || []).find((x) => x.audit_id === id);
  if (!e || !needsReview(e)) return { status: 404, response: { error: 'That audit is not in the review queue' } };
  const decision = ['pending', 'approved', 'sent_back'].indexOf(body.decision) >= 0 ? body.decision : null;
  if (!decision) return { status: 400, response: { error: 'Decision must be approved, sent_back or pending' } };
  const score = num(body.reviewer_score);
  if (score !== null && (score < 0 || score > 100 || !Number.isInteger(score))) {
    return { status: 400, response: { error: 'Your score must be a whole number from 0 to 100' } };
  }
  const review = { decision, reviewer_score: score, notes: String(body.notes || '').slice(0, 1000), reviewed_at: new Date().toISOString() };
  return { entry: Object.assign({}, e, { review }) };
}

const LIMITS = { my_accuracy: 30, my_readability: 20, my_keywords: 20, my_sections: 20, my_plagiarism: 10 };

export function applyValidation(index, body) {
  const id = String((body && body.audit_id) || '');
  const e = (index.audits || []).find((x) => x.audit_id === id);
  if (!e) return { status: 404, response: { error: 'Unknown audit' } };
  const v = {};
  for (const k of Object.keys(LIMITS)) {
    const n = num(body[k]);
    if (n === null || n < 0 || n > LIMITS[k] || !Number.isInteger(n)) {
      return { status: 400, response: { error: k.replace('my_', '') + ' must be a whole number from 0 to ' + LIMITS[k] } };
    }
    v[k] = n;
  }
  v.my_total = v.my_accuracy + v.my_readability + v.my_keywords + v.my_sections + v.my_plagiarism;
  v.saved_at = new Date().toISOString();
  return { entry: Object.assign({}, e, { validation: v }), my_total: v.my_total };
}

export function replaceEntry(index, entry) {
  return { audits: (index.audits || []).map((e) => (e.audit_id === entry.audit_id ? entry : e)) };
}

export function validationResponse(index, passMark) {
  const pairs = (index.audits || []).filter((e) => e.validation).map((e) => {
    const ok = e.status !== 'error';
    return {
      audit_id: e.audit_id,
      title: e.title,
      found: ok,
      ai: ok ? { total: e.total, accuracy: e.accuracy, readability: e.readability, keywords: e.keywords, sections: e.sections, plagiarism: e.plagiarism } : {},
      me: {
        total: e.validation.my_total, accuracy: e.validation.my_accuracy, readability: e.validation.my_readability,
        keywords: e.validation.my_keywords, sections: e.validation.my_sections, plagiarism: e.validation.my_plagiarism,
      },
    };
  });
  return { pairs, pass_mark: passMark, target_count: 30 };
}

export const CSV_COLUMNS = [
  'audit_id', 'created_at', 'status', 'title', 'url', 'keyword', 'total', 'accuracy', 'readability', 'keywords',
  'sections', 'plagiarism', 'review_reasons', 'review_decision', 'reviewer_score', 'review_notes',
  'my_accuracy', 'my_readability', 'my_keywords', 'my_sections', 'my_plagiarism', 'my_total',
];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Stop spreadsheet apps from treating text as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(index) {
  const rows = (index.audits || []).slice().sort(byNewest).map((e) => {
    const r = e.review || {};
    const v = e.validation || {};
    return [
      e.audit_id, e.created_at, e.status, e.title, e.url, e.keyword, e.total, e.accuracy, e.readability, e.keywords,
      e.sections, e.plagiarism, (e.review_reasons || []).join(' | '), needsReview(e) ? (r.decision || 'pending') : '',
      r.reviewer_score, r.notes, v.my_accuracy, v.my_readability, v.my_keywords, v.my_sections, v.my_plagiarism, v.my_total,
    ].map(csvCell).join(',');
  });
  return '﻿' + [CSV_COLUMNS.join(',')].concat(rows).join('\r\n') + '\r\n';
}
