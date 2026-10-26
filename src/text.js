// Shared text helpers. Plain functions only (no imports) so the build
// script can inline this file into n8n Code nodes.

export function decodeEntities(s) {
  if (!s) return '';
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCode(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (named[n.toLowerCase()] !== undefined ? named[n.toLowerCase()] : m));
}

function safeFromCode(n) {
  try { return String.fromCodePoint(n); } catch (e) { return ''; }
}

export function collapseWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Words: runs of letters/digits, allowing inner apostrophes and hyphens.
export function tokenizeWords(text) {
  const m = String(text || '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m || [];
}

export function countLetters(word) {
  const m = String(word).match(/[\p{L}\p{N}]/gu);
  return m ? m.length : 0;
}

// Sentence split on . ! ? (and runs of them) followed by whitespace or end,
// plus hard line breaks. Common abbreviations are protected first.
export function splitSentences(text) {
  const abbrev = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|inc|ltd|no|approx|fig)\./gi;
  const protectedText = String(text || '').replace(abbrev, (m) => m.replace(/\./g, '§'));
  const parts = protectedText
    .split(/(?<=[.!?…])["'”’)]*\s+|\n+/u)
    .map((s) => collapseWhitespace(s.replace(/§/g, '.')))
    .filter((s) => tokenizeWords(s).length > 0);
  return parts;
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Case-insensitive whole-phrase count with flexible whitespace/hyphens.
export function countPhrase(text, phrase) {
  const words = tokenizeWords(phrase);
  if (!words.length) return 0;
  const pattern = words.map(escapeRegExp).join('[\\s\\-]+');
  const re = new RegExp('(?<![\\p{L}\\p{N}])' + pattern + '(?![\\p{L}\\p{N}])', 'giu');
  const m = String(text || '').match(re);
  return m ? m.length : 0;
}

export function containsPhrase(text, phrase) {
  return countPhrase(text, phrase) > 0;
}

export function firstNWords(text, n) {
  return tokenizeWords(text).slice(0, n).join(' ');
}

export function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

export function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
