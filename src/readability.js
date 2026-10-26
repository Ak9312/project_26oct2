// Hemingway-style readability. Hemingway has no public API, so this rebuilds
// its approach: Automated Readability Index (ARI) for the grade, plus
// sentence-level "hard / very hard" flags, passive voice, adverbs and
// complex phrases. Thresholds are ours and meant to be tuned against the
// real Hemingway score during validation.
// Depends on text.js.

const IRREGULAR_PARTICIPLES = [
  'arisen', 'awoken', 'been', 'beaten', 'become', 'begun', 'bent', 'bet', 'bitten', 'blown', 'broken', 'brought',
  'built', 'burnt', 'bought', 'caught', 'chosen', 'come', 'cost', 'cut', 'dealt', 'done', 'drawn', 'driven', 'drunk',
  'eaten', 'fallen', 'fed', 'felt', 'fought', 'found', 'flown', 'forbidden', 'forgotten', 'forgiven', 'frozen',
  'gotten', 'given', 'gone', 'grown', 'hung', 'heard', 'hidden', 'hit', 'held', 'hurt', 'kept', 'known', 'laid',
  'led', 'left', 'lent', 'let', 'lain', 'lit', 'lost', 'made', 'meant', 'met', 'paid', 'put', 'read', 'ridden',
  'rung', 'risen', 'run', 'said', 'seen', 'sought', 'sold', 'sent', 'set', 'shaken', 'shot', 'shown', 'shut',
  'sung', 'sunk', 'sat', 'slept', 'spoken', 'spent', 'spread', 'stood', 'stolen', 'stuck', 'struck', 'sworn',
  'swept', 'swum', 'taken', 'taught', 'torn', 'told', 'thought', 'thrown', 'understood', 'woken', 'worn', 'won',
  'written',
];

const NOT_ADVERBS = new Set([
  'only', 'family', 'reply', 'apply', 'supply', 'early', 'daily', 'weekly', 'monthly', 'yearly', 'holy', 'ugly',
  'belly', 'jelly', 'rally', 'ally', 'italy', 'july', 'fly', 'butterfly', 'friendly', 'lovely', 'likely',
  'lonely', 'silly', 'curly', 'chilly', 'costly', 'elderly', 'fly', 'imply', 'multiply', 'rely', 'comply',
  'assembly', 'anomaly', 'monopoly', 'jolly', 'bully', 'lily', 'ply', 'sly', 'emily', 'kelly', 'billy', 'molly',
  'lively', 'deadly', 'orderly', 'scholarly', 'timely', 'homely', 'manly', 'womanly', 'bodily', 'oily', 'hilly',
  'woolly', 'smelly', 'bubbly', 'wiggly', 'reply', 'firefly', 'dragonfly', 'gadfly', 'italy', 'sicily',
]);

const COMPLEX_PHRASES = {
  'in order to': 'to',
  'utilize': 'use',
  'utilise': 'use',
  'utilization': 'use',
  'due to the fact that': 'because',
  'at this point in time': 'now',
  'in the event that': 'if',
  'a large number of': 'many',
  'a majority of': 'most',
  'prior to': 'before',
  'subsequent to': 'after',
  'in close proximity': 'near',
  'with regard to': 'about',
  'in regard to': 'about',
  'commence': 'start',
  'facilitate': 'help',
  'endeavor': 'try',
  'endeavour': 'try',
  'additional': 'more',
  'approximately': 'about',
  'demonstrate': 'show',
  'sufficient': 'enough',
  'numerous': 'many',
};

export function ariGrade(chars, words, sentences) {
  if (!words || !sentences) return 0;
  return 4.71 * (chars / words) + 0.5 * (words / sentences) - 21.43;
}

function sentenceStats(sentence) {
  const words = tokenizeWords(sentence);
  const chars = words.reduce((n, w) => n + countLetters(w), 0);
  return { words: words.length, chars, grade: ariGrade(chars, words.length, 1) };
}

export function countPassive(text) {
  const participle = '(?:[\\p{L}]+ed|' + IRREGULAR_PARTICIPLES.join('|') + ')';
  const re = new RegExp(
    '(?<![\\p{L}])(?:am|is|are|was|were|be|been|being|is not|are not|was not|were not|isn\'t|aren\'t|wasn\'t|weren\'t)\\s+(?:[\\p{L}]+ly\\s+)?' + participle + '(?![\\p{L}])',
    'giu'
  );
  const m = String(text || '').match(re);
  return m ? m.length : 0;
}

export function findAdverbs(text) {
  return tokenizeWords(text).filter((w) => {
    const lw = w.toLowerCase();
    return lw.length > 4 && lw.endsWith('ly') && !NOT_ADVERBS.has(lw);
  });
}

export function findComplexPhrases(text) {
  const found = [];
  for (const phrase of Object.keys(COMPLEX_PHRASES)) {
    const n = countPhrase(text, phrase);
    if (n) found.push({ phrase, suggestion: COMPLEX_PHRASES[phrase], count: n });
  }
  return found;
}

export function analyzeReadability(text, targetGrade) {
  const target = Number.isFinite(Number(targetGrade)) && Number(targetGrade) > 0 ? Number(targetGrade) : 9;
  const sentences = splitSentences(text);
  const allWords = tokenizeWords(text);
  const chars = allWords.reduce((n, w) => n + countLetters(w), 0);
  const grade = Math.max(0, round1(ariGrade(chars, allWords.length, sentences.length || 1)));

  let hard = 0;
  let veryHard = 0;
  let hardest = null;
  for (const s of sentences) {
    const st = sentenceStats(s);
    if (st.words >= 14 && st.grade >= 14) veryHard += 1;
    else if (st.words >= 14 && st.grade >= 10) hard += 1;
    if (st.words >= 14 && st.grade >= 10 && (!hardest || st.grade > hardest.grade)) {
      hardest = { text: s.length > 320 ? s.slice(0, 317) + '…' : s, grade: round1(st.grade) };
    }
  }

  const passive = countPassive(text);
  const adverbs = findAdverbs(text);
  const complex = findComplexPhrases(text);
  const n = sentences.length || 1;
  const per100 = allWords.length ? (adverbs.length / allWords.length) * 100 : 0;

  const gradePts = Math.max(0, Math.round(8 - 2 * Math.max(0, grade - target)));
  const hardRatio = (hard + veryHard) / n;
  const hardPts = hardRatio <= 0.1 ? 6 : Math.max(0, Math.round(6 * (1 - (hardRatio - 0.1) / 0.3)));
  const passiveRatio = passive / n;
  const passivePts = passiveRatio <= 0.05 ? 3 : passiveRatio <= 0.1 ? 2 : passiveRatio <= 0.15 ? 1 : 0;
  const adverbPts = per100 <= 1 ? 3 : per100 <= 2 ? 2 : per100 <= 3 ? 1 : 0;

  return {
    grade,
    target_grade: target,
    words: allWords.length,
    sentences: sentences.length,
    hard_sentences: hard,
    very_hard_sentences: veryHard,
    passive,
    adverbs: adverbs.length,
    adverbs_per_100_words: round1(per100),
    complex_phrases: complex,
    hardest_sentence: hardest,
    points: { grade: gradePts, hard_sentences: hardPts, passive: passivePts, adverbs: adverbPts },
    score: gradePts + hardPts + passivePts + adverbPts,
    max: 20,
  };
}
