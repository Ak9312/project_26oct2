// Editor-style "how to fix" advice for each part of a report, written the way a
// content lead would brief a writer: what is wrong, an example from the
// article, and what to do. Built only from the report data, so it also works
// for audits saved before this file existed.

const q = (s, n = 160) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return '“' + (t.length > n ? t.slice(0, n - 1) + '…' : t) + '”';
};
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

// True when the report's AI step failed, including audits saved before the
// report recorded it explicitly.
export function aiFailed(report) {
  if (!report) return false;
  if (report.analysis_failed === true) return true;
  const a = report.parameters && report.parameters.accuracy;
  if (a && a.ai_checked === false) return true;
  return (report.review_reasons || []).some((r) => /AI analysis did not run/i.test(r));
}

const EMPTY_NOTE = /no content|empty|without (any )?(intro|text|content)|nothing under|heading (is )?present but/i;

export function accuracyFixes(A, failed) {
  if (failed) return {};
  const out = { Relevancy: [], Claims: [], Freshness: [], 'Title promise': [] };
  const scored = (A.sections || []).filter((s) => s.score !== null && s.score !== undefined);
  if (!scored.length) {
    out.Relevancy.push({ text: 'The article has no H2/H3 subheadings, so there was nothing to match. Break it into 4–6 sections with clear headings, e.g. “What is …”, “How to …”, “Common mistakes”, “FAQs”.' });
  }
  scored
    .filter((s) => s.score < 7)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .forEach((s) => {
      out.Relevancy.push(EMPTY_NOTE.test(s.note || '')
        ? { text: `Add 2–3 sentences under ${q(s.heading, 80)} that deliver what the heading promises. Right now the heading has no text of its own.`, score: s.score }
        : { text: `Rewrite the text under ${q(s.heading, 80)} so it answers the heading directly.${s.note ? ' Editor’s note: ' + s.note + '.' : ''}`, score: s.score });
    });
  (A.claims || []).filter((c) => c.status === 'false').forEach((c) => {
    out.Claims.push({ text: `Correct this claim: ${q(c.claim)}.${c.evidence ? ' Search results say: ' + c.evidence + '.' : ''}`, link: c.source_url, tone: 'bad' });
  });
  (A.claims || []).filter((c) => c.status === 'unverified').slice(0, 4).forEach((c) => {
    out.Claims.push({ text: `Add a source link for ${q(c.claim)}, or soften it if you can’t back it up.${c.evidence ? ' What search found: ' + c.evidence + '.' : ''}` });
  });
  if (A.points.freshness < 5) {
    out.Freshness.push({ text: `${A.freshness_note ? 'Editor’s note: ' + A.freshness_note + '. ' : ''}Add an “Updated on <month year>” line near the top, and replace words like “latest”, “this year” or “currently” with exact dates.` });
  }
  if (A.points.title_promise < 3) {
    out['Title promise'].push({ text: `${A.title_note ? 'Editor’s note: ' + A.title_note + '. ' : ''}Either deliver everything the title promises, or change the title to match what the article really covers.` });
  }
  return out;
}

export function readabilityFixes(R) {
  const out = { 'Grade level': [], 'Hard sentences': [], 'Passive voice': [], Adverbs: [] };
  const hardest = R.hardest_sentence && R.hardest_sentence.text;
  if (R.points.grade < 8) {
    out['Grade level'].push({ text: `It reads at grade ${R.grade} against a target of ${R.target_grade}. Use shorter sentences and everyday words (“use” not “utilise”, “help” not “facilitate”).` });
  }
  if (R.points.hard_sentences < 6) {
    const hard = (R.hard_sentences || 0) + (R.very_hard_sentences || 0);
    const toFix = Math.max(1, Math.ceil(hard - 0.1 * (R.sentences || 0)));
    out['Hard sentences'].push({ text: `Split or simplify about ${plural(toFix, 'long sentence')} (aim for under 10% hard sentences, roughly 20 words max each).` });
    if (hardest) out['Hard sentences'].push({ text: `Start with the hardest one (grade ${R.hardest_sentence.grade}): ${q(hardest, 220)}` });
  }
  if (R.points.passive < 3) {
    out['Passive voice'].push({ text: `Rewrite ${plural(R.passive || 0, 'passive sentence')} in active voice. Example: “The bin should be turned weekly” → “Turn the bin weekly”.` });
  }
  if (R.points.adverbs < 3) {
    out.Adverbs.push({ text: 'Cut filler adverbs like “very”, “really”, “extremely”, “quickly”. Use a stronger verb instead (“ran quickly” → “sprinted”).' });
  }
  if ((R.complex_phrases || []).length) {
    out['Grade level'].push({ text: 'Simpler wording for: ' + R.complex_phrases.slice(0, 5).map((p) => (typeof p === 'string' ? q(p, 40) : q(p.phrase || p.text, 40) + (p.suggestion ? ' → ' + p.suggestion : ''))).join(', ') + '.' });
  }
  return out;
}

export function keywordFixes(K, words) {
  const out = { Placement: [], Density: [], 'Related terms': [], 'Search intent': [] };
  const kw = q(K.keyword, 60);
  const where = { title: 'the page title', h1: 'the main heading (H1)', intro: 'the first 100 words, ideally the opening sentence', meta: 'the meta description' };
  (K.placement || []).filter((c) => c.applies && !c.pass).forEach((c) => {
    out.Placement.push({ text: `Put ${kw} in ${where[c.id] || c.label.toLowerCase()}.` });
  });
  const mp = K.max_points || {};
  if (K.points.density < (mp.density || 2)) {
    if ((K.density || 0) < 0.5) {
      const need = Math.max(1, Math.ceil((0.005 * (words || 0)) - (K.occurrences || 0)));
      out.Density.push({ text: `${kw} appears ${plural(K.occurrences || 0, 'time')} (${K.density}%). Work it in about ${plural(need, 'more time')} where it reads naturally, e.g. in a subheading and the conclusion.` });
    } else {
      out.Density.push({ text: `${kw} is used ${plural(K.occurrences || 0, 'time')} (${K.density}%), which reads as stuffing. Replace some uses with pronouns or synonyms to get under 2.5%.` });
    }
  }
  const missing = (K.terms || []).filter((t) => !t.covered).map((t) => t.term);
  if (missing.length) {
    out['Related terms'].push({ text: `Cover these terms, a sentence or short section each: ${missing.slice(0, 8).map((t) => q(t, 40)).join(', ')}.` });
  }
  if (K.points.intent < (mp.intent || 4)) {
    out['Search intent'].push({ text: `${K.intent && K.intent.expected ? 'People searching this want ' + K.intent.expected + ' content. ' : ''}${K.intent && K.intent.note ? 'Editor’s note: ' + K.intent.note + '.' : 'Make the opening answer what the searcher came for.'}` });
  }
  return out;
}

export function sectionFixes(S) {
  const out = { 'Topic coverage': [], Structure: [], 'Not too thin': [] };
  if (!S.competitor_count) {
    out['Topic coverage'].push({ text: 'Top-ranking pages couldn’t be read, so coverage wasn’t checked. Run the audit again; if it repeats, compare your headings with the top 5 Google results by hand.' });
  }
  (S.topics || []).filter((t) => t.coverage === 'missing').slice(0, 5).forEach((t) => {
    out['Topic coverage'].push({ text: `Add a section on ${q(t.subtopic, 80)}${t.found_in ? `: ${t.found_in} of the top pages cover it` : ''}.` });
  });
  (S.topics || []).filter((t) => t.coverage === 'thin').slice(0, 3).forEach((t) => {
    out['Topic coverage'].push({ text: `Expand ${q(t.subtopic, 80)}${t.note ? ' (' + t.note.replace(/\.$/, '') + ')' : ''}; give it a proper paragraph with an example.` });
  });
  const st = S.structure || {};
  if (st.intro === false) out.Structure.push({ text: 'Open with an introduction of 40+ words that tells the reader what they’ll learn.' });
  if (st.conclusion === false) out.Structure.push({ text: 'End with a short conclusion or “Key takeaways”.' });
  if (st.faq === false) out.Structure.push({ text: 'Add an FAQ with 3–5 questions people really search; Google’s “People also ask” box is a good source.' });
  if (st.enough_h2 === false) out.Structure.push({ text: 'Use at least 3 H2 subheadings so readers can scan.' });
  if ((S.points.depth ?? 2) < 2 && S.competitor_median_words) {
    out['Not too thin'].push({ text: `The article is ${S.word_count} words; top pages are around ${S.competitor_median_words}. Add depth (examples, steps, data, the missing topics above) to reach at least ${Math.round(S.competitor_median_words / 2)} words.` });
  }
  return out;
}

export function originalityFixes(P) {
  const key = P.method === 'phrase' ? 'Exact-sentence search' : 'Copyscape';
  const out = { [key]: [] };
  if (!P.checked) {
    out[key].push({ text: 'The originality check didn’t run, so this is 0, not a verdict on the article. Run the audit again.' });
    return out;
  }
  (P.sources || []).slice(0, 3).forEach((s) => {
    out[key].push({
      text: s.phrase
        ? `This sentence appears word-for-word on another site: ${q(s.phrase, 200)}. Rewrite it in your own words.`
        : `${s.percent != null ? s.percent + '% ' : 'Text '}matches ${s.title || s.url}. Rewrite the matching passages.`,
      link: s.url,
      tone: 'bad',
    });
  });
  return out;
}

// The biggest point gains first: one line per row that lost points.
export function topFixes(explanations, limit = 3) {
  const all = [];
  explanations.forEach((e) => {
    if (!e || e.notChecked) return;
    e.rows.forEach((r) => {
      const lost = r.max - (r.points ?? 0);
      if (lost > 0 && r.fixes && r.fixes.length) all.push({ param: e.title, label: r.label, lost, fix: r.fixes[0] });
    });
  });
  return all.sort((a, b) => b.lost - a.lost).slice(0, limit);
}
