// Validates the request body sent by the web app (via the Vercel API) and
// turns it into the shape the rest of the workflow uses.
// Depends on text.js.

export const MARKETS = {
  'in-en': { gl: 'in', hl: 'en', label: 'India · English' },
  'us-en': { gl: 'us', hl: 'en', label: 'United States · English' },
  'gb-en': { gl: 'uk', hl: 'en', label: 'United Kingdom · English' },
  'au-en': { gl: 'au', hl: 'en', label: 'Australia · English' },
};

export function makeAuditId(now) {
  const d = now instanceof Date ? now : new Date();
  const stamp = d.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const rand = Math.random().toString(36).slice(2, 8);
  return 'aud_' + stamp + '_' + rand;
}

export function normalizeInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = [];
  const url = collapseWhitespace(b.url);
  const heading = collapseWhitespace(b.heading);
  const content = String(b.content || '').trim();
  const keyword = collapseWhitespace(b.keyword);

  if (url) {
    if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url)) errors.push('URL must start with http:// or https://');
  } else if (!content) {
    errors.push('Give either a URL or the article content');
  }
  if (!url && content && !heading) errors.push('Pasted content needs a heading');
  if (content.length > 100000) errors.push('Content is over 100,000 characters');
  if (!keyword) errors.push('Primary keyword is required');

  const secondary = (Array.isArray(b.secondary) ? b.secondary : String(b.secondary || '').split(','))
    .map((s) => collapseWhitespace(s))
    .filter(Boolean)
    .slice(0, 15);

  const grade = Number(b.target_grade);
  const market = MARKETS[b.market] || MARKETS['in-en'];

  return {
    errors,
    input: {
      url,
      heading,
      content,
      meta_description: collapseWhitespace(b.meta_description),
      keyword,
      secondary,
      target_grade: Number.isFinite(grade) && grade >= 4 && grade <= 16 ? grade : 9,
      market: b.market && MARKETS[b.market] ? b.market : 'in-en',
      gl: market.gl,
      hl: market.hl,
      market_label: market.label,
    },
  };
}
