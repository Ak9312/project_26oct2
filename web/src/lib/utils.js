import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(digits);
}

export function fmtDate(iso, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

// Score band for a 0–100 total, or a part score as a share of its maximum.
export function band(score, max = 100, passMark = 70) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return 'none';
  const pct = (Number(score) / max) * 100;
  const pass = max === 100 ? passMark : 70;
  if (pct >= pass) return 'good';
  if (pct >= 50) return 'warn';
  return 'bad';
}

export const BAND_TEXT = { good: 'text-good-ink', warn: 'text-warn-ink', bad: 'text-bad-ink', none: 'text-muted-foreground' };
export const BAND_BG = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', none: 'bg-muted-foreground/40' };
export const BAND_SOFT = { good: 'bg-good-soft text-good-ink', warn: 'bg-warn-soft text-warn-ink', bad: 'bg-bad-soft text-bad-ink', none: 'bg-muted text-muted-foreground' };
export const BAND_VAR = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', none: 'var(--muted-foreground)' };

export const PARAMS = [
  { key: 'accuracy', label: 'Accuracy', long: 'Accuracy and relevancy', max: 30 },
  { key: 'readability', label: 'Readability', long: 'Readability', max: 20 },
  { key: 'keywords', label: 'Keywords', long: 'Keywords', max: 20 },
  { key: 'sections', label: 'Sections', long: 'Missing sections', max: 20 },
  { key: 'plagiarism', label: 'Originality', long: 'Originality (plagiarism)', max: 10 },
];
