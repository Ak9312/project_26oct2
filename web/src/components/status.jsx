import { CheckCircle2, AlertTriangle, XCircle, Loader2, Clock, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui';

export function StatusBadge({ status }) {
  if (status === 'passed') return <Badge variant="good"><CheckCircle2 />Passed</Badge>;
  if (status === 'needs_review') return <Badge variant="warn"><AlertTriangle />Needs review</Badge>;
  if (status === 'error') return <Badge variant="bad"><XCircle />Failed</Badge>;
  return <Badge variant="muted"><Loader2 className="animate-spin" />Running</Badge>;
}

export function DecisionBadge({ decision }) {
  if (decision === 'approved') return <Badge variant="good"><CheckCircle2 />Approved</Badge>;
  if (decision === 'sent_back') return <Badge variant="bad"><Undo2 />Sent back</Badge>;
  return <Badge variant="muted"><Clock />Pending</Badge>;
}
