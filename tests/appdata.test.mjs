import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize, upsertEntry, replaceEntry, listResponse, getResponse, reviewListResponse,
  applyReview, applyValidation, validationResponse, toCsv, buildErrorReport,
} from '../api/_engine.js';

function entry(id, status, total, at) {
  return { audit_id: id, created_at: at, status, title: 'T ' + id, url: '', keyword: 'kw', total, accuracy: 20, readability: 15, keywords: 15, sections: 10, plagiarism: 10, review_reasons: status === 'passed' ? [] : ['Total below 70'], review: null, validation: null };
}
const idx = { audits: [entry('aud_a_000001', 'needs_review', 60, '2026-10-26T10:00:00Z'), entry('aud_b_000002', 'passed', 85, '2026-10-26T12:00:00Z')] };

test('list is newest first and counts pending reviews', () => {
  const r = listResponse(idx, 70);
  assert.deepEqual(r.audits.map((a) => a.audit_id), ['aud_b_000002', 'aud_a_000001']);
  assert.equal(r.pending_reviews, 1);
  assert.equal(r.audits[0].review, undefined);
});

test('get: running while no report exists', () => {
  assert.equal(getResponse(idx, null, 'aud_a_000001', 70).state, 'running_or_unknown');
  const rep = { report: { total: 60 } };
  assert.equal(getResponse(idx, rep, 'aud_a_000001', 70).report.total, 60);
});

test('upsert keeps review and validation when a report is re-saved', () => {
  let i = replaceEntry(idx, Object.assign({}, idx.audits[0], { review: { decision: 'approved' } }));
  i = upsertEntry(i, Object.assign({}, idx.audits[0], { total: 62 }));
  const e = i.audits.find((x) => x.audit_id === 'aud_a_000001');
  assert.equal(e.total, 62);
  assert.equal(e.review.decision, 'approved');
});

test('review save validates input', () => {
  assert.equal(applyReview(idx, { audit_id: 'aud_b_000002', decision: 'approved' }).status, 404);
  assert.equal(applyReview(idx, { audit_id: 'aud_a_000001', decision: 'maybe' }).status, 400);
  assert.equal(applyReview(idx, { audit_id: 'aud_a_000001', decision: 'approved', reviewer_score: 101 }).status, 400);
  const ok = applyReview(idx, { audit_id: 'aud_a_000001', decision: 'sent_back', reviewer_score: 55, notes: 'fix intro' });
  assert.equal(ok.entry.review.decision, 'sent_back');
  const list = reviewListResponse(replaceEntry(idx, ok.entry));
  assert.equal(list.items[0].decision, 'sent_back');
  assert.equal(list.items[0].reviewer_score, 55);
});

test('validation save and pairs; failed audits do not count', () => {
  assert.equal(applyValidation(idx, { audit_id: 'aud_a_000001', my_accuracy: 31, my_readability: 1, my_keywords: 1, my_sections: 1, my_plagiarism: 1 }).status, 400);
  const v = applyValidation(idx, { audit_id: 'aud_a_000001', my_accuracy: 22, my_readability: 15, my_keywords: 14, my_sections: 10, my_plagiarism: 8 });
  assert.equal(v.my_total, 69);
  let i = replaceEntry(idx, v.entry);
  const err = summarize(buildErrorReport({ audit_id: 'aud_c_000003', created_at: '2026-10-26T13:00:00Z', input: { keyword: 'k', secondary: [] }, error: 'x', config: {} }));
  i = upsertEntry(i, err);
  i = replaceEntry(i, applyValidation(i, { audit_id: 'aud_c_000003', my_accuracy: 1, my_readability: 1, my_keywords: 1, my_sections: 1, my_plagiarism: 1 }).entry);
  const pairs = validationResponse(i, 70).pairs;
  assert.equal(pairs.length, 2);
  assert.equal(pairs.find((p) => p.audit_id === 'aud_a_000001').me.total, 69);
  assert.equal(pairs.find((p) => p.audit_id === 'aud_c_000003').found, false);
});

test('CSV escapes commas, quotes and formula-looking text', () => {
  const e = Object.assign(entry('aud_d_000004', 'passed', 80, '2026-10-26T14:00:00Z'), { title: '=HYPERLINK("x"), hi' });
  const csv = toCsv({ audits: [e] });
  assert.match(csv, /"'=HYPERLINK\(""x""\), hi"/);
});
