import { mountHeader, data, esc, fmtDate, bar, fmtNum, showError } from '../app.js';

mountHeader('');

const id = new URLSearchParams(location.search).get('id') || '';
const box = document.getElementById('report');
const started = Date.now();
const MAX_WAIT_MS = 6 * 60 * 1000;

const CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2346D8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
const CROSS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C2410C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const DASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B5F68" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>';

function running() {
  const secs = Math.round((Date.now() - started) / 1000);
  box.innerHTML = `
    <section class="card running" aria-live="polite">
      <div class="spinner" aria-hidden="true"></div>
      <h1 style="margin:0;font-size:22px;font-weight:600">Auditing… ${secs}s</h1>
      <p class="muted" style="margin:0">This page updates by itself. The workflow:</p>
      <ol class="steps">
        <li>Reads the article and scores readability</li>
        <li>Asks the AI model on Groq to check each heading against its section and pull out factual claims</li>
        <li>Searches each claim and keeps only verdicts backed by a search result</li>
        <li>Compares your outline with the top-ranking pages for the keyword</li>
        <li>Runs the Copyscape plagiarism check, then saves the result to your Sheet</li>
      </ol>
      <p class="muted" style="margin:0;font-size:13px">Audit ID <span class="mono">${esc(id)}</span></p>
    </section>`;
}

function timedOut() {
  box.innerHTML = `
    <section class="card">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:600">No result after 6 minutes</h1>
      <p style="margin:0 0 12px">The audit probably stopped with an error. Open <b style="font-weight:500">Executions</b> in n8n for the
      “Content Auditor · audit pipeline” workflow to see which step failed. A common cause is a site that blocks
      fetching; paste the content instead.</p>
      <div class="actions"><a class="btn" href="/">Start a new audit</a><button class="btn" type="button" id="retry">Check again</button></div>
    </section>`;
  document.getElementById('retry').addEventListener('click', () => location.reload());
}

async function poll() {
  if (!id) { box.innerHTML = '<div class="form-error">No audit ID in the link.</div>'; return; }
  try {
    const r = await data('get', { audit_id: id });
    if (r.audit && r.report) return render(r);
    if (r.audit && !r.report) { box.innerHTML = '<div class="form-error">The saved report could not be read from the Sheet.</div>'; return; }
    if (Date.now() - started > MAX_WAIT_MS) return timedOut();
    running();
    setTimeout(poll, 5000);
  } catch (err) {
    showError(box, err);
  }
}

function ring(total, pass) {
  const r = 72;
  const c = 2 * Math.PI * r;
  const color = total < pass ? '#C2410C' : '#2346D8';
  return `
    <div class="ring">
      <svg width="168" height="168" viewBox="0 0 168 168" role="img" aria-label="Score ${total} out of 100">
        <circle cx="84" cy="84" r="${r}" fill="none" stroke="#ECECE7" stroke-width="14"/>
        <circle cx="84" cy="84" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="${((total / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 84 84)"/>
      </svg>
      <div class="center"><span class="big">${total}</span><span class="muted" style="font-size:13px;margin-top:4px">of 100 · pass at ${pass}</span></div>
    </div>`;
}

function card(anchor, name, score, max, note, warn) {
  return `<a class="score-card" href="#${anchor}"><div class="name">${name}</div>
    <div class="val">${score}<small>/${max}</small></div>${bar(score, max, 60)}
    <div class="note${warn ? ' warn' : ''}">${note}</div></a>`;
}

function claimPill(status) {
  if (status === 'verified') return '<span class="pill ok">Verified</span>';
  if (status === 'false') return '<span class="pill bad">False</span>';
  return '<span class="pill neutral">Unverified</span>';
}

// The article couldn't be fetched or read, so nothing was scored.
function renderFailed(rep) {
  document.title = 'Audit failed · Content Auditor';
  box.innerHTML = `
    <section class="card" role="alert">
      <span class="muted" style="font-size:13px">${fmtDate(rep.created_at)} · audit <span class="mono">${esc(rep.audit_id)}</span></span>
      <h1 style="margin:6px 0 12px;font-size:24px;font-weight:600">The audit couldn't run</h1>
      <p class="form-error" style="margin:0 0 16px">${esc(rep.error)}</p>
      <div class="actions"><a class="btn primary" href="/">Try again</a></div>
    </section>`;
}

function render(r) {
  const rep = r.report;
  if (!rep.parameters) return renderFailed(rep);
  const p = rep.parameters;
  const A = p.accuracy;
  const R = p.readability;
  const K = p.keywords;
  const S = p.sections;
  const P = p.plagiarism;
  const failed = rep.status === 'error';
  const needs = rep.status === 'needs_review' || failed;
  document.title = (rep.article.title || 'Audit report') + ' · Content Auditor';

  const missing = S.topics.filter((t) => t.coverage !== 'covered').length;
  box.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:24px">
    <section class="card hero">
      <div class="grow">
        <span class="muted" style="font-size:13px">${fmtDate(rep.created_at)} · ${esc(rep.article.word_count.toLocaleString())} words · ${rep.article.source === 'url' ? 'from URL' : 'pasted'}</span>
        <h1>${esc(rep.article.title || rep.input.keyword)}</h1>
        ${rep.article.url ? `<a href="${esc(rep.article.url)}" rel="noopener" target="_blank" style="font-size:14px;overflow-wrap:anywhere">${esc(rep.article.url)}</a>` : ''}
        <div class="pills" style="margin-top:12px;font-size:13px">
          <span class="pill neutral">Keyword: ${esc(rep.input.keyword)}</span>
          <span class="pill neutral">${esc(rep.input.market_label)}</span>
          <span class="pill neutral">Target grade ${esc(rep.input.target_grade)}</span>
        </div>
        <div class="verdict ${needs ? 'warn' : 'ok'}">
          ${needs ? `<b style="font-weight:600">${failed ? "Audit incomplete: a step couldn't run, so these scores are partial. It was sent to human review." : 'Sent to human review.'}</b><ul>${rep.review_reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
                 : '<b style="font-weight:600">Passed.</b> No hard flags and the total is at or above the pass mark.'}
        </div>
      </div>
      <div class="ring-wrap">
        ${ring(rep.total, rep.pass_mark)}
        <div class="actions" style="justify-content:center">
          ${needs ? '<a class="btn primary" href="/review.html">Open review queue</a>' : ''}
          <a class="btn" href="#my-scores">Add my scores</a>
        </div>
      </div>
    </section>

    <div class="score-grid">
      ${card('accuracy', 'Accuracy', A.score, 30, A.claim_counts.false ? A.claim_counts.false + ' false claim' + (A.claim_counts.false > 1 ? 's' : '') : A.claim_counts.total + ' claims checked', A.claim_counts.false > 0)}
      ${card('readability', 'Readability', R.score, 20, 'Grade ' + fmtNum(R.grade, 1) + ' · target ' + R.target_grade)}
      ${card('keywords', 'Keywords', K.score, 20, 'Density ' + fmtNum(K.density, 1) + '%')}
      ${card('sections', 'Missing sections', S.score, 20, S.competitor_count ? missing + ' subtopic' + (missing === 1 ? '' : 's') + ' missing or thin' : 'Not checked', missing > 0 || !S.competitor_count)}
      ${card('plagiarism', 'Plagiarism', P.score, 10, P.checked ? fmtNum(P.percent, 1) + '% match' : 'Not checked', !P.checked || P.percent > 15)}
    </div>

    <section class="card" id="accuracy">
      <div class="card-head"><h2>Accuracy and relevancy</h2>
        <span class="sub">Relevancy ${A.points.relevancy}/10 · Claims ${A.points.claims}/12 · Freshness ${A.points.freshness}/5 · Title promise ${A.points.title_promise}/3</span></div>
      <div class="row">
        <div class="half">
          <h3>Heading ↔ content match</h3>
          ${A.sections.length ? `<div class="table-wrap"><table class="plain" style="min-width:420px">
            <thead><tr><th>Heading</th><th>Score</th><th>Note</th></tr></thead>
            <tbody>${A.sections.map((s) => `<tr class="${s.score !== null && s.score <= 5 ? 'hot' : ''}">
              <td>${esc(s.heading)}</td><td class="mono">${s.score === null ? '—' : s.score}</td><td style="color:var(--ink-2)">${esc(s.note)}</td></tr>`).join('')}</tbody>
          </table></div>` : '<p class="muted">No H2/H3 headings were found, so sections could not be matched.</p>'}
          <p class="muted" style="font-size:13px;margin:12px 0 0">Title: ${esc(A.title_note || '—')}<br>Freshness: ${esc(A.freshness_note || '—')}</p>
        </div>
        <div class="half">
          <h3>Claims checked against search results</h3>
          ${A.claims.length ? `<div class="claims">${A.claims.map((c) => `
            <div class="claim${c.status === 'false' ? ' false' : ''}">${claimPill(c.status)}
              <span>${esc(c.claim)}${c.evidence ? `<span class="why">${esc(c.evidence)}</span>` : ''}
              ${c.source_url ? `<span class="why"><a href="${esc(c.source_url)}" target="_blank" rel="noopener">Source</a></span>` : ''}</span>
            </div>`).join('')}</div>`
          : '<p class="muted">No checkable factual claims were found.</p>'}
          <p class="muted" style="font-size:13px;margin:12px 0 0">A verdict only counts when it is backed by one of the search results; otherwise the claim stays unverified.</p>
        </div>
      </div>
    </section>

    <div class="row">
      <section class="card half" id="readability">
        <div class="card-head"><h2>Readability</h2><span class="muted" style="font-size:13px">Hemingway-style · ARI grade</span></div>
        <div class="stats">
          <div class="stat"><div class="k">Grade level</div><div class="v">${fmtNum(R.grade, 1)}</div><div class="s">${R.points.grade}/8 pts</div></div>
          <div class="stat"><div class="k">Hard sentences</div><div class="v">${R.hard_sentences + R.very_hard_sentences} / ${R.sentences}</div><div class="s">${R.very_hard_sentences} very hard · ${R.points.hard_sentences}/6 pts</div></div>
          <div class="stat"><div class="k">Passive voice</div><div class="v">${R.passive}</div><div class="s">${R.points.passive}/3 pts</div></div>
          <div class="stat"><div class="k">Adverbs</div><div class="v">${R.adverbs}</div><div class="s">${fmtNum(R.adverbs_per_100_words, 1)} per 100 words · ${R.points.adverbs}/3 pts</div></div>
        </div>
        ${R.hardest_sentence ? `<div style="margin-top:18px"><div class="label" style="margin-bottom:6px">Hardest sentence (grade ${fmtNum(R.hardest_sentence.grade, 1)})</div><p class="quote">${esc(R.hardest_sentence.text)}</p></div>` : ''}
        ${R.complex_phrases.length ? `<div style="margin-top:16px"><div class="label" style="margin-bottom:6px">Simpler words</div><div class="pills">${R.complex_phrases.map((c) => `<span class="pill neutral">${esc(c.phrase)} → ${esc(c.suggestion)}${c.count > 1 ? ' ×' + c.count : ''}</span>`).join('')}</div></div>` : ''}
      </section>

      <section class="card half" id="keywords">
        <div class="card-head"><h2>Keywords</h2>
          <span class="sub">Placement ${K.points.placement}/6 · Density ${K.points.density}/4 · Related ${K.points.related}/6 · Intent ${K.points.intent}/4</span></div>
        <div class="checks">${K.placement.map((c) => `<div class="check${!c.applies ? ' na' : c.pass ? '' : ' fail'}">${!c.applies ? DASH : c.pass ? CHECK : CROSS}${esc(c.label)}${!c.applies ? ' (none given)' : ''}</div>`).join('')}</div>
        <p style="font-size:14px;margin:16px 0 0">“${esc(K.keyword)}” appears ${K.occurrences} time${K.occurrences === 1 ? '' : 's'} · density ${fmtNum(K.density, 1)}% <span class="muted">(target 0.5–2.5%)</span></p>
        ${K.terms.length ? `<div style="margin-top:16px"><div class="label" style="margin-bottom:8px">Related terms</div><div class="pills">${K.terms.map((t) => `<span class="pill ${t.covered ? 'ok' : 'warn'}">${esc(t.term)} · ${t.covered ? 'covered' : 'missing'}</span>`).join('')}</div>
          <p class="muted" style="font-size:13px;margin:8px 0 0">Coverage is checked in the text itself, not taken from the AI.</p></div>` : ''}
        ${K.intent.expected || K.intent.note ? `<p style="font-size:14px;margin:16px 0 0">Intent: ${esc(K.intent.expected || '—')}. ${esc(K.intent.note)}</p>` : ''}
      </section>
    </div>

    <div class="row">
      <section class="card grow" id="sections">
        <div class="card-head"><h2>Missing sections</h2>
          <span class="sub">Coverage ${S.points.coverage === null ? '—' : S.points.coverage}/12 · Structure ${S.points.structure}/4 · Depth ${S.points.depth === null ? '—' : S.points.depth}/4</span></div>
        ${S.competitor_count ? `<p class="muted" style="margin:0 0 12px;font-size:14px">Compared with the headings of ${S.competitor_count} top-ranking page${S.competitor_count === 1 ? '' : 's'}.</p>
          ${S.topics.length ? `<div class="list-rows">${S.topics.map((t) => `<div><span style="font-weight:500">${esc(t.subtopic)}</span>
            <span style="color:${t.coverage === 'missing' ? 'var(--warn-ink)' : t.coverage === 'thin' ? 'var(--ink-2)' : 'var(--accent-ink)'}">${t.coverage === 'covered' ? 'Covered' : t.coverage === 'thin' ? 'Thin' : 'Missing'} · in ${t.found_in} of ${S.competitor_count}</span></div>`).join('')}</div>`
          : '<p class="muted">No subtopic appeared often enough across the top pages to count.</p>'}`
        : '<p class="muted">No competitor pages could be fetched, so coverage was not checked.</p>'}
        <div class="checks" style="margin-top:16px">
          ${[['intro', 'Intro of 40+ words'], ['conclusion', 'Conclusion or summary'], ['faq', 'FAQ section'], ['enough_h2', '3 or more H2 sections']].map(([k, l]) => `<div class="check${S.structure[k] ? '' : ' fail'}">${S.structure[k] ? CHECK : CROSS}${l}</div>`).join('')}
        </div>
        <p style="font-size:14px;margin:14px 0 0">Length: ${S.word_count.toLocaleString()} words${S.competitor_median_words ? ' against a top-page median of ' + S.competitor_median_words.toLocaleString() : ''}.</p>
      </section>

      <section class="card side" id="plagiarism">
        <h2>Plagiarism</h2>
        ${P.checked ? `
          <div style="display:flex;align-items:baseline;gap:10px"><span class="mono" style="font-size:34px;font-weight:500">${fmtNum(P.percent, 1)}%</span><span class="muted">matched text</span></div>
          <div style="margin:12px 0 6px">${bar(Math.min(P.percent, 20), 20, 0)}</div>
          <div class="mono muted" style="display:flex;justify-content:space-between;font-size:12px"><span>0</span><span>5</span><span>10</span><span>15</span><span>20+</span></div>
          <div class="list-rows" style="margin-top:14px">${P.sources.length ? P.sources.map((s) => `<div><a href="${esc(s.url)}" target="_blank" rel="noopener" style="overflow-wrap:anywhere">${esc(s.title || s.url)}</a><span class="muted">${s.percent !== null ? s.percent + '%' : (s.words || '?') + ' words'}</span></div>`).join('') : '<div><span class="muted">No matching pages found</span></div>'}</div>`
        : `<p class="form-error" style="margin:0">The Copyscape check didn't run${P.error ? ': ' + esc(P.error) : ''}. The article was sent to review.</p>`}
        <p class="muted" style="font-size:13px;margin:12px 0 0">Copyscape internet search, full comparison.</p>
      </section>
    </div>

    <section class="card" id="my-scores">
      <div class="card-head"><h2>My scores (validation)</h2><span class="muted" style="font-size:13px">For the 30-article test</span></div>
      <p class="muted" style="margin:0 0 16px;font-size:14px">Score this article yourself with the same rubric, before looking closely at the numbers above. These go to the Validation tab and are compared with the workflow's scores.</p>
      <form id="my-form" class="form" novalidate>
        <div class="grid-2" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          ${[['my_accuracy', 'Accuracy', 30], ['my_readability', 'Readability', 20], ['my_keywords', 'Keywords', 20], ['my_sections', 'Missing sections', 20], ['my_plagiarism', 'Plagiarism', 10]].map(([k, l, m]) => `
            <div class="field"><label for="${k}">${l} <span class="muted">/ ${m}</span></label>
            <input id="${k}" name="${k}" type="number" min="0" max="${m}" step="1" inputmode="numeric" value="${r.validation && r.validation[k] !== '' && r.validation[k] !== undefined ? esc(r.validation[k]) : ''}"></div>`).join('')}
        </div>
        <div id="my-msg"></div>
        <div class="actions"><button class="btn primary" type="submit">Save my scores</button><span class="muted" id="my-total" style="font-size:14px"></span></div>
      </form>
    </section>
  </div>`;

  const myForm = document.getElementById('my-form');
  const msg = document.getElementById('my-msg');
  const total = () => {
    const vals = [...myForm.querySelectorAll('input')].map((i) => Number(i.value));
    const all = [...myForm.querySelectorAll('input')].every((i) => i.value !== '');
    document.getElementById('my-total').textContent = all ? 'Your total: ' + vals.reduce((a, b) => a + b, 0) + '/100' : '';
  };
  myForm.addEventListener('input', () => { msg.innerHTML = ''; total(); });
  total();
  myForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { audit_id: id };
    for (const input of myForm.querySelectorAll('input')) {
      const v = input.value;
      const n = Number(v);
      if (v === '' || !Number.isInteger(n) || n < 0 || n > Number(input.max)) {
        msg.innerHTML = `<div class="form-error" role="alert">Enter a whole number from 0 to ${input.max} for ${esc(input.labels[0].firstChild.textContent.trim())}.</div>`;
        input.focus();
        return;
      }
      body[input.name] = n;
    }
    try {
      const out = await data('validation_save', body);
      msg.innerHTML = `<div class="verdict ok" role="status" style="margin:0">Saved. Your total is ${out.my_total}/100.</div>`;
    } catch (err) {
      showError(msg, err);
    }
  });
}

poll();
