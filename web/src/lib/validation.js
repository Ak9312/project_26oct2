// Compares your manual scores with the workflow's scores.
// Used by the Validation page and by the unit tests.

export const PARAMS = [
  { key: 'accuracy', label: 'Accuracy and relevancy', max: 30 },
  { key: 'readability', label: 'Readability', max: 20 },
  { key: 'keywords', label: 'Keywords', max: 20 },
  { key: 'sections', label: 'Missing sections', max: 20 },
  { key: 'plagiarism', label: 'Originality (plagiarism)', max: 10 },
];

function num(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
}

export function pearson(xs, ys) {
  if (xs.length < 3 || xs.length !== ys.length) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (!sxx || !syy) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

// pairs: [{ audit_id, title, ai: {total, accuracy, ...}, me: {total?, accuracy, ...} }]
export function computeValidation(pairs, passMark) {
  const pm = Number(passMark) || 70;
  const usable = [];
  for (const p of pairs || []) {
    const me = {};
    let parts = 0;
    for (const prm of PARAMS) {
      me[prm.key] = num(p.me && p.me[prm.key]);
      if (Number.isFinite(me[prm.key])) parts += 1;
    }
    me.total = num(p.me && p.me.total);
    if (!Number.isFinite(me.total) && parts === PARAMS.length) {
      me.total = PARAMS.reduce((s, prm) => s + me[prm.key], 0);
    }
    const ai = {};
    for (const prm of PARAMS) ai[prm.key] = num(p.ai && p.ai[prm.key]);
    ai.total = num(p.ai && p.ai.total);
    if (Number.isFinite(me.total) && Number.isFinite(ai.total)) usable.push({ id: p.audit_id, title: p.title, ai, me });
  }

  const totalsAi = usable.map((u) => u.ai.total);
  const totalsMe = usable.map((u) => u.me.total);
  const gaps = usable.map((u) => u.ai.total - u.me.total);
  const agree = usable.filter((u) => (u.ai.total >= pm) === (u.me.total >= pm)).length;

  const byParam = PARAMS.map((prm) => {
    const both = usable.filter((u) => Number.isFinite(u.ai[prm.key]) && Number.isFinite(u.me[prm.key]));
    const d = both.map((u) => u.ai[prm.key] - u.me[prm.key]);
    return {
      key: prm.key,
      label: prm.label,
      max: prm.max,
      n: both.length,
      ai_avg: mean(both.map((u) => u.ai[prm.key])),
      my_avg: mean(both.map((u) => u.me[prm.key])),
      mae: mean(d.map(Math.abs)),
      bias: mean(d),
    };
  });

  return {
    n: usable.length,
    pass_mark: pm,
    mae_total: mean(gaps.map(Math.abs)),
    bias_total: mean(gaps),
    pearson_total: pearson(totalsAi, totalsMe),
    agreement: agree,
    by_param: byParam,
    pairs: usable,
  };
}
