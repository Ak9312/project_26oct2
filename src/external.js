// Parsers for SerpAPI, competitor pages and Copyscape responses.
// Depends on text.js and parse.js.

function hostOf(u) {
  const m = String(u || '').match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

// SerpAPI Google results -> list of {url, title, snippet}
export function serpOrganic(serp, limit) {
  const rows = (serp && Array.isArray(serp.organic_results)) ? serp.organic_results : [];
  return rows
    .filter((r) => r && typeof r.link === 'string' && /^https?:\/\//.test(r.link))
    .slice(0, limit || 10)
    .map((r) => ({
      url: r.link,
      title: collapseWhitespace(r.title),
      snippet: collapseWhitespace(r.snippet),
    }));
}

// Pick competitor URLs, skipping the audited article's own site and
// file types we cannot parse.
export function competitorUrls(serp, ownUrl, limit) {
  const own = hostOf(ownUrl);
  return serpOrganic(serp, 10)
    .filter((r) => !own || hostOf(r.url) !== own)
    .filter((r) => !/\.(pdf|docx?|pptx?|xlsx?)(\?|$)/i.test(r.url))
    .slice(0, limit || 8);
}

export function competitorOutline(html, url, fallbackTitle) {
  if (typeof html !== 'string' || html.length < 200) {
    return { url, title: fallbackTitle || '', word_count: 0, headings: [] };
  }
  const a = parseHtml(html, url);
  return {
    url,
    title: a.title || fallbackTitle || '',
    word_count: a.word_count,
    grade: a.word_count >= 200 ? analyzeReadability(a.body_text).grade : null,
    headings: a.sections.map((s) => s.heading).filter((h) => h && h.length <= 120).slice(0, 40),
  };
}

// Copyscape text search (o=csearch, c>=3, f=json) -> plagiarism result.
export function parseCopyscape(resp) {
  if (!resp || typeof resp !== 'object') {
    return { checked: false, percent: null, sources: [], error: 'No response from Copyscape' };
  }
  if (resp.error) {
    return { checked: false, percent: null, sources: [], error: String(resp.error).slice(0, 200) };
  }
  const count = Number(resp.count) || 0;
  const results = Array.isArray(resp.result) ? resp.result : [];
  let percent = Number(resp.allpercentmatched);
  if (!Number.isFinite(percent)) percent = count === 0 ? 0 : NaN;
  if (!Number.isFinite(percent)) {
    return { checked: false, percent: null, sources: [], error: 'Copyscape did not return allpercentmatched (needs c=3 or more)' };
  }
  return {
    checked: true,
    percent: round1(percent),
    words_checked: Number(resp.querywords) || null,
    sources: results.slice(0, 5).map((r) => ({
      url: r.url,
      title: collapseWhitespace(r.title),
      percent: Number.isFinite(Number(r.percentmatched)) ? Number(r.percentmatched) : null,
      words: Number(r.minwordsmatched) || null,
    })),
    error: '',
  };
}

// Table rows (header row first) -> objects keyed by the header row.
export function rowsToObjects(values) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    header.forEach((h, j) => { o[h] = r[j] !== undefined ? r[j] : ''; });
    return o;
  });
}
