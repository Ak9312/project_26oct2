// Free plagiarism check: searches Google (through SerpAPI) for a few exact
// sentences from the article. A sentence counts as found when another site's
// result snippet contains a long run of the same words. This is a sample, not
// a full scan: it catches copied passages, not light rewording.
// Depends on text.js.

function words(s) {
  return tokenizeWords(String(s || '').toLowerCase());
}

function hostOfUrl(u) {
  const m = String(u || '').match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

// Picks up to n distinctive sentences spread across the article.
export function pickPhrases(article, n) {
  const count = Math.max(0, Math.min(6, Number(n) || 0));
  if (!count) return [];
  const sentences = splitSentences(article.body_text)
    .map((s) => ({ s, w: tokenizeWords(s) }))
    .filter((x) => x.w.length >= 10 && x.w.length <= 60)
    // skip list-like or numeric-heavy lines that are common everywhere
    .filter((x) => x.w.filter((t) => /^\d+$/.test(t)).length <= 3);
  if (!sentences.length) return [];
  const picks = [];
  const step = sentences.length / count;
  for (let i = 0; i < count && i * step < sentences.length; i++) {
    // Middle of each slice, so the picks are spread through the article.
    const best = sentences.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1))
      .sort((a, b) => b.w.length - a.w.length)[0];
    if (best) picks.push(best.w.slice(0, 18).join(' '));
  }
  return Array.from(new Set(picks));
}

function longestSharedRun(a, b) {
  // Longest run of consecutive words of a that appears in b (both word lists).
  const bs = ' ' + b.join(' ') + ' ';
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = a.length; j > i + best; j--) {
      if (bs.indexOf(' ' + a.slice(i, j).join(' ') + ' ') >= 0) { best = j - i; break; }
    }
  }
  return best;
}

// serp: SerpAPI JSON for the quoted phrase. Returns matching pages.
export function phraseMatches(serp, phrase, ownUrl) {
  const own = hostOfUrl(ownUrl);
  const pw = words(phrase);
  const need = Math.min(8, Math.max(6, Math.floor(pw.length * 0.5)));
  const rows = serp && Array.isArray(serp.organic_results) ? serp.organic_results : [];
  return rows
    .filter((r) => r && typeof r.link === 'string' && (!own || hostOfUrl(r.link) !== own))
    .filter((r) => longestSharedRun(pw, words(r.snippet)) >= need)
    .slice(0, 3)
    .map((r) => ({ url: r.link, title: collapseWhitespace(r.title), phrase }));
}

export function summarizePhraseCheck(results, phrases) {
  const done = results.filter((r) => !r.error);
  if (!done.length) {
    const err = (results.find((r) => r.error) || {}).error || 'no sentences long enough to check';
    return { checked: false, method: 'phrase', percent: null, sources: [], error: 'Google phrase check did not run (' + String(err).slice(0, 120) + ')' };
  }
  const found = done.filter((r) => r.matches.length);
  const sources = [];
  found.forEach((r) => r.matches.forEach((m) => { if (sources.length < 5 && !sources.some((s) => s.url === m.url)) sources.push({ url: m.url, title: m.title, phrase: m.phrase, percent: null, words: null }); }));
  return {
    checked: true,
    method: 'phrase',
    phrases_checked: done.length,
    phrases_found: found.length,
    percent: Math.round((found.length / done.length) * 100),
    sources,
    error: '',
    phrases: phrases.slice(0, done.length),
  };
}
