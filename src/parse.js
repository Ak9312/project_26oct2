// Turns a fetched HTML page or pasted Markdown-ish text into one article shape:
// { source, url, title, meta_description, h1, intro, sections[], body_text,
//   word_count, h2_count }
// Depends on text.js (inlined before this file in n8n).

export function stripTags(html) {
  return collapseWhitespace(decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')));
}

function pickRegion(html) {
  const candidates = [];
  const tagRe = (tag) => new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  for (const tag of ['article', 'main']) {
    let m;
    const re = tagRe(tag);
    while ((m = re.exec(html))) candidates.push(m[1]);
    if (candidates.length) break;
  }
  if (candidates.length) {
    return candidates.sort((a, b) => b.length - a.length)[0];
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return body ? body[1] : html;
}

export function parseHtml(html, url) {
  let doc = String(html || '');
  const titleMatch = doc.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const metaMatch =
    doc.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    doc.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const h1Match = doc.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);

  doc = doc
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
  let region = pickRegion(doc)
    .replace(/<(nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');

  region = region
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (m, lvl, inner) => '\n\u0001' + lvl + '\u0002' + stripTags(inner) + '\n')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|li|div|tr|blockquote|pre|section|ul|ol|table|dd|dt|figcaption)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  region = decodeEntities(region);

  const blocks = [];
  for (const raw of region.split('\n')) {
    const line = collapseWhitespace(raw);
    if (!line) continue;
    const hm = line.match(/^\u0001(\d)\u0002(.*)$/);
    if (hm) blocks.push({ type: 'heading', level: Number(hm[1]), text: collapseWhitespace(hm[2]) });
    else blocks.push({ type: 'text', text: line.replace(/[\u0001\u0002]/g, '') });
  }

  return buildArticle(blocks, {
    source: 'url',
    url: url || '',
    title: titleMatch ? stripTags(titleMatch[1]) : '',
    meta_description: metaMatch ? collapseWhitespace(decodeEntities(metaMatch[1])) : '',
    h1: h1Match ? stripTags(h1Match[1]) : '',
  });
}

export function parsePasted(heading, content, metaDescription) {
  const blocks = [];
  for (const raw of String(content || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) blocks.push({ type: 'heading', level: hm[1].length, text: collapseWhitespace(hm[2].replace(/#+$/, '')) });
    else blocks.push({ type: 'text', text: collapseWhitespace(line.replace(/^[-*+]\s+|^\d+[.)]\s+/, '')) });
  }
  const h = collapseWhitespace(heading);
  return buildArticle(blocks, {
    source: 'paste',
    url: '',
    title: h,
    meta_description: collapseWhitespace(metaDescription),
    h1: h,
  });
}

function buildArticle(blocks, base) {
  let h1 = base.h1;
  const introLines = [];
  const sections = [];
  let current = null;
  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 1) {
      if (!h1) h1 = b.text;
      continue;
    }
    if (b.type === 'heading' && (b.level === 2 || b.level === 3)) {
      current = { level: b.level, heading: b.text, lines: [] };
      sections.push(current);
      continue;
    }
    // h4–h6 are treated as text inside the current section.
    const text = b.text;
    if (current) current.lines.push(text);
    else introLines.push(text);
  }

  const intro = introLines.join('\n');
  const outSections = sections.map((s) => {
    const text = s.lines.join('\n');
    return { level: s.level, heading: s.heading, text, word_count: tokenizeWords(text).length };
  });
  const bodyText = [intro].concat(outSections.map((s) => s.text)).filter(Boolean).join('\n');

  return {
    source: base.source,
    url: base.url,
    title: base.title || h1 || '',
    meta_description: base.meta_description || '',
    h1: h1 || base.title || '',
    intro,
    sections: outSections,
    body_text: bodyText,
    word_count: tokenizeWords(bodyText).length,
    h2_count: outSections.filter((s) => s.level === 2).length,
  };
}
