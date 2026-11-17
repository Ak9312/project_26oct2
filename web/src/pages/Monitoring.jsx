import { useEffect, useState, Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  RefreshCw, Activity, Timer, Turtle, Bot, CircleCheck, AlertTriangle, XCircle, PlugZap, ChevronRight, ChevronDown,
  RotateCcw, Coins, Target, CircleDashed, CircleMinus,
} from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Table, THead, TBody, TR, TH, TD, Skeleton, Badge, Alert } from '@/components/ui';
import { PageHeader, ErrorNote } from '@/components/layout';
import { Stat } from '@/components/charts';
import { api } from '@/lib/api';
import { fmtDate, cn } from '@/lib/utils';

const monitor = (action) => api('monitor', { action });

export function fmtMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '—';
  const s = Number(ms) / 1000;
  if (s < 10) return s.toFixed(1) + ' s';
  if (s < 60) return Math.round(s) + ' s';
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return m + ' min' + (rest ? ' ' + rest + ' s' : '');
}
const pct = (r) => (r === null || r === undefined ? '—' : Math.round(r * 100) + '%');

const OUTCOME = {
  ok: { label: 'Completed', variant: 'good' },
  partial: { label: 'Completed with errors', variant: 'warn' },
  failed: { label: 'Failed', variant: 'bad' },
};
const STEP_STYLE = {
  ok: { bar: 'bg-good', icon: CircleCheck, text: 'text-good-ink', label: 'OK' },
  failed: { bar: 'bg-bad', icon: XCircle, text: 'text-bad-ink', label: 'Failed' },
  skipped: { bar: 'bg-muted-foreground/30', icon: CircleMinus, text: 'text-muted-foreground', label: 'Skipped' },
  not_reached: { bar: 'bg-transparent', icon: CircleDashed, text: 'text-muted-foreground', label: 'Not reached' },
};
const API_STATUS = {
  ok: { label: 'Working', variant: 'good', icon: CircleCheck },
  down: { label: 'Failing', variant: 'bad', icon: XCircle },
  warn: { label: 'Last call failed', variant: 'warn', icon: AlertTriangle },
  not_set_up: { label: 'Not set up', variant: 'muted', icon: CircleMinus },
  unknown: { label: 'Not checked yet', variant: 'muted', icon: CircleDashed },
};

function AlertsBanner({ alerts, audits }) {
  if (!alerts.length) {
    return (
      <Alert variant="good" className="mb-4">
        <CircleCheck />
        <div><span className="font-medium">All clear.</span> No alerts across the last {audits} audit{audits === 1 ? '' : 's'}.</div>
      </Alert>
    );
  }
  return (
    <div className="mb-4 space-y-2">
      {alerts.map((a) => (
        <Alert key={a.key} variant={a.level === 'bad' ? 'bad' : 'warn'}>
          {a.level === 'bad' ? <XCircle /> : <AlertTriangle />}
          <div><span className="font-medium">{a.title}.</span> {a.detail}</div>
        </Alert>
      ))}
    </div>
  );
}

function ApiHealth({ health, onCheck, checking }) {
  const checkedAt = health.find((h) => h.checked_at);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>API health</CardTitle>
          <CardDescription>{checkedAt ? 'Last checked ' + fmtDate(checkedAt.checked_at) + '. ' : ''}The check uses free endpoints, so it costs no searches or AI credits.</CardDescription>
        </div>
        <Button onClick={onCheck} disabled={checking} className="shrink-0"><PlugZap />{checking ? 'Checking…' : 'Check APIs now'}</Button>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {health.map((h) => {
          const st = API_STATUS[h.status] || API_STATUS.unknown;
          const Icon = st.icon;
          return (
            <div key={h.name} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-6">
              <div className="flex w-56 shrink-0 items-center gap-2 font-medium">
                <Icon className={cn('size-4', st.variant === 'good' ? 'text-good' : st.variant === 'bad' ? 'text-bad' : st.variant === 'warn' ? 'text-warn' : 'text-muted-foreground')} aria-hidden="true" />
                {h.label}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <Badge variant={st.variant} className="mr-2">{st.label}</Badge>
                {h.check && h.check.ms ? <span className="font-mono text-xs text-muted-foreground tabular">{fmtMs(h.check.ms)}</span> : null}
                {h.check && (h.check.error || h.check.detail) ? <p className={cn('mt-1', h.check.error ? 'text-bad-ink' : 'text-muted-foreground')}>{h.check.error || h.check.detail}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {h.calls ? `${h.calls} calls in recent audits, ${h.failed_calls} failed.` : 'Not used by recent audits.'}
                  {h.last_error ? ` Last error: ${h.last_error}${h.last_error_at ? ' (' + fmtDate(h.last_error_at) + ')' : ''}.` : ''}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Failures({ failures, onOpen }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Failures</CardTitle>
        <CardDescription>Audits where a step broke: which step, the error, and whether a retry saved it.</CardDescription>
      </CardHeader>
      {failures.length ? (
        <Table>
          <THead><TR><TH>When</TH><TH>Article</TH><TH>Step that broke</TH><TH>Error</TH><TH>Retry saved it?</TH></TR></THead>
          <TBody>
            {failures.map((f) => (
              <TR key={f.audit_id} className="cursor-pointer" onClick={() => onOpen(f.audit_id)}>
                <TD className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(f.at)}</TD>
                <TD className="max-w-48"><div className="line-clamp-2 text-sm font-medium">{f.title || f.url || f.audit_id}</div>
                  <Badge variant={f.outcome === 'failed' ? 'bad' : 'warn'} className="mt-1">{f.outcome === 'failed' ? 'Audit failed' : 'Audit finished, one step failed'}</Badge></TD>
                <TD className="whitespace-nowrap"><Badge variant="outline">{f.step_label || 'Unknown'}</Badge></TD>
                <TD className="max-w-md text-sm text-bad-ink"><div className="line-clamp-3">{f.error || '—'}</div></TD>
                <TD className="whitespace-nowrap text-sm">{f.retry_saved ? <span className="text-good-ink">Yes, after a retry</span> : f.retries ? <span className="text-bad-ink">No ({f.retries} retr{f.retries === 1 ? 'y' : 'ies'})</span> : <span className="text-muted-foreground">No retry</span>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : <CardContent><div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No failures in the stored run logs.</div></CardContent>}
    </Card>
  );
}

function StepTimeline({ run, allSteps }) {
  const total = Math.max(1, run.total_ms);
  // Steps after a failure never ran: show them, so it's clear where it stopped.
  const ran = new Set(run.steps.map((x) => x.name));
  const steps = run.steps.concat((allSteps || []).filter((x) => !ran.has(x.name))
    .map((x) => ({ name: x.name, label: x.label, status: 'not_reached', start_ms: 0, ms: 0, error: '', note: 'Not reached: the audit stopped earlier', retries: 0, retry_reasons: [] })));
  const apis = Object.entries(run.apis || {});
  const API_LABEL = { groq: 'Groq', serpapi: 'SerpAPI', page: 'Article page', competitor_pages: 'Top-10 pages', copyscape: 'Copyscape' };
  return (
    <div className="space-y-4 bg-muted/30 px-5 py-4 sm:px-6">
      <div className="space-y-2.5">
        {steps.map((s) => {
          const st = STEP_STYLE[s.status] || STEP_STYLE.ok;
          const Icon = st.icon;
          return (
            <div key={s.name} className="grid grid-cols-1 gap-1 sm:grid-cols-[13rem_1fr_5rem] sm:items-center sm:gap-3">
              <div className={cn('flex items-center gap-2 text-sm font-medium', st.text)}><Icon className="size-4 shrink-0" aria-hidden="true" />{s.label}</div>
              <div>
                <div className="relative h-2.5 rounded-full bg-muted" aria-hidden="true">
                  <div className={cn('absolute inset-y-0 rounded-full', st.bar)} style={{ left: (s.start_ms / total) * 100 + '%', width: Math.max(0.8, (s.ms / total) * 100) + '%' }} />
                </div>
                {s.error ? <p className="mt-1 text-xs text-bad-ink">{s.error}</p> : null}
                {s.note ? <p className="mt-1 text-xs text-muted-foreground">{s.note}</p> : null}
                {s.retries ? <p className={cn('mt-1 text-xs', s.recovered ? 'text-good-ink' : 'text-warn-ink')}><RotateCcw className="mr-1 inline size-3" aria-hidden="true" />{s.retries} retr{s.retries === 1 ? 'y' : 'ies'}{s.recovered ? ', which saved this step' : ''}: {s.retry_reasons.join('; ')}</p> : null}
              </div>
              <div className="font-mono text-sm tabular sm:text-right">{s.status === 'skipped' || s.status === 'not_reached' ? '—' : fmtMs(s.ms)}</div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span>Model: <span className="text-foreground">{run.model || '—'}</span></span>
        <span>AI tokens: <span className="font-mono text-foreground tabular">{run.tokens ? run.tokens.toLocaleString('en-IN') : '—'}</span></span>
        {apis.map(([k, a]) => (
          <span key={k}>{API_LABEL[k] || k}: <span className="font-mono text-foreground tabular">{a.calls} call{a.calls === 1 ? '' : 's'}</span>{a.failed ? <span className="text-bad-ink"> ({a.failed} failed{a.last_error ? ': ' + a.last_error : ''})</span> : null}</span>
        ))}
        <Link to={'/audits/' + encodeURIComponent(run.audit_id)} className="ml-auto font-medium text-primary hover:underline">Open report</Link>
      </div>
    </div>
  );
}

function RunLog({ runs, open, setOpen, allSteps }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Run log</CardTitle>
        <CardDescription>Every audit, newest first. Click a row to see how long each step took and where it failed.</CardDescription>
      </CardHeader>
      {runs.length ? (
        <Table>
          <THead><TR><TH className="w-8" /><TH>When</TH><TH>Article and keyword</TH><TH>Result</TH><TH className="text-right">Total time</TH><TH className="text-right">Retries</TH><TH className="text-right">Score</TH></TR></THead>
          <TBody>
            {runs.map((r) => {
              const o = OUTCOME[r.outcome] || OUTCOME.ok;
              const isOpen = open === r.audit_id;
              return (
                <Fragment key={r.audit_id}>
                  <TR id={'run-' + r.audit_id} className={cn('cursor-pointer', isOpen && 'bg-muted/40')} onClick={() => setOpen(isOpen ? null : r.audit_id)} aria-expanded={isOpen}>
                    <TD className="w-8 pr-0">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TD>
                    <TD className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.at)}</TD>
                    <TD className="max-w-72">
                      <div className="line-clamp-1 text-sm font-medium">{r.title || r.url || r.audit_id}</div>
                      <div className="line-clamp-1 text-xs text-muted-foreground">{r.url ? r.url : 'Pasted text'}{r.keyword ? ' · ' + r.keyword : ''}</div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <Badge variant={o.variant}>{o.label}</Badge>
                      {r.failed_step ? <div className="mt-1 text-xs text-muted-foreground">at {(r.steps.find((s) => s.name === r.failed_step) || {}).label || r.failed_step}</div> : null}
                    </TD>
                    <TD className={cn('whitespace-nowrap text-right font-mono text-sm tabular', r.slow && 'text-warn-ink')}>{fmtMs(r.total_ms)}{r.slow ? <Turtle className="ml-1 inline size-3.5" aria-label="slow" /> : null}</TD>
                    <TD className="text-right font-mono text-sm tabular">{r.retries || 0}</TD>
                    <TD className="text-right font-mono text-sm tabular">{r.score === null || r.score === undefined ? '—' : r.score}</TD>
                  </TR>
                  {isOpen ? <tr><td colSpan={7} className="p-0"><StepTimeline run={r} allSteps={allSteps} /></td></tr> : null}
                </Fragment>
              );
            })}
          </TBody>
        </Table>
      ) : <CardContent><div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No run logs yet. They start with the next audit you run.</div></CardContent>}
    </Card>
  );
}

export default function MonitoringPage() {
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.get('run'));
  const scrollTo = (id) => { const el = document.getElementById('run-' + id); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const load = () => { setError(null); return monitor('get').then(setRes).catch(setError); };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = params.get('run');
    if (res && id) scrollTo(id);
  }, [res]);

  const checkNow = async () => {
    setChecking(true);
    try {
      const c = await monitor('check_apis');
      toast[c.ok ? 'success' : 'error'](c.ok ? 'All APIs are working.' : 'At least one API is failing. See API health.');
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setChecking(false);
    }
  };
  const openRun = (id) => {
    setOpen(id);
    setTimeout(() => scrollTo(id), 50);
  };

  const s = res && res.summary;
  const T = res && res.thresholds;
  return (
    <>
      <PageHeader
        title="Monitoring"
        description="The backend view: a log of every audit, time per step, API health and alerts, so you can see exactly where it breaks."
        actions={<Button variant="outline" onClick={load}><RefreshCw />Refresh</Button>}
      />
      <ErrorNote error={error} />
      {!res ? <Skeleton className="h-96 rounded-xl" /> : (
        <>
          <AlertsBanner alerts={res.alerts} audits={s.audits} />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat label="Success rate" value={pct(s.success_rate)} icon={Activity}
              sub={s.audits ? `${s.completed} of ${s.audits} audits gave a score · ${s.clean} with no errors` : 'No audits yet'}
              tone={s.success_rate === null ? undefined : s.success_rate >= 0.9 ? 'good' : s.success_rate >= 0.7 ? 'warn' : 'bad'} />
            <Stat label="Average time" value={fmtMs(s.avg_ms)} icon={Timer} sub={s.slowest_ms ? 'Slowest ' + fmtMs(s.slowest_ms) + ' · normal is 1–3 min' : 'Normal is 1–3 min'} />
            <Stat label="Slow audits" value={String(s.slow)} icon={Turtle} sub={'Over ' + fmtMs(T.slow_ms)} tone={s.slow ? 'warn' : 'good'} />
            <Stat label="AI failure rate" value={pct(s.ai_failure_rate)} icon={Bot}
              sub={s.ai_runs ? `${s.ai_failed} of ${s.ai_runs} audits · alert over ${Math.round(T.ai_failure_rate * 100)}%` : 'Alert over 20%'}
              tone={s.ai_failure_rate === null ? undefined : s.ai_failure_rate > T.ai_failure_rate ? 'bad' : 'good'} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3 sm:gap-4">
            <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"><RotateCcw className="size-4 text-muted-foreground" aria-hidden="true" /><span><span className="font-mono font-semibold tabular">{s.retries}</span> retr{s.retries === 1 ? 'y' : 'ies'} · <span className="font-mono font-semibold tabular">{s.recovered}</span> audit{s.recovered === 1 ? '' : 's'} saved by a retry</span></div>
            <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"><Coins className="size-4 text-muted-foreground" aria-hidden="true" /><span>Average <span className="font-mono font-semibold tabular">{s.avg_tokens ? s.avg_tokens.toLocaleString('en-IN') : '—'}</span> AI tokens per audit (cost; alert at 2× usual)</span></div>
            <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"><Target className="size-4 text-muted-foreground" aria-hidden="true" /><span>Accuracy vs your scores: <span className="font-mono font-semibold tabular">{s.accuracy.scored >= T.accuracy_min_scored ? pct(s.accuracy.rate) : '—'}</span> {s.accuracy.scored >= T.accuracy_min_scored ? `(${s.accuracy.agree}/${s.accuracy.scored}, alert under 80%)` : `(needs ${T.accuracy_min_scored} scored on Validation; ${s.accuracy.scored} so far)`}</span></div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Numbers cover the latest {res.window} audits.</p>

          <div className="mt-6 space-y-4">
            <ApiHealth health={res.health} onCheck={checkNow} checking={checking} />
            <Failures failures={res.failures} onOpen={openRun} />
            <RunLog runs={res.runs} open={open} setOpen={setOpen} allSteps={res.steps} />
          </div>
        </>
      )}
    </>
  );
}
