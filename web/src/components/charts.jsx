import { RadialBarChart, RadialBar, PolarAngleAxis, RadarChart, PolarGrid, Radar, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { cn, band, BAND_VAR, BAND_TEXT, BAND_BG, PARAMS, fmtNum } from '@/lib/utils';

// Big circular score out of 100.
export function ScoreGauge({ score, passMark = 70, size = 184, label = 'of 100' }) {
  const b = band(score, 100, passMark);
  const value = Number.isFinite(Number(score)) ? Number(score) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Score ${score ?? 'not available'} out of 100`}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="78%" outerRadius="100%" data={[{ value }]} startAngle={90} endAngle={-270} barSize={14}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar dataKey="value" cornerRadius={10} fill={BAND_VAR[b]} background={{ fill: 'var(--muted)' }} isAnimationActive={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-mono text-5xl font-semibold tracking-tight tabular', BAND_TEXT[b])}>{score ?? '—'}</span>
        <span className="mt-1 text-xs text-muted-foreground">{label} · pass {passMark}</span>
      </div>
    </div>
  );
}

// Five parameters as a share of their maximum.
export function ScoreRadar({ scores, height = 240 }) {
  const data = PARAMS.map((p) => ({
    param: p.label,
    value: Math.round(((Number(scores[p.key]) || 0) / p.max) * 100),
    raw: scores[p.key],
    max: p.max,
  }));
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={'Score shape: ' + data.map((d) => `${d.param} ${d.value}%`).join(', ')}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid />
          <PolarAngleAxis dataKey="param" tick={{ fontSize: 12 }} />
          <Radar dataKey="value" stroke="var(--primary)" strokeWidth={2} fill="var(--primary)" fillOpacity={0.18} dot={{ r: 3, fill: 'var(--primary)' }} isAnimationActive={false} />
          <RTooltip
            cursor={false}
            content={({ active, payload }) => active && payload && payload.length ? (
              <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                <span className="font-medium">{payload[0].payload.param}</span>: {payload[0].payload.raw}/{payload[0].payload.max}
              </div>
            ) : null}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// One labelled bar per parameter.
export function ParamBar({ label, score, max, note, href }) {
  const b = band(score, max);
  const pct = max ? Math.max(0, Math.min(100, ((Number(score) || 0) / max) * 100)) : 0;
  const Wrapper = href ? 'a' : 'div';
  return (
    <Wrapper href={href} className={cn('block rounded-lg', href && 'group -mx-2 px-2 py-1.5 hover:bg-muted/60')}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono tabular text-sm">
          <span className={cn('font-semibold', BAND_TEXT[b])}>{score ?? '—'}</span>
          <span className="text-muted-foreground">/{max}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', BAND_BG[b])} style={{ width: pct + '%' }} />
      </div>
      {note ? <p className={cn('mt-1.5 text-xs', b === 'bad' ? 'text-bad-ink' : 'text-muted-foreground')}>{note}</p> : null}
    </Wrapper>
  );
}

// Small score pill used in tables.
export function ScorePill({ score, passMark = 70 }) {
  if (score === null || score === undefined) return <span className="font-mono text-muted-foreground">—</span>;
  const b = band(score, 100, passMark);
  const soft = { good: 'bg-good-soft text-good-ink', warn: 'bg-warn-soft text-warn-ink', bad: 'bg-bad-soft text-bad-ink', none: '' }[b];
  return <span className={cn('inline-flex min-w-11 justify-center rounded-md px-2 py-1 font-mono text-sm font-semibold tabular', soft)}>{score}</span>;
}

// Five tiny bars in a row: the score shape at a glance.
export function MiniBars({ row }) {
  return (
    <div className="flex items-end gap-1" aria-hidden="true">
      {PARAMS.map((p) => {
        const v = row[p.key];
        const pct = v === null || v === undefined ? 0 : Math.max(8, ((Number(v) || 0) / p.max) * 100);
        return (
          <div key={p.key} className="flex h-6 w-2 items-end overflow-hidden rounded-sm bg-muted" title={`${p.label} ${v ?? '—'}/${p.max}`}>
            <div className={cn('w-full rounded-sm', BAND_BG[band(v, p.max)])} style={{ height: pct + '%' }} />
          </div>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
      </div>
      <div className={cn('mt-2 font-mono text-3xl font-semibold tracking-tight tabular', tone && BAND_TEXT[tone])}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export { fmtNum };
