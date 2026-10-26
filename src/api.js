// Handles the web app's data requests inside the n8n "API" workflow.
// Input: the request body, plus the three sheet tabs already read in one
// batchGet. Output: the JSON response and, when needed, the cells to write.
// Depends on text.js, external.js (rowsToObjects) and scoring.js (column lists).

export function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function summary(r) {
  return {
    audit_id: r.audit_id,
    created_at: r.created_at,
    status: r.status,
    title: r.title,
    url: r.url,
    keyword: r.keyword,
    total: num(r.total),
    accuracy: num(r.accuracy),
    readability: num(r.readability),
    keywords: num(r.keywords),
    sections: num(r.sections),
    plagiarism: num(r.plagiarism),
    review_reasons: r.review_reasons ? String(r.review_reasons).split(' | ') : [],
  };
}

function byNewest(a, b) {
  return String(b.created_at).localeCompare(String(a.created_at));
}

function writeRow(tab, columns, existingValues, auditId, rowValues, startCol) {
  // Returns batchUpdate "data" entries that set one row (inserting the
  // header first if the tab is empty).
  const data = [];
  const objs = rowsToObjects(existingValues);
  let rowNum;
  const found = objs.find((o) => o.audit_id === auditId);
  if (found) rowNum = found._row;
  else {
    if (!existingValues || !existingValues.length) {
      data.push({ range: tab + '!A1:' + colLetter(columns.length) + '1', values: [columns] });
      rowNum = 2;
    } else {
      rowNum = existingValues.length + 1;
    }
  }
  const from = startCol || 1;
  const to = from + rowValues.length - 1;
  data.push({ range: tab + '!' + colLetter(from) + rowNum + ':' + colLetter(to) + rowNum, values: [rowValues] });
  return data;
}

export function handleApi(body, sheets, config) {
  const b = body && typeof body === 'object' ? body : {};
  const action = String(b.action || '');
  const results = rowsToObjects(sheets.Results);
  const reviews = rowsToObjects(sheets.Review);
  const validation = rowsToObjects(sheets.Validation);
  const passMark = Number(config && config.pass_mark) || 70;
  const ok = (response) => ({ status_code: 200, response: response, write: null });
  const bad = (msg, code) => ({ status_code: code || 400, response: { error: msg }, write: null });

  if (action === 'list') {
    const pending = reviews.filter((r) => (r.decision || 'pending') === 'pending').length;
    return ok({ audits: results.map(summary).sort(byNewest).slice(0, 100), pending_reviews: pending, pass_mark: passMark });
  }

  if (action === 'get') {
    const id = String(b.audit_id || '');
    const row = results.find((r) => r.audit_id === id);
    if (!row) return ok({ audit: null, state: 'running_or_unknown' });
    let report = null;
    try { report = JSON.parse(row.report_json); } catch (e) { report = null; }
    const rev = reviews.find((r) => r.audit_id === id) || null;
    const val = validation.find((r) => r.audit_id === id) || null;
    return ok({ audit: summary(row), report, review: rev, validation: val, pass_mark: passMark });
  }

  if (action === 'review_list') {
    const byId = new Map(results.map((r) => [r.audit_id, summary(r)]));
    const items = reviews.map((r) => ({
      audit_id: r.audit_id,
      created_at: r.created_at,
      title: r.title,
      url: r.url,
      total: num(r.total),
      review_reasons: r.review_reasons ? String(r.review_reasons).split(' | ') : [],
      reviewer_score: num(r.reviewer_score),
      decision: r.decision || 'pending',
      notes: r.notes || '',
      reviewed_at: r.reviewed_at || '',
      scores: byId.get(r.audit_id) || null,
    }));
    items.sort((x, y) => (x.decision === 'pending' ? 0 : 1) - (y.decision === 'pending' ? 0 : 1) || byNewest(x, y));
    return ok({ items });
  }

  if (action === 'review_save') {
    const id = String(b.audit_id || '');
    if (!reviews.find((r) => r.audit_id === id)) return bad('That audit is not in the review queue', 404);
    const decision = ['pending', 'approved', 'sent_back'].indexOf(b.decision) >= 0 ? b.decision : null;
    if (!decision) return bad('Decision must be approved, sent_back or pending');
    const score = num(b.reviewer_score);
    if (score !== null && (score < 0 || score > 100)) return bad('Your score must be between 0 and 100');
    const notes = String(b.notes || '').slice(0, 1000);
    const values = [score === null ? '' : score, decision, notes, new Date().toISOString()];
    // reviewer_score is column 7 (G) in REVIEW_COLUMNS
    const data = writeRow('Review', REVIEW_COLUMNS, sheets.Review, id, values, REVIEW_COLUMNS.indexOf('reviewer_score') + 1);
    return { status_code: 200, response: { saved: true }, write: { data } };
  }

  if (action === 'validation') {
    const byId = new Map(results.map((r) => [r.audit_id, summary(r)]));
    const pairs = validation.map((v) => {
      const ai = byId.get(v.audit_id) || null;
      return {
        audit_id: v.audit_id,
        title: v.title || (ai && ai.title) || '',
        found: Boolean(ai),
        ai: ai ? { total: ai.total, accuracy: ai.accuracy, readability: ai.readability, keywords: ai.keywords, sections: ai.sections, plagiarism: ai.plagiarism } : {},
        me: {
          total: num(v.my_total), accuracy: num(v.my_accuracy), readability: num(v.my_readability),
          keywords: num(v.my_keywords), sections: num(v.my_sections), plagiarism: num(v.my_plagiarism),
        },
      };
    });
    return ok({ pairs, pass_mark: passMark, target_count: 30 });
  }

  if (action === 'validation_save') {
    const id = String(b.audit_id || '');
    const row = results.find((r) => r.audit_id === id);
    if (!row) return bad('Unknown audit', 404);
    const limits = { my_accuracy: 30, my_readability: 20, my_keywords: 20, my_sections: 20, my_plagiarism: 10 };
    const vals = {};
    for (const k of Object.keys(limits)) {
      const n = num(b[k]);
      if (n === null || n < 0 || n > limits[k]) return bad(k.replace('my_', '') + ' must be between 0 and ' + limits[k]);
      vals[k] = n;
    }
    const total = vals.my_accuracy + vals.my_readability + vals.my_keywords + vals.my_sections + vals.my_plagiarism;
    const values = [id, row.title, vals.my_accuracy, vals.my_readability, vals.my_keywords, vals.my_sections, vals.my_plagiarism, total];
    const data = writeRow('Validation', VALIDATION_COLUMNS, sheets.Validation, id, values, 1);
    return { status_code: 200, response: { saved: true, my_total: total }, write: { data } };
  }

  return bad('Unknown action');
}
