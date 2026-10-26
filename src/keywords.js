// Keyword checks. Placement and density are computed here; the LLM only
// proposes related terms and judges search intent, and coverage of every
// term is re-checked against the text in code (the LLM's "covered" claims
// are never trusted).
// Depends on text.js.

export function keywordDensity(text, keyword) {
  const total = tokenizeWords(text).length;
  const kwWords = tokenizeWords(keyword).length;
  const occurrences = countPhrase(text, keyword);
  const density = total && kwWords ? (occurrences * kwWords * 100) / total : 0;
  return { occurrences, density: round1(density) };
}

export function densityPoints(density) {
  if (density >= 0.5 && density <= 2.5) return 4;
  if ((density >= 0.3 && density < 0.5) || (density > 2.5 && density <= 3.5)) return 2;
  return 0;
}

export function analyzeKeywords(article, keyword, secondary, relatedTerms, intent) {
  const kw = collapseWhitespace(keyword);
  const fullText = [article.h1, article.body_text].join('\n');
  const opening = firstNWords(article.body_text, 100);

  const checks = [
    { id: 'title', label: 'In title', weight: 2, applies: Boolean(article.title), pass: containsPhrase(article.title, kw) },
    { id: 'h1', label: 'In H1', weight: 1, applies: Boolean(article.h1), pass: containsPhrase(article.h1, kw) },
    { id: 'intro', label: 'In first 100 words', weight: 2, applies: Boolean(opening), pass: containsPhrase(opening, kw) },
    { id: 'meta', label: 'In meta description', weight: 1, applies: Boolean(article.meta_description), pass: containsPhrase(article.meta_description, kw) },
  ];
  const possible = checks.filter((c) => c.applies).reduce((n, c) => n + c.weight, 0);
  const earned = checks.filter((c) => c.applies && c.pass).reduce((n, c) => n + c.weight, 0);
  const placementPts = possible ? Math.round((6 * earned) / possible) : 0;

  const dens = keywordDensity(article.body_text, kw);
  const densPts = kw ? densityPoints(dens.density) : 0;

  const seen = new Set([kw.toLowerCase()]);
  const terms = [];
  const addTerm = (t, source) => {
    const term = collapseWhitespace(t);
    if (!term || term.length > 60) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push({ term, source, covered: containsPhrase(fullText, term) });
  };
  (secondary || []).forEach((t) => addTerm(t, 'you'));
  (relatedTerms || []).slice(0, 12).forEach((t) => addTerm(t, 'suggested'));
  const covered = terms.filter((t) => t.covered).length;
  const relatedPts = terms.length ? Math.round((6 * covered) / terms.length) : 6;

  const intentPts = Math.round(clamp(intent && intent.score, 0, 4));

  return {
    keyword: kw,
    placement: checks.map((c) => ({ id: c.id, label: c.label, applies: c.applies, pass: c.pass })),
    occurrences: dens.occurrences,
    density: dens.density,
    terms,
    intent: {
      expected: (intent && intent.expected) || '',
      note: (intent && intent.note) || '',
    },
    points: { placement: placementPts, density: densPts, related: relatedPts, intent: intentPts },
    score: placementPts + densPts + relatedPts + intentPts,
    max: 20,
  };
}
