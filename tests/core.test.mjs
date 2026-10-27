import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSources } from '../scripts/inline.mjs';
import { computeValidation, pearson } from '../web/src/lib/validation.js';

const lib = loadSources(
  ['text.js', 'parse.js', 'readability.js', 'keywords.js', 'llm.js', 'scoring.js', 'input.js', 'external.js'],
  [
    'tokenizeWords', 'splitSentences', 'countPhrase', 'ariGrade', 'analyzeReadability', 'countPassive', 'findAdverbs',
    'parseHtml', 'parsePasted', 'analyzeKeywords', 'densityPoints', 'extractJson', 'normalizeAnalysis',
    'normalizeVerification', 'normalizeGap', 'buildReport', 'buildErrorReport',
    'normalizeInput', 'parseCopyscape', 'competitorUrls', 'rowsToObjects', 'plagiarismPoints',
  ]
);

test('tokenizer keeps contractions and hyphenated words', () => {
  assert.deepEqual(lib.tokenizeWords("Don't over-water it."), ["Don't", 'over-water', 'it']);
});

test('sentence split protects abbreviations', () => {
  const s = lib.splitSentences('Use greens, e.g. fruit peel. Add browns! Done?');
  assert.equal(s.length, 3);
  assert.equal(s[0], 'Use greens, e.g. fruit peel.');
});

test('ARI formula', () => {
  // 4.71*(500/100) + 0.5*(100/5) - 21.43 = 23.55 + 10 - 21.43 = 12.12
  assert.equal(Math.round(lib.ariGrade(500, 100, 5) * 100) / 100, 12.12);
});

test('plain text gets full readability points', () => {
  const text = 'Put the bin in the shade. Add food scraps. Mix in dry leaves. Keep it damp. Turn it each week.';
  const r = lib.analyzeReadability(text, 9);
  assert.equal(r.hard_sentences + r.very_hard_sentences, 0);
  assert.equal(r.points.grade, 8);
  assert.equal(r.score, 20);
});

test('long complex sentences are flagged hard or very hard', () => {
  const s = 'Notwithstanding considerable environmental variability, decomposition processes characteristically accelerate when microbiological communities encounter appropriately balanced carbon-nitrogen proportions alongside consistent moisture availability.';
  const r = lib.analyzeReadability(s + ' ' + s, 9);
  assert.equal(r.very_hard_sentences, 2);
  assert.ok(r.points.grade < 8);
  assert.ok(r.hardest_sentence);
});

test('passive voice and adverbs', () => {
  assert.equal(lib.countPassive('The bin was emptied. The lid was quickly closed. She runs.'), 2);
  assert.deepEqual(lib.findAdverbs('He really quickly left early with family.'), ['really', 'quickly']);
});

test('parseHtml strips chrome and builds sections', () => {
  const html = `<html><head><title>Composting guide</title>
    <meta content="Learn composting at home" name="description"></head>
    <body><nav><a>Home</a><h2>Menu</h2></nav>
    <article><h1>Composting at home</h1><p>Intro text &amp; more.</p>
    <h2>What is composting</h2><p>Composting turns scraps into soil.</p>
    <h3>Greens</h3><ul><li>Fruit peel</li><li>Coffee</li></ul>
    <script>var x = '<h2>bad</h2>';</script>
    <h2>FAQ</h2><p>Questions here.</p></article>
    <footer><h2>Footer</h2></footer></body></html>`;
  const a = lib.parseHtml(html, 'https://example.com/c');
  assert.equal(a.title, 'Composting guide');
  assert.equal(a.meta_description, 'Learn composting at home');
  assert.equal(a.h1, 'Composting at home');
  assert.equal(a.intro, 'Intro text & more.');
  assert.deepEqual(a.sections.map((s) => s.heading), ['What is composting', 'Greens', 'FAQ']);
  assert.equal(a.sections[1].text, 'Fruit peel\nCoffee');
  assert.equal(a.h2_count, 2);
});

test('parsePasted reads markdown headings', () => {
  const a = lib.parsePasted('My guide', 'Intro line.\n## Step one\nDo this.\n### Detail\n- a point\n## Step two\nThen that.');
  assert.equal(a.h1, 'My guide');
  assert.deepEqual(a.sections.map((s) => [s.level, s.heading]), [[2, 'Step one'], [3, 'Detail'], [2, 'Step two']]);
  assert.equal(a.sections[1].text, 'a point');
});

test('keyword placement, density and term coverage are computed in code', () => {
  const a = lib.parsePasted('Composting at home made simple', 'Composting at home is easy. ' + 'word '.repeat(196) + '\n## Bins\nPick a compost bin.');
  const k = lib.analyzeKeywords(a, 'composting at home', ['compost bin'], ['vermicomposting', 'Compost Bin'], { score: 3, expected: 'informational' });
  assert.equal(k.placement.find((p) => p.id === 'meta').applies, false);
  assert.equal(k.points.placement, 6);
  assert.equal(k.occurrences, 1);
  // 1 occurrence * 3 words / 203 words = 1.5%
  assert.equal(k.density, 1.5);
  assert.equal(k.points.density, 4);
  // duplicate "Compost Bin" removed; vermicomposting not in text
  assert.deepEqual(k.terms.map((t) => [t.term, t.covered]), [['compost bin', true], ['vermicomposting', false]]);
  assert.equal(k.points.related, 3);
  assert.equal(k.points.intent, 3);
});

test('density bands', () => {
  assert.equal(lib.densityPoints(0.2), 0);
  assert.equal(lib.densityPoints(0.4), 2);
  assert.equal(lib.densityPoints(2.5), 4);
  assert.equal(lib.densityPoints(3), 2);
  assert.equal(lib.densityPoints(5), 0);
});

test('extractJson handles fences and stray text', () => {
  assert.deepEqual(lib.extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(lib.extractJson('Sure: {"a":{"b":2}} thanks'), { a: { b: 2 } });
  assert.throws(() => lib.extractJson('no json'));
});

test('analysis normaliser clamps scores and fills missing sections', () => {
  const article = { sections: [{ heading: 'A' }, { heading: 'B' }] };
  const n = lib.normalizeAnalysis({ sections: [{ index: 0, score: 14, note: 'ok' }], title_promise: { score: -2 }, claims: [{ claim: 'x' }] }, article);
  assert.equal(n.sections[0].score, 10);
  assert.equal(n.sections[1].score, null);
  assert.equal(n.title_promise.score, 0);
  assert.equal(n.claims.length, 0);
});

test('verification without a real source is downgraded to unverified', () => {
  const items = [
    { claim: 'c1', results: [{ url: 'https://a.com' }] },
    { claim: 'c2', results: [{ url: 'https://b.com' }] },
    { claim: 'c3', results: [] },
  ];
  const v = lib.normalizeVerification({ claims: [
    { i: 0, status: 'verified', source_url: 'https://made-up.com' },
    { i: 1, status: 'false', source_url: 'https://b.com', evidence: 'says otherwise' },
  ] }, items);
  assert.deepEqual(v.map((c) => c.status), ['unverified', 'false', 'unverified']);
  assert.equal(v[1].source_url, 'https://b.com');
});

test('gap normaliser drops topics below the page threshold', () => {
  const t = lib.normalizeGap({ topics: [
    { subtopic: 'Smells', found_in: 8, coverage: 'missing' },
    { subtopic: 'Rare', found_in: 2, coverage: 'missing' },
    { subtopic: 'Over', found_in: 99, coverage: 'weird' },
  ] }, 10);
  assert.deepEqual(t.map((x) => [x.subtopic, x.found_in, x.coverage]), [['Smells', 8, 'missing'], ['Over', 10, 'missing']]);
});

test('Copyscape parsing', () => {
  assert.equal(lib.parseCopyscape({ count: 0, querywords: 900 }).percent, 0);
  assert.equal(lib.parseCopyscape({ error: 'Bad key' }).checked, false);
  const r = lib.parseCopyscape({ count: 2, allpercentmatched: 12.34, result: [{ url: 'u', title: 't', percentmatched: 9, minwordsmatched: 40 }] });
  assert.equal(r.percent, 12.3);
  assert.equal(r.sources[0].percent, 9);
  assert.equal(lib.parseCopyscape({ count: 3, result: [] }).checked, false);
  assert.deepEqual([3, 5, 7, 12, 20].map(lib.plagiarismPoints), [10, 10, 6, 2, 0]);
});

test('competitor URLs skip own site and documents', () => {
  const serp = { organic_results: [
    { link: 'https://www.mysite.com/a' }, { link: 'https://b.com/x.pdf' }, { link: 'https://c.com/y', title: 'C' },
  ] };
  assert.deepEqual(lib.competitorUrls(serp, 'https://mysite.com/post', 8).map((r) => r.url), ['https://c.com/y']);
});

test('input validation', () => {
  assert.deepEqual(lib.normalizeInput({}).errors, ['Give either a URL or the article content', 'Primary keyword is required']);
  const ok = lib.normalizeInput({ url: 'https://x.com/a', keyword: 'kw', secondary: 'a, b,,c', market: 'us-en', target_grade: '7' });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.input.secondary, ['a', 'b', 'c']);
  assert.equal(ok.input.gl, 'us');
  assert.equal(ok.input.target_grade, 7);
});

function sampleCtx(over) {
  const article = lib.parsePasted('Composting at home', 'Intro words here. '.repeat(15) + '\n## One\nText.\n## Two\nText.\n## Three\nText.\n## Conclusion\nEnd.');
  return Object.assign({
    audit_id: 'aud_1', created_at: '2026-10-26T10:00:00Z',
    input: { keyword: 'composting at home', secondary: [], target_grade: 9, market_label: 'India · English' },
    article,
    readability: { score: 15, max: 20, points: {} },
    keywords: { score: 16, max: 20, points: {} },
    analysis: {
      sections: [{ heading: 'One', score: 8 }, { heading: 'Two', score: 9 }],
      freshness: { score: 4, note: '' }, title_promise: { score: 3, note: '' },
    },
    verification: [{ status: 'verified' }, { status: 'verified' }, { status: 'unverified' }, { status: 'verified' }],
    competitors: [{ url: 'a', word_count: 1000, headings: [] }, { url: 'b', word_count: 1200, headings: [] }],
    gap: [{ subtopic: 'x', coverage: 'covered' }, { subtopic: 'y', coverage: 'missing' }],
    plagiarism: { checked: true, percent: 3, sources: [] },
    config: { pass_mark: 70, model: 'm' },
  }, over || {});
}

test('report totals and pass/fail', () => {
  const r = lib.buildReport(sampleCtx());
  const p = r.parameters;
  // accuracy: relevancy round(8.5)=9, claims round(12*3.5/4)=11, fresh 4, title 3 = 27
  assert.equal(p.accuracy.score, 27);
  // sections: coverage 6, structure intro+conclusion+4 h2 = 3, depth: article words vs median 1100 -> low
  assert.equal(p.sections.points.coverage, 6);
  assert.equal(p.sections.points.structure, 3);
  assert.equal(p.plagiarism.score, 10);
  assert.equal(r.total, p.accuracy.score + 15 + 16 + p.sections.score + 10);
  assert.equal(r.status, r.total < 70 ? 'needs_review' : 'passed');
});

test('hard flags force review even above the pass mark', () => {
  const r = lib.buildReport(sampleCtx({ verification: [{ status: 'false', claim: 'x' }], plagiarism: { checked: true, percent: 20 } }));
  assert.equal(r.status, 'needs_review');
  const codes = r.flags.map((f) => f.code);
  assert.ok(codes.includes('false_claim'));
  assert.ok(codes.includes('plagiarism_over_15'));
});

test('a failed plagiarism check sends the article to review', () => {
  const r = lib.buildReport(sampleCtx({ plagiarism: { checked: false, error: 'timeout' } }));
  assert.equal(r.status, 'needs_review');
  assert.equal(r.parameters.plagiarism.score, 0);
});

test('error report has no scores and keeps the reason', () => {
  const r = lib.buildErrorReport({ audit_id: 'aud_x', created_at: 't', input: { url: 'https://a.com', keyword: 'k', secondary: [] }, error: 'blocked', config: {} });
  assert.equal(r.status, 'error');
  assert.equal(r.parameters, null);
  assert.equal(r.total, null);
  assert.deepEqual(r.review_reasons, ['blocked']);
});

test('rowsToObjects keeps sheet row numbers', () => {
  const o = lib.rowsToObjects([['audit_id', 'total'], ['a', '70'], ['b']]);
  assert.deepEqual(o, [{ _row: 2, audit_id: 'a', total: '70' }, { _row: 3, audit_id: 'b', total: '' }]);
});

test('validation metrics', () => {
  assert.equal(Math.round(pearson([1, 2, 3], [2, 4, 6]) * 1000) / 1000, 1);
  const v = computeValidation([
    { audit_id: 'a', ai: { total: 80, accuracy: 25 }, me: { total: 75, accuracy: 22 } },
    { audit_id: 'b', ai: { total: 60, accuracy: 18 }, me: { total: 72, accuracy: 20 } },
    { audit_id: 'c', ai: { total: 90 }, me: { accuracy: 1, readability: 2, keywords: 3, sections: 4, plagiarism: 5 } },
    { audit_id: 'd', ai: { total: 50 }, me: {} },
  ], 70);
  assert.equal(v.n, 3);
  // gaps: +5, -12, +75 (c total = 15)
  assert.equal(v.mae_total, (5 + 12 + 75) / 3);
  // a: both pass; b: ai fail, me pass; c: ai pass, me fail
  assert.equal(v.agreement, 1);
  // c has no AI accuracy sub-score, so only a and b count for accuracy
  assert.equal(v.by_param[0].n, 2);
  assert.equal(v.by_param[0].bias, ((25 - 22) + (18 - 20)) / 2);
});

const llm = loadSources(['text.js', 'llm.js'], ['groqBody', 'llmFailure', 'llmText', 'budgetArticle']);

test('Groq body: gpt-oss gets reasoning settings, other models get temperature 0', () => {
  const a = llm.groqBody('openai/gpt-oss-120b', 'Return JSON', 1500, 'high');
  assert.equal(a.reasoning_effort, 'high');
  assert.equal(a.include_reasoning, false);
  assert.equal(a.temperature, undefined);
  assert.equal(a.max_completion_tokens, 1500);
  assert.equal(llm.groqBody('openai/gpt-oss-20b', 'x', 10, 'bogus').reasoning_effort, 'low');
  const b = llm.groqBody('llama-3.3-70b-versatile', 'x', 10, 'low');
  assert.equal(b.reasoning_effort, undefined);
  assert.equal(b.include_reasoning, undefined);
  assert.equal(b.temperature, 0);
  assert.deepEqual(b.response_format, { type: 'json_object' });
});

test('Groq failures become plain-language reasons', () => {
  assert.equal(llm.llmFailure({ choices: [{ message: { content: '{"a":1}' } }] }), null);
  assert.match(llm.llmFailure({ error: { message: 'Request failed with status code 429' } }), /rate limit/);
  assert.match(llm.llmFailure({ error: { message: '413 Request too large for model' } }), /MAX_PROMPT_CHARS/);
  assert.match(llm.llmFailure({ error: { message: '401 Invalid API Key' } }), /GROQ_API_KEY/);
  assert.match(llm.llmFailure({ error: { message: 'The model `x` does not exist', httpCode: '404' } }), /model/);
  assert.match(llm.llmFailure({ choices: [{ finish_reason: 'length', message: { content: '' } }] }), /token limit/);
  assert.match(llm.llmFailure({}), /Groq request failed/);
});

test('article budget splits characters across sections', () => {
  const article = { intro: 'i'.repeat(5000), sections: Array.from({ length: 4 }, (_, k) => ({ heading: 'H' + k, text: 's'.repeat(9000) })) };
  const b = llm.budgetArticle(article, 10000);
  assert.equal(b.truncated, true);
  const total = b.intro.length + b.sections.reduce((n, s) => n + s.text.length, 0);
  assert.ok(total <= 10000 + 5 * 4, 'total ' + total);
  assert.equal(llm.budgetArticle({ intro: 'short', sections: [{ heading: 'a', text: 'b' }] }, 14000).truncated, false);
});
