import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { Target, Sigma, Scale, TrendingUp, RefreshCw, ClipboardCheck } from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Progress, Table, THead, TBody, TR, TH, TD, Skeleton, Badge } from '@/components/ui';
import { PageHeader, ErrorNote } from '@/components/layout';
import { Stat } from '@/components/charts';
import { data } from '@/lib/api';
import { computeValidation } from '@/lib/validation';
import { fmtNum, cn } from '@/lib/utils';

function signed(n, d = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(d);
}

export default function ValidationPage() {
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const load = () => { setError(null); data('validation').then(setRes).catch(setError); };
  useEffect(load, []);
  const v = useMemo(() => (res ? computeValidation(res.pairs, res.pass_mark) : null), [res]);
  const target = res ? res.target_count || 30 : 30;
  const has = v && v.n >= 3;

  return (
    <>
      <PageHeader
        title="Validation"
        description="How closely the auditor matches your own judgement. Score each test article yourself (the My scores tab on its report), aiming for 30."
        actions={<Button variant="outline" onClick={load}><RefreshCw />Refresh</Button>}
      />
      <ErrorNote error={error} />
      {!v ? <Skeleton className="h-96 rounded-xl" /> : (
        <>
          <Card className="mb-4">
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground"><ClipboardCheck className="size-5" /></span>
                <div><div className="text-sm text-muted-foreground">Articles you've scored</div><div className="font-mono text-2xl font-semibold tabular">{v.n} <span className="text-base font-normal text-muted-foreground">/ {target}</span></div></div>
              </div>
              <div className="flex-1"><Progress value={(v.n / target) * 100} /></div>
              <p className="text-sm text-muted-foreground sm:max-w-xs">{v.n < 3 ? 'Metrics appear after 3 scored articles.' : v.n < target ? 'Numbers settle as you approach ' + target + '.' : 'Target reached.'}</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat label="Average gap" value={has ? fmtNum(v.mae_total, 1) : '—'} sub="Points between you and the AI · goal ≤ 5" icon={Target} tone={has ? (v.mae_total <= 5 ? 'good' : v.mae_total <= 10 ? 'warn' : 'bad') : undefined} />
            <Stat label="Correlation" value={has ? fmtNum(v.pearson_total, 2) : '—'} sub="1.00 = perfectly in step" icon={TrendingUp} />
            <Stat label="Pass/fail agreement" value={has ? `${v.agreement}/${v.n}` : '—'} sub={`Goal: ${Math.ceil(target * 0.9)} of ${target}`} icon={Scale} />
            <Stat label="Bias" value={has ? signed(v.bias_total) : '—'} sub={has ? (v.bias_total > 0 ? 'AI scores higher than you' : v.bias_total < 0 ? 'AI scores lower than you' : 'No bias') : '+ means the AI is generous'} icon={Sigma} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>You vs the auditor</CardTitle><CardDescription>Each dot is one article. On the diagonal = full agreement.</CardDescription></CardHeader>
              <CardContent>
                {v.pairs.length ? (
                  <div className="h-72" role="img" aria-label={`Scatter of ${v.pairs.length} articles comparing your total with the auditor's total`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: -12 }}>
                        <CartesianGrid stroke="var(--chart-grid)" />
                        <XAxis type="number" dataKey="me" name="You" domain={[0, 100]} tickLine={false} label={{ value: 'Your score', position: 'insideBottom', offset: -8, fontSize: 12 }} />
                        <YAxis type="number" dataKey="ai" name="AI" domain={[0, 100]} tickLine={false} label={{ value: 'AI', angle: -90, position: 'insideLeft', offset: 20, fontSize: 12 }} />
                        <ZAxis range={[60, 60]} />
                        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                        <ReferenceLine x={res.pass_mark} stroke="var(--border)" />
                        <ReferenceLine y={res.pass_mark} stroke="var(--border)" />
                        <RTooltip cursor={false} content={({ active, payload }) => active && payload && payload.length ? (
                          <div className="max-w-56 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"><div className="line-clamp-1 font-medium">{payload[0].payload.title}</div>You {payload[0].payload.me} · AI {payload[0].payload.ai}</div>
                        ) : null} />
                        <Scatter data={v.pairs.map((p) => ({ me: p.me.total, ai: p.ai.total, title: p.title }))} fill="var(--primary)" isAnimationActive={false} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                ) : <div className="grid h-72 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">Score an article to see it here</div>}
              </CardContent>
            </Card>
            <Card className="overflow-hidden lg:col-span-3">
              <CardHeader><CardTitle>By parameter</CardTitle><CardDescription>Rows with an average gap over 3 points need tuning.</CardDescription></CardHeader>
              <Table>
                <THead><TR className="hover:bg-transparent"><TH>Parameter</TH><TH className="text-right">AI avg</TH><TH className="text-right">Your avg</TH><TH className="text-right">Avg gap</TH><TH className="w-40">Bias</TH></TR></THead>
                <TBody>
                  {v.by_param.map((b) => {
                    const hot = has && b.mae > 3;
                    const w = has && Number.isFinite(b.bias) ? Math.min(50, (Math.abs(b.bias) / b.max) * 100) : 0;
                    return (
                      <TR key={b.key} className={cn(hot && 'bg-warn-soft/60')}>
                        <TD className="font-medium">{b.label} <span className="font-normal text-muted-foreground">/{b.max}</span>{hot ? <Badge variant="warn" className="ml-2">Tune</Badge> : null}</TD>
                        <TD className="text-right font-mono tabular">{has ? fmtNum(b.ai_avg, 1) : '—'}</TD>
                        <TD className="text-right font-mono tabular">{has ? fmtNum(b.my_avg, 1) : '—'}</TD>
                        <TD className="text-right font-mono tabular">{has ? fmtNum(b.mae, 1) : '—'}</TD>
                        <TD>
                          <div className="flex items-center gap-2">
                            <div className="relative h-2 flex-1 rounded-full bg-muted">
                              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                              {has ? <div className={cn('absolute inset-y-0 rounded-full', b.bias > 0 ? 'left-1/2 bg-primary' : 'right-1/2 bg-warn')} style={{ width: w + '%' }} /> : null}
                            </div>
                            <span className="w-10 text-right font-mono text-xs tabular">{has ? signed(b.bias) : '—'}</span>
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </Card>
          </div>

          {v.pairs.length ? (
            <Card className="mt-4 overflow-hidden">
              <CardHeader><CardTitle>Scored articles</CardTitle></CardHeader>
              <Table>
                <THead><TR className="hover:bg-transparent"><TH>Article</TH><TH className="text-right">AI</TH><TH className="text-right">You</TH><TH className="text-right">Gap</TH></TR></THead>
                <TBody>{v.pairs.map((x) => (
                  <TR key={x.id}><TD><Link to={'/audits/' + encodeURIComponent(x.id)} className="hover:text-primary">{x.title || x.id}</Link></TD><TD className="text-right font-mono tabular">{x.ai.total}</TD><TD className="text-right font-mono tabular">{x.me.total}</TD><TD className="text-right font-mono tabular">{signed(x.ai.total - x.me.total, 0)}</TD></TR>
                ))}</TBody>
              </Table>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
