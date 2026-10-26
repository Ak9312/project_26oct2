import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSources } from '../scripts/inline.mjs';

const lib = loadSources(
  ['text.js', 'parse.js', 'external.js', 'scoring.js', 'api.js', 'email.js'],
  ['handleApi', 'colLetter', 'base64Encode', 'base64Url', 'buildAlertEmail', 'RESULTS_COLUMNS', 'REVIEW_COLUMNS', 'VALIDATION_COLUMNS']
);

const results = [
  lib.RESULTS_COLUMNS,
  ['aud_1', '2026-10-26T10:00:00Z', 'needs_review', 'Old', 'https://a.com', 'kw', '60', '20', '10', '10', '10', '10', 'Total 60 is below 70', 'm', '{"total":60}'],
  ['aud_2', '2026-10-26T12:00:00Z', 'passed', 'New', '', 'kw2', '80', '25', '15', '15', '15', '10', '', 'm', '{"total":80}'],
];
const review = [lib.REVIEW_COLUMNS, ['aud_1', '2026-10-26T10:00:00Z', 'Old', 'https://a.com', '60', 'Total 60 is below 70', '', 'pending', '', '']];
const sheets = { Results: results, Review: review, Validation: [] };

test('column letters', () => {
  assert.deepEqual([1, 7, 26, 27, 52].map(lib.colLetter), ['A', 'G', 'Z', 'AA', 'AZ']);
});

test('list sorts newest first and counts pending reviews', () => {
  const r = lib.handleApi({ action: 'list' }, sheets, { pass_mark: 70 });
  assert.deepEqual(r.response.audits.map((a) => a.audit_id), ['aud_2', 'aud_1']);
  assert.equal(r.response.audits[1].total, 60);
  assert.equal(r.response.pending_reviews, 1);
});

test('get returns parsed report, or running state when not written yet', () => {
  assert.equal(lib.handleApi({ action: 'get', audit_id: 'aud_2' }, sheets, {}).response.report.total, 80);
  assert.equal(lib.handleApi({ action: 'get', audit_id: 'nope' }, sheets, {}).response.state, 'running_or_unknown');
});

test('review_save writes columns G:J of the right row', () => {
  const r = lib.handleApi({ action: 'review_save', audit_id: 'aud_1', reviewer_score: 64, decision: 'approved', notes: 'ok' }, sheets, {});
  assert.equal(r.write.data.length, 1);
  assert.equal(r.write.data[0].range, 'Review!G2:J2');
  assert.deepEqual(r.write.data[0].values[0].slice(0, 3), [64, 'approved', 'ok']);
  assert.equal(lib.handleApi({ action: 'review_save', audit_id: 'aud_1', decision: 'maybe' }, sheets, {}).status_code, 400);
  assert.equal(lib.handleApi({ action: 'review_save', audit_id: 'aud_1', decision: 'approved', reviewer_score: 120 }, sheets, {}).status_code, 400);
});

test('validation_save on an empty tab writes the header and row 2', () => {
  const r = lib.handleApi({ action: 'validation_save', audit_id: 'aud_2', my_accuracy: 24, my_readability: 16, my_keywords: 14, my_sections: 15, my_plagiarism: 10 }, sheets, {});
  assert.equal(r.write.data[0].range, 'Validation!A1:H1');
  assert.equal(r.write.data[1].range, 'Validation!A2:H2');
  assert.equal(r.response.my_total, 79);
  const bad = lib.handleApi({ action: 'validation_save', audit_id: 'aud_2', my_accuracy: 40, my_readability: 1, my_keywords: 1, my_sections: 1, my_plagiarism: 1 }, sheets, {});
  assert.equal(bad.status_code, 400);
});

test('validation joins your scores with the workflow scores', () => {
  const s = Object.assign({}, sheets, { Validation: [lib.VALIDATION_COLUMNS, ['aud_2', 'New', '24', '16', '14', '15', '10', '79']] });
  const r = lib.handleApi({ action: 'validation' }, s, {});
  assert.equal(r.response.pairs[0].ai.total, 80);
  assert.equal(r.response.pairs[0].me.total, 79);
});

test('unknown action', () => {
  assert.equal(lib.handleApi({ action: 'drop_tables' }, sheets, {}).status_code, 400);
});

test('base64 matches Node for unicode text', () => {
  const s = 'Review needed: Café · 69/100 — ✓';
  assert.equal(lib.base64Encode(s), Buffer.from(s, 'utf8').toString('base64'));
  assert.equal(lib.base64Url(s), Buffer.from(s, 'utf8').toString('base64url'));
});

test('alert email is a valid base64url MIME message', () => {
  const report = {
    audit_id: 'aud_1', total: 60, pass_mark: 70, review_reasons: ['Total 60 is below 70'],
    article: { title: 'T <b>', url: 'https://a.com' }, input: { keyword: 'kw' },
    parameters: { accuracy: { score: 20 }, readability: { score: 10 }, keywords: { score: 10 }, sections: { score: 10 }, plagiarism: { score: 10 } },
  };
  const e = lib.buildAlertEmail(report, 'me@example.com', 'https://app.example.com/');
  const mime = Buffer.from(e.raw, 'base64url').toString('utf8');
  assert.match(mime, /^To: me@example.com\r\n/);
  const body = Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString('utf8');
  assert.match(body, /T &lt;b&gt;/);
  assert.match(body, /https:\/\/app\.example\.com\/report\.html\?id=aud_1/);
});
