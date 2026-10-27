import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Undo2, Inbox, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, Input, Badge, Table, THead, TBody, TR, TH, TD, Skeleton } from '@/components/ui';
import { PageHeader, ErrorNote, useApp } from '@/components/layout';
import { ScorePill } from '@/components/charts';
import { DecisionBadge } from '@/components/status';
import { data } from '@/lib/api';
import { fmtDate } from '@/lib/utils';

function Row({ it, onSaved }) {
  const [score, setScore] = useState(it.reviewer_score === null ? '' : String(it.reviewer_score));
  const [notes, setNotes] = useState(it.notes || '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  async function decide(decision) {
    const n = score === '' ? null : Number(score);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 100)) { setErr('Whole number, 0–100'); return; }
    setErr(''); setBusy(decision);
    try {
      await data('review_save', { audit_id: it.audit_id, decision, reviewer_score: n, notes });
      onSaved(it.audit_id, decision);
      toast.success(decision === 'approved' ? 'Approved' : 'Sent back for changes');
    } catch (e) { if (e.status !== 401) setErr(e.message); } finally { setBusy(''); }
  }
  return (
    <TR className="align-top hover:bg-transparent">
      <TD className="min-w-[14rem] max-w-[22rem]">
        <Link to={'/audits/' + encodeURIComponent(it.audit_id)} className="line-clamp-2 font-medium hover:text-primary">{it.title || it.url || it.audit_id}</Link>
        <div className="mt-1 text-xs text-muted-foreground">{fmtDate(it.created_at)}</div>
      </TD>
      <TD><ScorePill score={it.total} /></TD>
      <TD className="min-w-[14rem]">
        <ul className="space-y-1 text-xs text-muted-foreground">
          {it.review_reasons.slice(0, 3).map((r) => <li key={r} className="flex gap-1.5"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />{r}</li>)}
          {it.review_reasons.length > 3 ? <li className="pl-3">+{it.review_reasons.length - 3} more</li> : null}
        </ul>
      </TD>
      <TD className="w-24">
        <label className="sr-only" htmlFor={'s-' + it.audit_id}>Your score</label>
        <Input id={'s-' + it.audit_id} type="number" inputMode="numeric" min={0} max={100} placeholder="—" value={score} onChange={(e) => { setErr(''); setScore(e.target.value); }} className="h-9 w-20 font-mono" />
        {err ? <p className="mt-1 text-xs text-bad-ink">{err}</p> : null}
      </TD>
      <TD className="min-w-[9rem]">
        <label className="sr-only" htmlFor={'n-' + it.audit_id}>Notes</label>
        <Input id={'n-' + it.audit_id} placeholder="Optional note" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} className="h-9" />
      </TD>
      <TD className="min-w-[17rem]">
        <div className="flex flex-nowrap items-center gap-2">
          <Button size="sm" variant="good" disabled={!!busy} onClick={() => decide('approved')}>{busy === 'approved' ? <Loader2 className="animate-spin" /> : <Check />}Approve</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => decide('sent_back')}>{busy === 'sent_back' ? <Loader2 className="animate-spin" /> : <Undo2 />}Send back</Button>
        </div>
        <div className="mt-2"><DecisionBadge decision={it.decision} /></div>
      </TD>
    </TR>
  );
}

export default function ReviewPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [show, setShow] = useState('pending');
  const { refreshPending } = useApp();
  useEffect(() => { data('review_list').then((r) => setItems(r.items)).catch(setError); }, []);
  const onSaved = (id, decision) => { setItems((xs) => xs.map((x) => (x.audit_id === id ? { ...x, decision } : x))); refreshPending(); };
  const pending = items ? items.filter((i) => i.decision === 'pending') : [];
  const shown = items ? (show === 'pending' ? pending : items) : [];

  return (
    <>
      <PageHeader title="Review queue" description="Articles below the pass mark, with a contradicted claim, with copied sentences, or where a check couldn't run. Your decisions are saved with the audit and included in the CSV." />
      <ErrorNote error={error} />
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b p-4 sm:px-6">
          <div className="flex gap-1" role="group" aria-label="Show">
            <Button size="sm" variant={show === 'pending' ? 'secondary' : 'ghost'} aria-pressed={show === 'pending'} onClick={() => setShow('pending')}>Pending <span className="font-mono text-xs text-muted-foreground">{pending.length}</span></Button>
            <Button size="sm" variant={show === 'all' ? 'secondary' : 'ghost'} aria-pressed={show === 'all'} onClick={() => setShow('all')}>All <span className="font-mono text-xs text-muted-foreground">{items ? items.length : 0}</span></Button>
          </div>
          <Badge variant="muted" className="hidden sm:inline-flex">Score yourself, then approve or send back</Badge>
        </div>
        {!items ? <div className="space-y-2 p-6">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          : !shown.length ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-good-soft text-good-ink"><Inbox className="size-5" /></span>
              <h2 className="mt-4 font-semibold">{show === 'pending' ? 'All caught up' : 'Nothing to review yet'}</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">Articles that need a human look will appear here.</p>
            </div>
          ) : (
            <Table>
              <THead><TR className="hover:bg-transparent"><TH>Article</TH><TH>Score</TH><TH>Why it's here</TH><TH>Your score</TH><TH>Notes</TH><TH>Decision</TH></TR></THead>
              <TBody>{shown.map((it) => <Row key={it.audit_id} it={it} onSaved={onSaved} />)}</TBody>
            </Table>
          )}
      </Card>
    </>
  );
}
