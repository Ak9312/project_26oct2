import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, FileText, ArrowRight, Loader2, Check, Minus, Sparkles } from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Textarea, Label, NativeSelect, Tabs, TabsList, TabsTrigger, TabsContent, Separator } from '@/components/ui';
import { PageHeader, ErrorNote, useApp } from '@/components/layout';
import { api } from '@/lib/api';
import { PARAMS, cn } from '@/lib/utils';

const RUBRIC = {
  accuracy: 'Headings vs content, claims fact-checked on Google',
  readability: 'Hemingway-style grade, hard sentences, passive voice',
  keywords: 'Placement, density, related terms, search intent',
  sections: 'Subtopics covered by the top-ranking pages',
  plagiarism: 'Sample sentences searched for copies',
};

function Check2({ on, children }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full', on ? 'bg-good text-white dark:text-background' : 'bg-muted text-muted-foreground')}>
        {on ? <Check className="size-3" strokeWidth={3} /> : <Minus className="size-3" strokeWidth={3} />}
      </span>
      <span className={on ? '' : 'text-muted-foreground'}>{children}</span>
    </li>
  );
}

export default function NewAuditPage() {
  const [mode, setMode] = useState('url');
  const [form, setForm] = useState({ url: '', heading: '', content: '', meta_description: '', keyword: '', secondary: '', target_grade: '9', market: 'in-en' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { health: h } = useApp();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const words = (form.content.match(/[\p{L}\p{N}]+/gu) || []).length;
  const serp = !h || h.mock || (h.optional && h.optional.SERPAPI_KEY);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const body = { keyword: form.keyword.trim(), secondary: form.secondary, target_grade: Number(form.target_grade), market: form.market };
    if (mode === 'url') {
      body.url = form.url.trim();
      if (!/^https?:\/\/\S+\.\S+/.test(body.url)) return setError({ message: 'Enter the full article URL, starting with https://' });
    } else {
      Object.assign(body, { heading: form.heading.trim(), content: form.content, meta_description: form.meta_description.trim() });
      if (!body.heading) return setError({ message: 'Add the article heading.' });
      if (words < 50) return setError({ message: 'Paste the full article — at least 50 words.' });
    }
    if (!body.keyword) return setError({ message: 'Add the primary keyword.' });
    setBusy(true);
    try {
      const r = await api('audit', body);
      navigate('/audits/' + encodeURIComponent(r.audit_id));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="New audit" title="Audit an article" description="Score an article out of 100 for accuracy, readability, keywords, missing sections and originality. Results are ready in 1–3 minutes." />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <form onSubmit={submit} noValidate>
            <CardContent className="space-y-6 pt-5 sm:pt-6">
              <Tabs value={mode} onValueChange={setMode}>
                <TabsList aria-label="Article source">
                  <TabsTrigger value="url"><Link2 />From URL</TabsTrigger>
                  <TabsTrigger value="paste"><FileText />Paste text</TabsTrigger>
                </TabsList>
                <TabsContent value="url" className="space-y-2">
                  <Label htmlFor="url">Article URL</Label>
                  <Input id="url" type="url" inputMode="url" placeholder="https://yourblog.com/composting-at-home" value={form.url} onChange={set('url')} autoComplete="url" />
                  <p className="text-xs text-muted-foreground">If the site blocks automated reading, switch to Paste text.</p>
                </TabsContent>
                <TabsContent value="paste" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="heading">Heading (H1)</Label>
                    <Input id="heading" placeholder="A beginner's guide to composting at home" value={form.heading} onChange={set('heading')} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between"><Label htmlFor="content">Article text</Label><span className="font-mono text-xs text-muted-foreground tabular">{words.toLocaleString()} words</span></div>
                    <Textarea id="content" rows={12} placeholder={'Paste the full article. Put each subheading on its own line starting with ## (or ### for smaller ones), so every section can be checked against its heading.'} value={form.content} onChange={set('content')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="meta">Meta description <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input id="meta" placeholder="Learn how to compost at home in five simple steps" value={form.meta_description} onChange={set('meta_description')} />
                  </div>
                </TabsContent>
              </Tabs>

              <Separator />

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="keyword">Primary keyword</Label>
                  <Input id="keyword" placeholder="composting at home" value={form.keyword} onChange={set('keyword')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="secondary">Secondary keywords <span className="font-normal text-muted-foreground">(comma-separated)</span></Label>
                  <Input id="secondary" placeholder="compost bin, green waste, brown waste" value={form.secondary} onChange={set('secondary')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="grade">Target reading grade</Label>
                  <NativeSelect id="grade" value={form.target_grade} onChange={set('target_grade')}>
                    <option value="7">Grade 7 · very easy</option>
                    <option value="8">Grade 8</option>
                    <option value="9">Grade 9 · Hemingway default</option>
                    <option value="10">Grade 10</option>
                    <option value="11">Grade 11 · expert readers</option>
                  </NativeSelect>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="market">Search market</Label>
                  <NativeSelect id="market" value={form.market} onChange={set('market')}>
                    <option value="in-en">India · English</option>
                    <option value="us-en">United States · English</option>
                    <option value="gb-en">United Kingdom · English</option>
                    <option value="au-en">Australia · English</option>
                  </NativeSelect>
                </div>
              </div>

              <ErrorNote error={error} />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="lg" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{busy ? 'Starting…' : 'Run audit'}{busy ? null : <ArrowRight />}</Button>
                <span className="text-sm text-muted-foreground">Takes about 1–3 minutes.</span>
              </div>
            </CardContent>
          </form>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Scoring rubric</CardTitle><CardDescription>100 points across five parameters.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {PARAMS.map((p) => (
                <div key={p.key} className="flex gap-3">
                  <span className="grid h-9 w-11 shrink-0 place-items-center rounded-md bg-accent font-mono text-sm font-semibold text-accent-foreground tabular">{p.max}</span>
                  <div><div className="text-sm font-medium">{p.long}</div><div className="text-xs text-muted-foreground">{RUBRIC[p.key]}</div></div>
                </div>
              ))}
              <Separator />
              <p className="text-xs text-muted-foreground">Sent to review if the total is below the pass mark, a claim is contradicted by a source, copied sentences are found, or a check couldn't run.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Checks for this audit</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                <Check2 on>Readability and keyword analysis</Check2>
                <Check2 on={!h || h.mock || (h.required && h.required.GROQ_API_KEY)}>AI relevancy and intent review</Check2>
                <Check2 on={serp}>Claims fact-checked on Google</Check2>
                <Check2 on={serp}>Comparison with top-ranking pages</Check2>
                <Check2 on={serp || (h && h.optional && h.optional.COPYSCAPE)}>Plagiarism check</Check2>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
