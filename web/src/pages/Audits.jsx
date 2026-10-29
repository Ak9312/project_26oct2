import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip as RTooltip, CartesianGrid } from 'recharts';
import { Plus, Download, Search, FileText, Gauge, Flag, CheckCircle2, ArrowUpRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Table, THead, TBody, TR, TH, TD, Skeleton, Badge } from '@/components/ui';
import { PageHeader, ErrorNote } from '@/components/layout';
import { Stat, ScorePill, MiniBars } from '@/components/charts';
import { StatusBadge } from '@/components/status';
import { data, downloadCsv } from '@/lib/api';
import { fmtDate, fmtNum, band, BAND_VAR, cn } from '@/lib/utils';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'needs_review', label: 'Needs review' },
  { id: 'passed', label: 'Passed' },
  { id: 'error', label: 'Failed' },
];

function Distribution({ audits, passMark }) {
  const buckets = [
    { range: '0–49', min: 0, max: 49 },
    { range: '50–59', min: 50, max: 59 },
    { range: '60–69', min: 60, max: 69 },
    { range: '70–79', min: 70, max: 79 },
    { range: '80–89', min: 80, max: 89 },
    { range: '90–100', min: 90, max: 100 },
  ].map((b) => ({ ...b, count: audits.filter((a) => a.total !== null && a.total >= b.min && a.total <= b.max).length }));
  return (
    <div className="h-56 w-full" role="img" aria-label={'Score distribution: ' + buckets.map((b) => `${b.range}: ${b.count}`).join(', ')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="range" tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <RTooltip cursor={{ fill: 'var(--muted)' }} content={({ active, payload }) => active && payload && payload.length ? (
            <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">{payload[0].payload.range}: <b>{payload[0].value}</b> audit{payload[0].value === 1 ? '' : 's'}</div>
          ) : null} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive={false}>
            {buckets.map((b) => <Cell key={b.range} fill={BAND_VAR[band(b.min, 100, passMark)]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Averages({ audits }) {
  const scored = audits.filter((a) => a.total !== null);
  const rows = [
    { key: 'accuracy', label: 'Accuracy', max: 30 },
    { key: 'readability', label: 'Readability', max: 20 },
    { key: 'keywords', label: 'Keywords', max: 20 },
    { key: 'sections', label: 'Sections', max: 20 },
    { key: 'plagiarism', label: 'Originality', max: 10 },
  ].map((p) => {
    const vals = scored.map((a) => a[p.key]).filter((v) => v !== null && v !== undefined);
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    return { ...p, avg, pct: avg === null ? 0 : (avg / p.max) * 100 };
  });
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="mb-1.5 flex justify-between text-sm"><span>{r.label}</span><span className="font-mono tabular text-muted-foreground">{fmtNum(r.avg, 1)}/{r.max}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: r.pct + '%', background: BAND_VAR[band(r.avg, r.max)] }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function AuditsPage() {
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    return data('list').then((r) => { setRes(r); setError(null); }).catch(setError).finally(() => setLoading(false));
  }, []);
  // Load on open, and again whenever you come back to this tab.
  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);
  const audits = res ? res.audits : [];
  const passMark = res ? res.pass_mark : 70;

  const stats = useMemo(() => {
    const scored = audits.filter((a) => a.total !== null);
    const avg = scored.length ? scored.reduce((s, a) => s + a.total, 0) / scored.length : null;
    const passed = audits.filter((a) => a.status === 'passed').length;
    return { total: res ? res.total_audits : 0, avg, passRate: audits.length ? (passed / audits.length) * 100 : null, review: res ? res.pending_reviews : 0 };
  }, [audits, res]);

  const shown = audits.filter((a) => (filter === 'all' || a.status === filter) &&
    (!q || (a.title + ' ' + a.keyword + ' ' + a.url).toLowerCase().includes(q.toLowerCase())));

  async function exportCsv() {
    try { await downloadCsv(); toast.success('CSV downloaded'); } catch (e) { if (e.status !== 401) toast.error(e.message); }
  }

  return (
    <>
      <PageHeader
        title="Audits"
        description="Every article you've scored, with the score breakdown, review status and history."
        actions={<>
          <Button variant="outline" onClick={load} disabled={loading} aria-label="Refresh the list"><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>
          <Button variant="outline" onClick={exportCsv}><Download />Download CSV</Button>
        </>}
      />
      <ErrorNote error={error} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {res ? <>
          <Stat label="Audits" value={stats.total} sub="All time" icon={FileText} />
          <Stat label="Average score" value={fmtNum(stats.avg)} sub={`Pass mark ${passMark}`} icon={Gauge} tone={band(stats.avg, 100, passMark)} />
          <Stat label="Waiting for review" value={stats.review} sub="Below pass mark or flagged" icon={Flag} tone={stats.review ? 'warn' : undefined} />
          <Stat label="Pass rate" value={stats.passRate === null ? '—' : fmtNum(stats.passRate) + '%'} sub={`Of the latest ${audits.length}`} icon={CheckCircle2} />
        </> : [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Score distribution</CardTitle><CardDescription>How your audited articles score out of 100.</CardDescription></CardHeader>
          <CardContent>{res ? <Distribution audits={audits} passMark={passMark} /> : <Skeleton className="h-56" />}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Average by parameter</CardTitle><CardDescription>Where articles lose points.</CardDescription></CardHeader>
          <CardContent>{res ? <Averages audits={audits} /> : <Skeleton className="h-56" />}</CardContent>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <Button key={f.id} size="sm" variant={filter === f.id ? 'secondary' : 'ghost'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
                <span className="font-mono text-xs text-muted-foreground tabular">{f.id === 'all' ? audits.length : audits.filter((a) => a.status === f.id).length}</span>
              </Button>
            ))}
          </div>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, keyword or URL" className="pl-9" aria-label="Search audits" />
          </div>
        </div>
        {!res ? (
          <div className="space-y-2 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !audits.length ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground"><FileText className="size-5" /></span>
            <h2 className="mt-4 font-semibold">Run your first audit</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Paste an article or a URL and get a score out of 100 in a couple of minutes.</p>
            <Button asChild className="mt-5"><Link to="/new"><Plus />New audit</Link></Button>
          </div>
        ) : (
          <Table>
            <THead><TR className="hover:bg-transparent"><TH>Article</TH><TH className="hidden md:table-cell">Keyword</TH><TH>Score</TH><TH className="hidden lg:table-cell">Breakdown</TH><TH>Status</TH><TH className="hidden sm:table-cell">Audited</TH><TH><span className="sr-only">Open</span></TH></TR></THead>
            <TBody>
              {shown.map((a) => (
                <TR key={a.audit_id} className="cursor-pointer" onClick={() => navigate('/audits/' + encodeURIComponent(a.audit_id))}>
                  <TD className="max-w-[18rem]">
                    <Link to={'/audits/' + encodeURIComponent(a.audit_id)} className="line-clamp-1 font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>{a.title || a.url || a.audit_id}</Link>
                    {a.url ? <div className="line-clamp-1 text-xs text-muted-foreground">{a.url.replace(/^https?:\/\//, '')}</div> : <div className="text-xs text-muted-foreground">Pasted text</div>}
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{a.keyword}</TD>
                  <TD><ScorePill score={a.total} passMark={passMark} /></TD>
                  <TD className="hidden lg:table-cell"><MiniBars row={a} /></TD>
                  <TD><StatusBadge status={a.status} /></TD>
                  <TD className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{fmtDate(a.created_at)}</TD>
                  <TD className="w-8 text-muted-foreground"><ArrowUpRight className="size-4" aria-hidden="true" /></TD>
                </TR>
              ))}
              {!shown.length ? <TR><TD colSpan={7} className="py-10 text-center text-muted-foreground">No audits match.</TD></TR> : null}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
