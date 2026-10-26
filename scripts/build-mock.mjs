// Builds the sample data used when MOCK_MODE=1 (local preview without n8n).
// The sample reports are produced by the real scoring code with canned
// LLM / search answers, so the UI shows exactly the shape n8n will send.
// Run: npm run build:mock
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inlineSources, loadSources } from './inline.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['text.js', 'parse.js', 'readability.js', 'keywords.js', 'llm.js', 'scoring.js', 'input.js', 'external.js', 'api.js'];
const L = loadSources(FILES, ['parsePasted', 'analyzeReadability', 'analyzeKeywords', 'normalizeAnalysis', 'normalizeVerification',
  'normalizeGap', 'buildReport', 'resultsRow', 'reviewRow', 'normalizeInput', 'parseCopyscape', 'RESULTS_COLUMNS', 'REVIEW_COLUMNS', 'VALIDATION_COLUMNS']);

const samples = [
  {
    id: 'aud_sample_compost', at: '2026-10-26T13:10:00Z', keyword: 'composting at home', secondary: 'compost bin, green waste, brown waste',
    heading: "A beginner's guide to composting at home",
    content: [
      'Composting at home turns kitchen scraps into soil for your garden. It takes a bin, some patience and a mix of wet and dry material. Most people can start with what they already throw away each week, and the result saves money on soil and cuts the rubbish going to landfill.',
      '## What is composting',
      'Composting is the breakdown of food and garden waste by microbes, worms and fungi. They need air, water and a balance of materials to work quickly.',
      '## Greens and browns',
      'Greens are wet, nitrogen-rich scraps such as fruit peel, vegetable trimmings and coffee grounds. Browns are dry, carbon-rich items like dead leaves, straw and plain cardboard. A compost bin works best with a mix of both.',
      '## Choosing a bin',
      'Plastic bins are cheap and tidy. Wooden boxes hold heat well. Tumblers are easy to turn but cost more.',
      '## Step-by-step setup',
      'Put the bin on bare soil in partial shade. Add a layer of browns, then greens, and repeat. Keep the pile as damp as a wrung-out sponge and turn it every week or two.',
      '## Common mistakes',
      'Meat and dairy are fine in any home bin. Many people also forget that a vegetable garden needs regular watering in summer and that tomatoes are best grown in full sun.',
      '## Conclusion',
      'Start small, keep the mix balanced and be patient.',
    ].join('\n'),
    analysis: {
      sections: [{ index: 0, score: 9, note: 'Answers the heading directly' }, { index: 1, score: 9, note: 'Clear examples of each' },
        { index: 2, score: 8, note: 'No size guidance for small flats' }, { index: 3, score: 9, note: 'Steps are in a sensible order' },
        { index: 4, score: 5, note: 'Drifts into general gardening tips' }, { index: 5, score: 7, note: 'Short but on topic' }],
      title_promise: { score: 3, note: 'Covers the basics a beginner needs' },
      freshness: { score: 4, note: 'No dated statistics' },
      claims: [
        { claim: 'Meat and dairy are fine in any home bin', search_query: 'can you put meat and dairy in a home compost bin' },
        { claim: 'Compost should be as damp as a wrung-out sponge', search_query: 'compost moisture wrung out sponge' },
        { claim: 'Browns are carbon-rich and greens are nitrogen-rich', search_query: 'compost greens nitrogen browns carbon' },
      ],
      related_terms: ['vermicomposting', 'compost ratio', 'aeration', 'brown waste'],
      intent: { expected: 'informational', score: 3, note: 'How-to intent; intro is a little slow to reach the steps' },
    },
    verify: [
      { i: 0, status: 'false', source_url: 'https://example.org/compost-dos-and-donts', evidence: 'Guides advise keeping meat and dairy out of standard home bins' },
      { i: 1, status: 'verified', source_url: 'https://example.org/compost-moisture', evidence: 'Moisture guidance matches' },
      { i: 2, status: 'verified', source_url: 'https://example.org/greens-browns', evidence: 'Carbon/nitrogen split matches' },
    ],
    gap: [
      { subtopic: 'Troubleshooting smells and pests', found_in: 8, coverage: 'missing', note: '' },
      { subtopic: 'What not to compost', found_in: 7, coverage: 'missing', note: '' },
      { subtopic: 'Using finished compost', found_in: 5, coverage: 'thin', note: 'One line only' },
      { subtopic: 'Greens and browns', found_in: 9, coverage: 'covered', note: '' },
      { subtopic: 'Choosing a bin', found_in: 6, coverage: 'covered', note: '' },
    ],
    competitorWords: [1900, 2200, 1600, 2400, 2100, 1800, 2500, 2000],
    copyscape: { querywords: 250, count: 2, allpercentmatched: 8, result: [{ url: 'https://example.net/compost-basics', title: 'Compost basics', minwordsmatched: 14, percentmatched: 5 }, { url: 'https://example.com/garden/compost', title: 'Garden compost', minwordsmatched: 9, percentmatched: 3 }] },
  },
  {
    id: 'aud_sample_desk', at: '2026-10-26T10:35:00Z', keyword: 'standing desk guide', secondary: 'desk height, monitor arm',
    heading: 'Standing desk guide: how to choose one',
    content: [
      'A standing desk guide should help you pick the right desk for your room, your height and your budget. This one covers the choices that matter and the ones that do not.',
      '## Fixed or adjustable',
      'Electric desks change height at the push of a button. Crank desks are cheaper and slower. Desk risers sit on top of a normal desk.',
      '## Getting the desk height right',
      'Your elbows should sit at about ninety degrees when you type. A monitor arm lets you raise the screen to eye level.',
      '## Stability and weight limits',
      'Check the weight limit and how much the desk wobbles at full height before you buy.',
      '## Frequently asked questions',
      'How long should I stand? Change position often rather than standing all day.',
      '## Conclusion',
      'Pick the desk that fits your room and how you actually work.',
    ].join('\n'),
    analysis: {
      sections: [0, 1, 2, 3, 4].map((i) => ({ index: i, score: 9, note: 'On topic' })),
      title_promise: { score: 3, note: 'Delivers a buying guide' },
      freshness: { score: 5, note: 'Nothing time-sensitive' },
      claims: [{ claim: 'Elbows should be at about ninety degrees when typing', search_query: 'standing desk elbow angle 90 degrees typing' }],
      related_terms: ['ergonomics', 'anti-fatigue mat'],
      intent: { expected: 'commercial', score: 4, note: 'Matches buying intent' },
    },
    verify: [{ i: 0, status: 'verified', source_url: 'https://example.org/desk-ergonomics', evidence: 'Ergonomics guidance matches' }],
    gap: [{ subtopic: 'Desk height', found_in: 8, coverage: 'covered' }, { subtopic: 'Electric vs manual', found_in: 7, coverage: 'covered' }, { subtopic: 'Cable management', found_in: 4, coverage: 'missing' }],
    competitorWords: [900, 1100, 1000, 1200, 950],
    copyscape: { querywords: 200, count: 0 },
  },
];

function report(s) {
  const { input } = L.normalizeInput({ heading: s.heading, content: s.content, keyword: s.keyword, secondary: s.secondary, market: 'in-en' });
  const article = L.parsePasted(input.heading, input.content, '');
  const analysis = L.normalizeAnalysis(s.analysis, article);
  const items = analysis.claims.map((c, i) => ({ claim: c.claim, results: [{ url: s.verify[i].source_url, title: 'Source', snippet: '' }] }));
  return L.buildReport({
    audit_id: s.id,
    created_at: s.at,
    input,
    article,
    readability: L.analyzeReadability(article.body_text, input.target_grade),
    keywords: L.analyzeKeywords(article, input.keyword, input.secondary, analysis.related_terms, analysis.intent),
    analysis,
    verification: L.normalizeVerification({ claims: s.verify }, items),
    competitors: s.competitorWords.map((w, i) => ({ url: 'https://competitor' + (i + 1) + '.example/' + s.id, title: 'Competitor ' + (i + 1), word_count: w, headings: [] })),
    gap: L.normalizeGap({ topics: s.gap }, s.competitorWords.length),
    plagiarism: L.parseCopyscape(s.copyscape),
    config: { pass_mark: 70, model: 'claude-sonnet-5-5 (sample)' },
  });
}

const reports = samples.map(report);
const sheets = {
  Results: [L.RESULTS_COLUMNS].concat(reports.map((r) => L.resultsRow(r))),
  Review: [L.REVIEW_COLUMNS].concat(reports.filter((r) => r.status === 'needs_review').map((r) => L.reviewRow(r))),
  Validation: [L.VALIDATION_COLUMNS],
};

const handler = '// Generated by scripts/build-mock.mjs — do not edit.\n' + inlineSources(['text.js', 'parse.js', 'external.js', 'scoring.js', 'api.js']) +
  '\nexport { handleApi, RESULTS_COLUMNS, REVIEW_COLUMNS };\n';
writeFileSync(join(root, 'api', '_mock-handler.js'), handler);
writeFileSync(join(root, 'api', '_mock-data.js'), '// Generated by scripts/build-mock.mjs — sample data for MOCK_MODE=1.\nexport const SHEETS = ' + JSON.stringify(sheets, null, 1) + ';\n');
console.log('wrote api/_mock-data.js (' + reports.map((r) => r.audit_id + ' ' + r.total + ' ' + r.status).join(', ') + ')');
