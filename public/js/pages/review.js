import { mountHeader, setPendingCount, data, esc, fmtDate, fmtNum, showError } from '../app.js';
import { computeValidation } from '../validation.js';

mountHeader(location.hash === '#validation' ? 'validation' : 'review');

const queue = document.getElementById('queue');
const val = document.getElementById('val');

function decisionPill(d) {
  if (d === 'approved') return '<span class="pill ok">Approved</span>';
  if (d === 'sent_back') return '<span class="pill warn">Sent back</span>';
  return '<span class="pill neutral">Pending</span>';
}

async function loadQueue() {
  try {
    const r = await data('review_list');
    const pending = r.items.filter((i) => i.decision === 'pending').length;
    setPendingCount(pending);
    if (!r.items.length) {
      queue.innerHTML = '<div class="empty">Nothing to review. Articles that score below the pass mark or get a hard flag show up here.</div>';
      return;
    }
    queue.innerHTML = `<div class="table-wrap"><table style="min-width:980px">
      <thead><tr><th>Article</th><th>AI score</th><th>Why it's here</th><th>Your score</th><th>Notes</th><th>Decision</th></tr></thead>
      <tbody>${r.items.map((it, i) => `
        <tr data-id="${esc(it.audit_id)}">
          <td><a href="/report.html?id=${encodeURIComponent(it.audit_id)}" style="font-weight:500;text-decoration:none">${esc(it.title || it.url || it.audit_id)}</a>
            <div class="muted" style="font-size:13px;margin-top:2px">${fmtDate(it.created_at)}</div></td>
          <td class="mono" style="font-weight:500">${esc(it.total)}</td>
          <td><div class="pills">${it.review_reasons.map((x) => `<span class="pill warn">${esc(x)}</span>`).join('')}</div></td>
          <td><label class="sr-only" for="score-${i}">Your score for ${esc(it.title)}</label>
            <input id="score-${i}" class="score mono" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="—" value="${it.reviewer_score === null ? '' : esc(it.reviewer_score)}" style="width:80px;height:40px"></td>
          <td><label class="sr-only" for="notes-${i}">Notes for ${esc(it.title)}</label>
            <input id="notes-${i}" class="notes" type="text" maxlength="1000" placeholder="Optional" value="${esc(it.notes)}" style="height:40px;min-width:160px"></td>
          <td><div class="actions" style="gap:8px">
            <button class="btn primary small" type="button" data-decision="approved">Approve</button>
            <button class="btn small" type="button" data-decision="sent_back">Send back</button>
            <span class="state">${decisionPill(it.decision)}</span></div>
            <div class="row-msg" style="font-size:13px;margin-top:6px"></div></td>
        </tr>`).join('')}</tbody></table></div>`;
    queue.querySelectorAll('button[data-decision]').forEach((b) => b.addEventListener('click', () => save(b)));
  } catch (err) {
    showError(queue, err);
  }
}

async function save(btn) {
  const tr = btn.closest('tr');
  const msg = tr.querySelector('.row-msg');
  const scoreRaw = tr.querySelector('.score').value;
  const score = scoreRaw === '' ? null : Number(scoreRaw);
  if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) {
    msg.innerHTML = '<span class="field-error">Score must be a whole number from 0 to 100.</span>';
    tr.querySelector('.score').focus();
    return;
  }
  btn.setAttribute('aria-busy', 'true');
  try {
    await data('review_save', { audit_id: tr.dataset.id, decision: btn.dataset.decision, reviewer_score: score, notes: tr.querySelector('.notes').value });
    tr.querySelector('.state').innerHTML = decisionPill(btn.dataset.decision);
    msg.innerHTML = '<span class="muted">Saved</span>';
    const left = [...queue.querySelectorAll('.state')].filter((s) => s.textContent.trim() === 'Pending').length;
    setPendingCount(left);
  } catch (err) {
    msg.innerHTML = `<span class="field-error">${esc(err.message)}</span>`;
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

async function loadValidation() {
  try {
    const r = await data('validation');
    const v = computeValidation(r.pairs, r.pass_mark);
    const target = r.target_count || 30;
    const done = v.n;
    const has = done >= 3;
    const pct = Math.min(100, (done / target) * 100);
    const show = (x, d) => (has ? fmtNum(x, d) : '—');
    val.innerHTML = `
      <div style="margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px"><span>Articles scored by you</span><span class="mono">${done} / ${target}</span></div>
        <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        ${done < target ? `<p class="muted" style="font-size:13px;margin:8px 0 0">${done < 3 ? 'Metrics appear once you have scored at least 3 articles.' : 'Keep going: the numbers settle as you approach ' + target + '.'}</p>` : ''}
      </div>
      <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:28px">
        <div class="stat"><div class="k">Average gap, total score</div><div class="v">${show(v.mae_total, 1)}</div><div class="s">Goal: within 5 points</div></div>
        <div class="stat"><div class="k">Correlation</div><div class="v">${show(v.pearson_total, 2)}</div><div class="s">You vs workflow, ${done} pairs</div></div>
        <div class="stat"><div class="k">Pass/fail agreement</div><div class="v">${has ? v.agreement : '—'} / ${done}</div><div class="s">Goal: ${Math.ceil(target * 0.9)} of ${target}</div></div>
        <div class="stat"><div class="k">Workflow bias</div><div class="v">${has ? (v.bias_total > 0 ? '+' : '') + fmtNum(v.bias_total, 1) : '—'}</div><div class="s">${has ? (v.bias_total > 0 ? 'Workflow scores higher than you' : v.bias_total < 0 ? 'Workflow scores lower than you' : 'No bias') : 'Positive = too generous'}</div></div>
      </div>
      <h3 style="font-size:16px">By parameter</h3>
      <div class="table-wrap"><table class="plain" style="min-width:620px">
        <thead><tr><th>Parameter</th><th>Max</th><th>Workflow avg</th><th>Your avg</th><th>Avg gap</th><th>Bias</th></tr></thead>
        <tbody class="mono">${v.by_param.map((b) => `<tr class="${has && b.mae > 3 ? 'hot' : ''}">
          <td style="font-family:var(--sans)">${esc(b.label)}</td><td>${b.max}</td>
          <td>${has ? fmtNum(b.ai_avg, 1) : '—'}</td><td>${has ? fmtNum(b.my_avg, 1) : '—'}</td>
          <td>${has ? fmtNum(b.mae, 1) : '—'}</td><td>${has ? (b.bias > 0 ? '+' : '') + fmtNum(b.bias, 1) : '—'}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted" style="font-size:14px;margin:16px 0 0">Rows over a 3-point average gap are highlighted: tune that parameter's prompt or thresholds, then re-run the test articles.</p>
      ${v.pairs.length ? `<details style="margin-top:18px"><summary style="cursor:pointer;font-size:14px;font-weight:500">Each article (${v.pairs.length})</summary>
        <div class="table-wrap" style="margin-top:10px"><table class="plain" style="min-width:520px">
          <thead><tr><th>Article</th><th>Workflow</th><th>You</th><th>Gap</th></tr></thead>
          <tbody>${v.pairs.map((x) => `<tr><td><a href="/report.html?id=${encodeURIComponent(x.id)}">${esc(x.title || x.id)}</a></td>
            <td class="mono">${x.ai.total}</td><td class="mono">${x.me.total}</td><td class="mono">${(x.ai.total - x.me.total > 0 ? '+' : '') + (x.ai.total - x.me.total)}</td></tr>`).join('')}</tbody>
        </table></div></details>` : ''}`;
  } catch (err) {
    showError(val, err);
  }
}

document.getElementById('refresh-val').addEventListener('click', loadValidation);
loadQueue().then(loadValidation);
