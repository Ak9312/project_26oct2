// "How was this calculated?" pop-ups for the report's Breakdown card.
// Each explainer rebuilds a parameter's score from the report data, using the
// same rules as src/scoring.js, src/readability.js and src/keywords.js, and
// shows the formula with this article's real numbers.
import { useRef } from 'react';
import { Calculator, X } from 'lucide-react';
import { fmtNum, cn } from '@/lib/utils';

const pct = (n, d) => (d ? fmtNum((100 * n) / d, 1) + '%' : '0%');
const has = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

export function explainAccuracy(A) {
  const scored = (A.sections || []).filter((s) => has(s.score));
  const avg = scored.length ? scored.reduce((n, s) => n + Number(s.score), 0) / scored.length : 0;
  const c = A.claim_counts || { total: 0, verified: 0, unverified: 0, false: 0 };
  return {
    title: 'Accuracy & relevancy',
    score: A.score,
    max: 30,
    rows: [
      {
        label: 'Relevancy',
        how: scored.length
          ? `Average of ${scored.length} heading-vs-content scores (each 0–10, judged by AI) = ${fmtNum(avg, 1)}, rounded`
          : 'No headings could be scored',
        points: A.points.relevancy,
        max: 10,
      },
      {
        label: 'Claims',
        how: c.total
          ? `${c.total} claims checked on Google: ${c.verified} verified (full credit), ${c.unverified} unverified (half), ${c.false} contradicted (none). 12 × (${c.verified} + 0.5 × ${c.unverified}) ÷ ${c.total} = ${fmtNum((12 * (c.verified + 0.5 * c.unverified)) / c.total, 1)}, rounded`
          : 'No checkable factual claims found, so full marks',
        points: A.points.claims,
        max: 12,
      },
      { label: 'Freshness', how: A.freshness_note ? `AI judgement: ${A.freshness_note}` : 'AI judgement of outdated or time-sensitive statements', points: A.points.freshness, max: 5 },
      { label: 'Title promise', how: A.title_note ? `AI judgement: ${A.title_note}` : 'AI judgement of whether the article delivers what the title promises', points: A.points.title_promise, max: 3 },
    ],
  };
}

export function explainReadability(R) {
  const n = R.sentences || 0;
  const hard = (R.hard_sentences || 0) + (R.very_hard_sentences || 0);
  const over = Math.max(0, (R.grade || 0) - (R.target_grade || 0));
  return {
    title: 'Readability',
    score: R.score,
    max: 20,
    note: 'All four checks are done by code, not AI, so they give the same result every time.',
    rows: [
      {
        label: 'Grade level',
        how: `Reading grade ${fmtNum(R.grade, 1)} vs target ${R.target_grade}${R.target_source === 'competitors' ? ' (median of the top pages)' : ''}. 8 − 2 × ${fmtNum(over, 1)} grade${over === 1 ? '' : 's'} over target, rounded`,
        points: R.points.grade,
        max: 8,
      },
      {
        label: 'Hard sentences',
        how: `${hard} of ${n} sentences are hard or very hard (${pct(hard, n)}). Up to 10% gets full marks; points fall to 0 at 40%`,
        points: R.points.hard_sentences,
        max: 6,
      },
      {
        label: 'Passive voice',
        how: `${R.passive || 0} passive sentences out of ${n} (${pct(R.passive || 0, n)}). Up to 5% = 3, 10% = 2, 15% = 1, more = 0`,
        points: R.points.passive,
        max: 3,
      },
      {
        label: 'Adverbs',
        how: `${R.adverbs || 0} adverb${R.adverbs === 1 ? "" : "s"} = ${fmtNum(R.adverbs_per_100_words, 1)} per 100 words. Up to 1 = 3, 2 = 2, 3 = 1, more = 0`,
        points: R.points.adverbs,
        max: 3,
      },
    ],
  };
}

const PLACEMENT_WEIGHT = { title: 2, h1: 1, intro: 2, meta: 1 };

export function explainKeywords(K) {
  const mp = K.max_points || {};
  const checks = (K.placement || []).filter((c) => c.applies);
  const possible = checks.reduce((n, c) => n + (PLACEMENT_WEIGHT[c.id] || 1), 0);
  const earned = checks.filter((c) => c.pass).reduce((n, c) => n + (PLACEMENT_WEIGHT[c.id] || 1), 0);
  const terms = K.terms || [];
  const covered = terms.filter((t) => t.covered).length;
  return {
    title: 'Keywords',
    score: K.score,
    max: 20,
    rows: [
      {
        label: 'Placement',
        how: possible
          ? `"${K.keyword}" found in: ${checks.map((c) => `${c.label.replace(/^In /, '')} ${c.pass ? '✓' : '✗'}`).join(', ')}. Weighted ${earned} of ${possible} → ${mp.placement || 6} × ${earned} ÷ ${possible}, rounded`
          : 'No title, heading, intro or meta description to check',
        points: K.points.placement,
        max: mp.placement || 6,
      },
      {
        label: 'Density',
        how: `Keyword used ${K.occurrences || 0} time${K.occurrences === 1 ? '' : 's'} = ${fmtNum(K.density, 1)}% of the words. 0.5–2.5% = full marks, 0.2–0.5% or 2.5–3.5% = 1, otherwise 0 (over 3.5% is stuffing)`,
        points: K.points.density,
        max: mp.density || 2,
      },
      {
        label: 'Related terms',
        how: terms.length
          ? `${covered} of ${terms.length} secondary and related terms found in the text (checked by code). ${mp.related || 8} × ${covered} ÷ ${terms.length}, rounded`
          : 'No related terms to check, so full marks',
        points: K.points.related,
        max: mp.related || 8,
      },
      {
        label: 'Search intent',
        how: K.intent && K.intent.note ? `AI judgement${K.intent.expected ? ` (searchers want: ${K.intent.expected})` : ''}: ${K.intent.note}` : 'AI judgement of whether the article matches what searchers want',
        points: K.points.intent,
        max: mp.intent || 4,
      },
    ],
  };
}

export function explainSections(S) {
  const mp = S.max_points || {};
  const topics = S.topics || [];
  const covered = topics.filter((t) => t.coverage === 'covered').length;
  const thin = topics.filter((t) => t.coverage === 'thin').length;
  const st = S.structure || {};
  const parts = [['intro of 40+ words', st.intro], ['conclusion', st.conclusion], ['FAQ', st.faq], ['3+ H2 headings', st.enough_h2]];
  const ratio = S.competitor_median_words ? S.word_count / S.competitor_median_words : null;
  return {
    title: 'Missing sections',
    score: S.score,
    max: 20,
    rows: [
      {
        label: 'Topic coverage',
        how: !S.competitor_count
          ? 'Not checked: no top-ranking pages could be read, so 0'
          : topics.length
            ? `Compared with ${S.competitor_count} top pages: ${topics.length} common subtopics, ${covered} covered, ${thin} thin, ${topics.length - covered - thin} missing. ${mp.coverage || 14} × (${covered} + 0.5 × ${thin}) ÷ ${topics.length}, rounded`
            : `Compared with ${S.competitor_count} top pages: no subtopic is shared by 3 or more of them, so full marks`,
        points: S.points.coverage ?? 0,
        max: mp.coverage || 14,
      },
      {
        label: 'Structure',
        how: parts.map(([name, ok]) => `${name} ${ok ? '✓' : '✗'}`).join(', ') + '. 1 point each',
        points: S.points.structure,
        max: mp.structure || 4,
      },
      {
        label: 'Not too thin',
        how: ratio === null
          ? 'No top-page word counts to compare with'
          : `${S.word_count} words vs top pages' median ${S.competitor_median_words} (${fmtNum(ratio * 100, 0)}%). Half or more = 2, 30–50% = 1, less = 0. Longer never earns more`,
        points: S.points.depth ?? 0,
        max: mp.depth || 2,
      },
    ],
  };
}

export function explainOriginality(P) {
  let how;
  if (!P.checked) how = `Not checked${P.error ? ': ' + P.error : ''}, so 0`;
  else if (P.method === 'phrase') how = `${P.phrases_checked} distinctive sentences searched on Google in quotes; ${P.phrases_found} found on other sites. 0 found = 10, 1 = 5, 2 or more = 0`;
  else how = `Copyscape match ${fmtNum(P.percent, 1)}%. Up to 5% = 10, 10% = 6, 15% = 2, more = 0`;
  return {
    title: 'Originality',
    score: P.score,
    max: 10,
    note: P.method === 'phrase' ? 'This catches copied sentences, not reworded ones.' : null,
    rows: [{ label: P.method === 'phrase' ? 'Exact-sentence search' : 'Copyscape', how, points: P.score, max: 10 }],
  };
}

// A small "How?" button that opens a dialog with the calculation.
export function HowCalculated({ explanation }) {
  const ref = useRef(null);
  if (!explanation) return null;
  const e = explanation;
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current && ref.current.showModal()}
        className="no-print inline-flex items-center gap-1 rounded px-1 text-xs font-normal text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`How the ${e.title} score was calculated`}
      >
        <Calculator className="size-3.5" aria-hidden="true" />How?
      </button>
      <dialog
        ref={ref}
        onClick={(ev) => { if (ev.target === ref.current) ref.current.close(); }}
        className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/40"
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{e.title}: how it was calculated</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {e.rows.map((r) => r.points ?? 0).join(' + ')} = <span className="font-semibold text-foreground">{e.score}</span> / {e.max}
            </p>
          </div>
          <button type="button" onClick={() => ref.current.close()} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <ul className="max-h-[60vh] divide-y overflow-y-auto">
          {e.rows.map((r) => (
            <li key={r.label} className="flex gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{r.label}</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{r.how}</p>
              </div>
              <div className={cn('shrink-0 font-mono text-sm tabular', (r.points ?? 0) >= r.max ? 'text-good-ink' : 'text-foreground')}>
                {r.points ?? 0}<span className="text-muted-foreground">/{r.max}</span>
              </div>
            </li>
          ))}
        </ul>
        {e.note ? <p className="border-t px-5 py-3 text-xs text-muted-foreground">{e.note}</p> : null}
      </dialog>
    </>
  );
}
