import { useEffect, useState, createContext, useContext } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { Moon, Sun, Monitor, Plus, Menu, X, AlertTriangle, CircleCheck, Lock } from 'lucide-react';
import { Button, Badge, Input, Card, Label } from '@/components/ui';
import { cn } from '@/lib/utils';
import { health, data, setPasswordHandler, savePassword } from '@/lib/api';

const AppContext = createContext({ health: null, pending: 0, refreshPending: () => {} });
export const useApp = () => useContext(AppContext);

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l7 3.2v5.1c0 4.3-2.9 7.6-7 8.9-4.1-1.3-7-4.6-7-8.9V6.2z" />
          <path d="M8.8 11.8l2.3 2.3 4.2-4.4" />
        </svg>
      </span>
      <span className="whitespace-nowrap text-[15px]">Content Auditor</span>
    </Link>
  );
}

function ThemeToggle() {
  const [choice, setChoice] = useState(() => {
    try { return localStorage.getItem('cqa_theme') || 'system'; } catch (e) { return 'system'; }
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', choice === 'dark' || (choice === 'system' && mq.matches));
    apply();
    try { localStorage.setItem('cqa_theme', choice); } catch (e) { /* ignore */ }
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [choice]);
  const next = { system: 'light', light: 'dark', dark: 'system' }[choice];
  const Icon = { system: Monitor, light: Sun, dark: Moon }[choice];
  return (
    <Button variant="ghost" size="icon" onClick={() => setChoice(next)} aria-label={`Theme: ${choice}. Switch to ${next}`} title={`Theme: ${choice}`}>
      <Icon />
    </Button>
  );
}

const NAV = [
  { to: '/', label: 'Audits', end: true },
  { to: '/review', label: 'Review', badge: true },
  { to: '/validation', label: 'Validation' },
];

function StatusPill({ h }) {
  if (!h) return null;
  if (h.mock) return <Badge variant="warn">Sample data</Badge>;
  const ready = h.required && h.required.GROQ_API_KEY && h.required.STORAGE;
  const allOn = ready && h.optional && h.optional.SERPAPI_KEY;
  return (
    <Badge variant={ready ? (allOn ? 'good' : 'warn') : 'bad'} className="hidden md:inline-flex">
      {ready ? <CircleCheck /> : <AlertTriangle />}
      {ready ? (allOn ? 'All checks on' : 'Some checks off') : 'Setup needed'}
    </Badge>
  );
}

function SetupNotice({ h }) {
  if (!h || h.mock) return null;
  const notes = [];
  if (h.groq_key_problem) notes.push(h.groq_key_problem);
  else if (h.required && !h.required.GROQ_API_KEY) notes.push('GROQ_API_KEY is missing, so the AI checks can’t run.');
  if (h.required && !h.required.STORAGE) notes.push('Storage isn’t connected, so audits can’t be saved.');
  if (h.optional && !h.optional.SERPAPI_KEY) notes.push('SERPAPI_KEY isn’t set: fact-checking, missing sections and the plagiarism check are off.');
  if (!notes.length) return null;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      <div className="flex gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn-ink">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{notes.join(' ')} Add keys in Vercel → Settings → Environment Variables, then redeploy.</p>
      </div>
    </div>
  );
}

function PasswordGate({ wrong }) {
  const [value, setValue] = useState('');
  return (
    <div className="grid min-h-[70vh] place-items-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground"><Lock className="size-5" /></span>
          <div>
            <h1 className="text-lg font-semibold">Enter the app password</h1>
            <p className="text-sm text-muted-foreground">Set as APP_PASSWORD in Vercel.</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); savePassword(value); location.reload(); }}>
          <div className="space-y-2">
            <Label htmlFor="pw">Password</Label>
            <Input id="pw" type="password" autoFocus autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={wrong || undefined} />
            {wrong ? <p className="text-sm text-bad-ink">That password was wrong. Try again.</p> : null}
          </div>
          <Button type="submit" className="w-full">Continue</Button>
        </form>
      </Card>
    </div>
  );
}

export function Layout() {
  const [h, setH] = useState(null);
  const [pending, setPending] = useState(0);
  const [gate, setGate] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => { setPasswordHandler((hadPassword) => setGate({ wrong: hadPassword })); }, []);
  useEffect(() => { health().then(setH).catch(() => setH(null)); }, []);
  const refreshPending = () => data('list').then((r) => setPending(r.pending_reviews || 0)).catch(() => {});
  useEffect(() => { refreshPending(); }, [loc.pathname]);
  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);

  return (
    <AppContext.Provider value={{ health: h, pending, refreshPending }}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
            <Logo />
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}
                  className={({ isActive }) => cn('inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', isActive && 'bg-muted text-foreground')}>
                  {n.label}
                  {n.badge && pending ? <span className="rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-foreground tabular">{pending}</span> : null}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <StatusPill h={h} />
              <ThemeToggle />
              <Button asChild className="hidden sm:inline-flex"><Link to="/new"><Plus />New audit</Link></Button>
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" aria-expanded={menuOpen}>
                {menuOpen ? <X /> : <Menu />}
              </Button>
            </div>
          </div>
          {menuOpen ? (
            <nav className="border-t px-4 py-3 md:hidden" aria-label="Main">
              <div className="flex flex-col gap-1">
                {[{ to: '/new', label: 'New audit' }].concat(NAV).map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn('flex h-11 items-center justify-between rounded-md px-3 text-sm font-medium hover:bg-muted', isActive && 'bg-muted')}>
                    {n.label}
                    {n.badge && pending ? <span className="rounded-full bg-primary px-2 py-px text-xs font-semibold text-primary-foreground">{pending}</span> : null}
                  </NavLink>
                ))}
              </div>
            </nav>
          ) : null}
        </header>
        <SetupNotice h={h} />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          {gate ? <PasswordGate wrong={gate.wrong} /> : <Outlet />}
        </main>
        <footer className="no-print mx-auto max-w-7xl px-4 pb-10 text-xs text-muted-foreground sm:px-6 lg:px-8">
          Content Auditor · AI checks by Groq · Search data by SerpAPI
        </footer>
      </div>
    </AppContext.Provider>
  );
}

export function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-sm text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error || error.status === 401) return null;
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad-ink">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{error.message || String(error)}</p>
    </div>
  );
}
