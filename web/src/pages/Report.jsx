import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, AlertTriangle, CheckCircle2, XCircle, Check, X, Minus, Printer, Flag, Loader2, Circle, RotateCw, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, Tabs, TabsList, TabsTrigger, TabsContent, Input, Label, Table, THead, TBody, TR, TH, TD, Skeleton, Progress } from '@/components/ui';
import { ErrorNote, useApp } from '@/components/layout';
import { ScoreGauge, ScoreRadar, ParamBar } from '@/components/charts';
import { StatusBadge } from '@/components/status';
import { data } from '@/lib/api';
import { fmtDate, fmtNum, cn, band, BAND_TEXT } from '@/lib/utils';

const STEPS = [
  { at: 0, label: 'Reading the article and scoring readability' },
  { at: 8, label: 'AI review of headings, claims and intent' },
  { at: 35, label: 'Fact-checking claims against Google results' },
  { at: 70, label: 'Comparing with the top-ranking pages' },
  { at: 110, label: 'Checking sample sentences for copies' },
  { at: 140, label: 'Scoring and saving the report' },
];
const MAX_WAIT_MS = 6 * 60 * 1000;

function Running({ id, startedAt }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => { const t = setInterval(() => setSecs(Math.round((Date.now() - startedAt) / 1000)), 1000); return () => clearInterval(t); }, [startedAt]);
  const current = STEPS.reduce((acc, s, i) => (secs >= s.at ? i : acc), 0);
  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-accent text-accent-foreground"><Loader2 className="size-5 animate-spin" /></span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight" aria-live="polite">Auditing your article…</h1>
            <p className="text-sm text-muted-foreground">Usually 1–3 minutes. This page updates by itself.</p>
          </div>
          <span className="ml-auto font-mono text-sm text-muted-foreground tabular">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
        </div>
        <Progress className="mt-6" value={Math.min(95, (secs / 180) * 100)} />
        <ol className="mt-6 space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.label} className={cn('flex items-center gap-3 text-sm', i > current && 'text-muted-foreground')}>
              {i < current ? <CheckCircle2 className="size-4 text-good" /> : i === current ? <Loader2 className="size-4 animate-spin text-primary" /> : <Circle className="size-4" />}
              {s.label}
            </li>
          ))}
        </ol>
        <p className="mt-6 text-xs text-muted-foreground">Audit ID <span className="font-mono">{id}</span></p>
      </CardContent>
    </Card>
  );
}

function Failed({ rep }) {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="p-6 sm:p-8">
        <span className="grid size-10 place-items-center rounded-full bg-bad-soft text-bad-ink"><XCircle className="size-5" /></span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">The audit couldn't run</h1>
        <p className="mt-1 text-sm text-muted-foreground">{fmtDate(rep.created_at)} · <span className="font-mono">{rep.audit_id}</span></p>
        <div className="mt-5 rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad-ink">{rep.error}</div>
        <Button asChild className="mt-6"><Link to="/new"><RotateCw />Try again</Link></Button>
      </CardContent>
    </Card>
  );
}

const ICON = {
  yes: <Check className="size-4 text-good" strokeWidth={2.5} aria-label="Yes" />,
  no: <X className="size-4 text-bad" strokeWidth={2.5} aria-label="No" />,
  na: <Minus className="size-4 text-muted-foreground" aria-label="Not given" />,
};

function SubScores({ items }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, v, max]) => (
        <div key={label} className="rounded-lg bg-muted/60 p-3">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular"><span className={BAND_TEXT[band(v, max)]}>{v === null ? '—' : v}</span><span className="text-sm font-normal text-muted-foreground">/{max}</span></div>
        </div>
      ))}
    </div>
  );
}

function ClaimBadge({ status }) {
  if (status === 'verified') return <Badge variant="good"><CheckCircle2 />Verified</Badge>;
  if (status === 'false') return <Badge variant="solidBad"><XCircle />Contradicted</Badge>;
  return <Badge variant="muted"><Minus />Unverified</Badge>;
}

function AccuracyTab({ A }) {
  return (
    <div className="space-y-6">
      <SubScores items={[['Relevancy', A.points.relevancy, 10], ['Claims', A.points.claims, 12], ['Freshness', A.points.freshness, 5], ['Title promise', A.points.title_promise, 3]]} />
      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold">Heading ↔ content match</h3>
          {A.sections.length ? (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <THead><TR className="hover:bg-transparent"><TH>Heading</TH><TH className="w-16">Score</TH><TH>Note</TH></TR></THead>
                <TBody>
                  {A.sections.map((s, i) => (
                    <TR key={i} className={cn(s.score !== null && s.score <= 5 && 'bg-bad-soft/50')}>
                      <TD className="font-medium">{s.heading}</TD>
                      <TD className={cn('font-mono tabular font-semibold', BAND_TEXT[band(s.score, 10)])}>{s.score ?? '—'}</TD>
                      <TD className="text-muted-foreground">{s.note}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No H2/H3 headings were found.</p>}
          <dl className="mt-4 grid gap-2 text-sm">
            <div><dt className="inline font-medium">Title promise: </dt><dd className="inline text-muted-foreground">{A.title_note || '—'}</dd></div>
            <div><dt className="inline font-medium">Freshness: </dt><dd className="inline text-muted-foreground">{A.freshness_note || '—'}</dd></div>
          </dl>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Claims checked against search results</h3>
          {A.claims.length ? (
            <ul className="space-y-2.5">
              {A.claims.map((c, i) => (
                <li key={i} className={cn('rounded-lg border p-3.5', c.status === 'false' && 'border-bad/30 bg-bad-soft/50')}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm">{c.claim}</p>
                    <ClaimBadge status={c.status} />
                  </div>
                  {c.evidence || c.source_url ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {c.evidence}{c.evidence && c.source_url ? ' · ' : ''}
                      {c.source_url ? <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Source<ExternalLink className="size-3" /></a> : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No checkable factual claims were found.</p>}
          <p className="mt-3 flex gap-2 text-xs text-muted-foreground"><Info className="mt-px size-3.5 shrink-0" />A verdict only counts when it's backed by a search result. Otherwise the claim stays unverified (half credit).</p>
        </div>
      </div>
    </div>
  );
}

function ReadabilityTab({ R }) {
  return (
    <div className="space-y-6">
      <SubScores items={[['Grade level', R.points.grade, 8], ['Hard sentences', R.points.hard_sentences, 6], ['Passive voice', R.points.passive, 3], ['Adverbs', R.points.adverbs, 3]]} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Reading grade', fmtNum(R.grade, 1), 'target ' + R.target_grade], ['Hard sentences', (R.hard_sentences + R.very_hard_sentences) + ' / ' + R.sentences, R.very_hard_sentences + ' very hard'], ['Passive voice', R.passive, 'uses'], ['Adverbs', R.adverbs, fmtNum(R.adverbs_per_100_words, 1) + ' per 100 words']].map(([k, v, s]) => (
          <div key={k} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="mt-1 font-mono text-xl font-semibold tabular">{v}</div><div className="text-xs text-muted-foreground">{s}</div></div>
        ))}
      </div>
      {R.hardest_sentence ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Hardest sentence <span className="font-normal text-muted-foreground">(grade {fmtNum(R.hardest_sentence.grade, 1)})</span></h3>
          <blockquote className="rounded-lg border-l-4 border-bad bg-bad-soft/60 px-4 py-3 text-sm">{R.hardest_sentence.text}</blockquote>
        </div>
      ) : null}
      {R.complex_phrases.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Simpler words</h3>
          <div className="flex flex-wrap gap-2">{R.complex_phrases.map((c) => <Badge key={c.phrase} variant="outline">{c.phrase} → {c.suggestion}{c.count > 1 ? ' ×' + c.count : ''}</Badge>)}</div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Hemingway-style analysis using the Automated Readability Index.</p>
    </div>
  );
}

function KeywordsTab({ K }) {
  return (
    <div className="space-y-6">
      <SubScores items={[['Placement', K.points.placement, 6], ['Density', K.points.density, 4], ['Related terms', K.points.related, 6], ['Intent', K.points.intent, 4]]} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold">“{K.keyword}” placement</h3>
          <ul className="divide-y rounded-lg border">
            {K.placement.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className={!c.applies ? 'text-muted-foreground' : ''}>{c.label}{!c.applies ? ' (none given)' : ''}</span>
                {!c.applies ? ICON.na : c.pass ? ICON.yes : ICON.no}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">Appears <b>{K.occurrences}</b> time{K.occurrences === 1 ? '' : 's'} · density <b className="font-mono">{fmtNum(K.density, 1)}%</b> <span className="text-muted-foreground">(target 0.5–2.5%)</span></p>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Related terms</h3>
          {K.terms.length ? <div className="flex flex-wrap gap-2">{K.terms.map((t) => <Badge key={t.term} variant={t.covered ? 'good' : 'bad'}>{t.covered ? <Check /> : <X />}{t.term}</Badge>)}</div> : <p className="text-sm text-muted-foreground">None suggested.</p>}
          <p className="mt-2 text-xs text-muted-foreground">Coverage is checked in the text itself, not taken from the AI.</p>
          {K.intent.expected || K.intent.note ? <p className="mt-4 text-sm"><span className="font-medium">Search intent: </span><Badge variant="outline" className="capitalize">{K.intent.expected || 'unknown'}</Badge> <span className="text-muted-foreground">{K.intent.note}</span></p> : null}
        </div>
      </div>
    </div>
  );
}

function SectionsTab({ S }) {
  const tone = { covered: 'good', thin: 'warn', missing: 'bad' };
  return (
    <div className="space-y-6">
      <SubScores items={[['Topic coverage', S.points.coverage, 12], ['Structure', S.points.structure, 4], ['Depth', S.points.depth, 4]]} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <h3 className="mb-3 text-sm font-semibold">Subtopics on the top-ranking pages</h3>
          {S.competitor_count ? (S.topics.length ? (
            <ul className="divide-y rounded-lg border">
              {S.topics.map((t) => (
                <li key={t.subtopic} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-medium">{t.subtopic}</span>
                  <span className="flex items-center gap-3"><span className="text-xs text-muted-foreground">on {t.found_in} of {S.competitor_count} pages</span><Badge variant={tone[t.coverage]} className="capitalize">{t.coverage}</Badge></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No subtopic appeared often enough across the top pages to count.</p>) : <p className="text-sm text-muted-foreground">Top-ranking pages couldn't be fetched, so coverage wasn't checked.</p>}
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Structure</h3>
            <ul className="space-y-2 text-sm">
              {[['intro', 'Intro of 40+ words'], ['conclusion', 'Conclusion or summary'], ['faq', 'FAQ section'], ['enough_h2', '3 or more H2 sections']].map(([k, l]) => (
                <li key={k} className="flex items-center justify-between">{l}{S.structure[k] ? ICON.yes : ICON.no}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border p-4 text-sm">
            <div className="text-xs text-muted-foreground">Length</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular">{S.word_count.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">words</span></div>
            {S.competitor_median_words ? <div className="text-xs text-muted-foreground">Top pages median: {S.competitor_median_words.toLocaleString()}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlagiarismTab({ P }) {
  if (!P.checked) return <div className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad-ink">The plagiarism check didn't run{P.error ? ': ' + P.error : ''}. The article was sent to review.</div>;
  if (P.method === 'phrase') {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={cn('font-mono text-4xl font-semibold tabular', P.phrases_found ? 'text-bad-ink' : 'text-good-ink')}>{P.phrases_found}/{P.phrases_checked}</span>
          <span className="text-muted-foreground">sample sentences found word-for-word on other sites</span>
        </div>
        {P.sources.length ? (
          <ul className="space-y-2.5">{P.sources.map((s) => (
            <li key={s.url} className="rounded-lg border p-3.5 text-sm">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">{s.title || s.url}<ExternalLink className="size-3" /></a>
              <p className="mt-1 text-xs text-muted-foreground">“{s.phrase}…”</p>
            </li>))}
          </ul>
        ) : <div className="flex items-center gap-2 rounded-lg border border-good/30 bg-good-soft px-4 py-3 text-sm text-good-ink"><CheckCircle2 className="size-4" />No copies of the sampled sentences were found.</div>}
        <p className="text-xs text-muted-foreground">Free check: sentences from the article searched on Google in quotes. Catches copied passages, not reworded ones.</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3"><span className="font-mono text-4xl font-semibold tabular">{fmtNum(P.percent, 1)}%</span><span className="text-muted-foreground">matched text (Copyscape)</span></div>
      <Progress value={Math.min(100, (P.percent / 20) * 100)} indicatorClassName={P.percent > 15 ? 'bg-bad' : P.percent > 5 ? 'bg-warn' : 'bg-good'} />
      <ul className="divide-y rounded-lg border">{P.sources.length ? P.sources.map((s) => (
        <li key={s.url} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><a href={s.url} target="_blank" rel="noopener noreferrer" className="line-clamp-1 text-primary hover:underline">{s.title || s.url}</a><span className="font-mono text-muted-foreground">{s.percent !== null ? s.percent + '%' : (s.words || '?') + ' words'}</span></li>
      )) : <li className="px-4 py-2.5 text-sm text-muted-foreground">No matching pages found.</li>}</ul>
    </div>
  );
}

function MyScores({ id, initial }) {
  const fields = [['my_accuracy', 'Accuracy', 30], ['my_readability', 'Readability', 20], ['my_keywords', 'Keywords', 20], ['my_sections', 'Sections', 20], ['my_plagiarism', 'Originality', 10]];
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map(([k]) => [k, initial && initial[k] !== undefined && initial[k] !== null ? String(initial[k]) : ''])));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const all = fields.every(([k]) => vals[k] !== '');
  const total = all ? fields.reduce((s, [k]) => s + Number(vals[k]), 0) : null;
  async function save(e) {
    e.preventDefault();
    for (const [k, l, m] of fields) {
      const n = Number(vals[k]);
      if (vals[k] === '' || !Number.isInteger(n) || n < 0 || n > m) { setErr(`Enter a whole number from 0 to ${m} for ${l}.`); return; }
    }
    setErr(''); setBusy(true);
    try {
      const body = { audit_id: id };
      fields.forEach(([k]) => { body[k] = Number(vals[k]); });
      const r = await data('validation_save', body);
      toast.success(`Your scores are saved (total ${r.my_total}/100)`);
    } catch (e2) { if (e2.status !== 401) setErr(e2.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      <p className="text-sm text-muted-foreground">Score this article yourself with the same rubric, ideally before reading the AI's numbers. Your scores feed the Validation page.</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {fields.map(([k, l, m]) => (
          <div key={k} className="space-y-2">
            <Label htmlFor={k}>{l} <span className="font-normal text-muted-foreground">/{m}</span></Label>
            <Input id={k} type="number" inputMode="numeric" min={0} max={m} step={1} value={vals[k]} onChange={(e) => { setErr(''); setVals((v) => ({ ...v, [k]: e.target.value })); }} className="font-mono" />
          </div>
        ))}
      </div>
      {err ? <p className="text-sm text-bad-ink" role="alert">{err}</p> : null}
      <div className="flex items-center gap-4"><Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}Save my scores</Button>{total !== null ? <span className="text-sm text-muted-foreground">Your total: <b className="font-mono text-foreground">{total}</b>/100</span> : null}</div>
    </form>
  );
}

export default function ReportPage() {
  const { id } = useParams();
  const [state, setState] = useState({ kind: 'loading' });
  const startedAt = useRef(Date.now());
  const { refreshPending } = useApp();

  useEffect(() => {
    let alive = true;
    let timer;
    startedAt.current = Date.now();
    async function poll() {
      try {
        const r = await data('get', { audit_id: id });
        if (!alive) return;
        if (r.audit && r.report) { setState({ kind: 'done', r }); refreshPending(); return; }
        if (Date.now() - startedAt.current > MAX_WAIT_MS) { setState({ kind: 'timeout' }); return; }
        setState({ kind: 'running' });
        timer = setTimeout(poll, 8000);
      } catch (e) { if (alive) setState({ kind: 'error', error: e }); }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);

  const back = <Link to="/" className="no-print mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All audits</Link>;
  if (state.kind === 'loading') return <>{back}<Skeleton className="h-72 rounded-xl" /></>;
  if (state.kind === 'error') return <>{back}<ErrorNote error={state.error} /></>;
  if (state.kind === 'running') return <>{back}<Running id={id} startedAt={startedAt.current} /></>;
  if (state.kind === 'timeout') return (<>{back}<Card className="mx-auto max-w-2xl"><CardContent className="p-8"><h1 className="text-xl font-semibold">No result after 6 minutes</h1><p className="mt-2 text-sm text-muted-foreground">The audit stopped without saving a result. Check the project's Logs in Vercel, or run it again. For URLs, try pasting the text instead.</p><div className="mt-5 flex gap-2"><Button asChild><Link to="/new">New audit</Link></Button><Button variant="outline" onClick={() => location.reload()}>Check again</Button></div></CardContent></Card></>);

  const rep = state.r.report;
  if (!rep.parameters) return <>{back}<Failed rep={rep} /></>;
  const p = rep.parameters;
  const { accuracy: A, readability: R, keywords: K, sections: S, plagiarism: P } = p;
  const failed = rep.status === 'error';
  const needs = rep.status === 'needs_review' || failed;
  const scores = { accuracy: A.score, readability: R.score, keywords: K.score, sections: S.score, plagiarism: P.score };
  const missing = S.topics.filter((t) => t.coverage !== 'covered').length;

  return (
    <>
      {back}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={rep.status} />
            <span>{fmtDate(rep.created_at)}</span><span aria-hidden="true">·</span>
            <span>{rep.article.word_count.toLocaleString()} words</span><span aria-hidden="true">·</span>
            <span>{rep.article.source === 'url' ? 'From URL' : 'Pasted text'}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{rep.article.title || rep.input.keyword}</h1>
          {rep.article.url ? <a href={rep.article.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex max-w-full items-center gap-1 break-all text-sm text-primary hover:underline">{rep.article.url}<ExternalLink className="size-3.5 shrink-0" /></a> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">Keyword: {rep.input.keyword}</Badge>
            <Badge variant="outline">{rep.input.market_label}</Badge>
            <Badge variant="outline">Target grade {rep.input.target_grade}</Badge>
          </div>
        </div>
        <div className="no-print flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => window.print()}><Printer />Print / PDF</Button>
          {needs ? <Button asChild><Link to="/review"><Flag />Review queue</Link></Button> : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-4">
          <CardContent className="flex flex-col items-center gap-5 p-6">
            <ScoreGauge score={rep.total} passMark={rep.pass_mark} />
            <div className={cn('w-full rounded-lg border px-4 py-3 text-sm', needs ? 'border-warn/30 bg-warn-soft text-warn-ink' : 'border-good/30 bg-good-soft text-good-ink')}>
              <div className="flex items-center gap-2 font-semibold">
                {needs ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
                {failed ? 'Incomplete: sent to review' : needs ? 'Sent to human review' : 'Passed'}
              </div>
              {needs ? <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">{rep.review_reasons.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="mt-1 text-[13px]">No hard flags and the total meets the pass mark.</p>}
            </div>
            <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 text-sm">
              <div><dt className="text-xs text-muted-foreground">Claims checked</dt><dd className="font-mono font-medium tabular">{A.claim_counts.total}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Top pages compared</dt><dd className="font-mono font-medium tabular">{S.competitor_count}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Reading grade</dt><dd className="font-mono font-medium tabular">{fmtNum(R.grade, 1)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">AI model</dt><dd className="truncate font-medium" title={rep.model}>{(rep.model || '—').replace(/ \(sample\)$/, '').replace(/^openai\//, '')}</dd></div>
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader><CardTitle>Score shape</CardTitle><CardDescription>Each parameter as a share of its maximum.</CardDescription></CardHeader>
          <CardContent><ScoreRadar scores={scores} height={260} /></CardContent>
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader><CardTitle>Breakdown</CardTitle><CardDescription>Points per parameter.</CardDescription></CardHeader>
          <CardContent className="space-y-2.5">
            <ParamBar label="Accuracy & relevancy" score={A.score} max={30} note={A.claim_counts.false ? `${A.claim_counts.false} contradicted claim${A.claim_counts.false > 1 ? 's' : ''}` : `${A.claim_counts.verified} of ${A.claim_counts.total} claims verified`} />
            <ParamBar label="Readability" score={R.score} max={20} note={`Grade ${fmtNum(R.grade, 1)} · target ${R.target_grade}`} />
            <ParamBar label="Keywords" score={K.score} max={20} note={`Density ${fmtNum(K.density, 1)}%`} />
            <ParamBar label="Missing sections" score={S.score} max={20} note={S.competitor_count ? `${missing} subtopic${missing === 1 ? '' : 's'} missing or thin` : 'Top pages not compared'} />
            <ParamBar label="Originality" score={P.score} max={10} note={!P.checked ? 'Not checked' : P.method === 'phrase' ? `${P.phrases_found} of ${P.phrases_checked} sentences found elsewhere` : `${fmtNum(P.percent, 1)}% matched`} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardContent className="p-5 sm:p-6">
          <Tabs defaultValue="accuracy">
            <TabsList aria-label="Report sections">
              <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
              <TabsTrigger value="readability">Readability</TabsTrigger>
              <TabsTrigger value="keywords">Keywords</TabsTrigger>
              <TabsTrigger value="sections">Sections</TabsTrigger>
              <TabsTrigger value="plagiarism">Originality</TabsTrigger>
              <TabsTrigger value="mine">My scores</TabsTrigger>
            </TabsList>
            <TabsContent value="accuracy"><AccuracyTab A={A} /></TabsContent>
            <TabsContent value="readability"><ReadabilityTab R={R} /></TabsContent>
            <TabsContent value="keywords"><KeywordsTab K={K} /></TabsContent>
            <TabsContent value="sections"><SectionsTab S={S} /></TabsContent>
            <TabsContent value="plagiarism"><PlagiarismTab P={P} /></TabsContent>
            <TabsContent value="mine"><MyScores id={id} initial={state.r.validation} /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  );
}
