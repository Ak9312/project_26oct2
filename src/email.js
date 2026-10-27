// Builds the Gmail API "raw" message for the human-review alert, without
// relying on Buffer (not guaranteed inside n8n Code nodes).

function utf8Bytes(str) {
  const bytes = [];
  for (const ch of String(str)) {
    let cp = ch.codePointAt(0);
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return bytes;
}

export function base64Encode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const b = utf8Bytes(str);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += i + 1 < b.length ? chars[(n >> 6) & 63] : '=';
    out += i + 2 < b.length ? chars[n & 63] : '=';
  }
  return out;
}

export function base64Url(str) {
  return base64Encode(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildAlertEmail(report, to, appUrl) {
  const p = report.parameters;
  const title = report.article.title || report.input.keyword;
  const link = appUrl ? String(appUrl).replace(/\/+$/, '') + '/report.html?id=' + encodeURIComponent(report.audit_id) : '';
  const rows = [
    ['Accuracy and relevancy', p.accuracy.score, 30],
    ['Readability', p.readability.score, 20],
    ['Keywords', p.keywords.score, 20],
    ['Missing sections', p.sections.score, 20],
    ['Plagiarism', p.plagiarism.score, 10],
  ];
  const failed = report.status === 'error';
  const html = [
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#15171C">',
    '<p>' + (failed ? "An audit couldn't finish every check. Its scores are incomplete." : 'An article needs your review.') + '</p>',
    '<p style="font-size:18px;margin:0 0 4px"><b>' + esc(title) + '</b></p>',
    report.article.url ? '<p style="margin:0 0 12px"><a href="' + esc(report.article.url) + '">' + esc(report.article.url) + '</a></p>' : '',
    '<p style="font-size:16px">Score: <b>' + report.total + '/100</b> (pass mark ' + report.pass_mark + ')</p>',
    '<p><b>Why it was flagged</b></p><ul>' + report.review_reasons.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>',
    '<table cellpadding="6" style="border-collapse:collapse">' + rows.map((r) => '<tr><td>' + r[0] + '</td><td align="right">' + r[1] + '/' + r[2] + '</td></tr>').join('') + '</table>',
    link ? '<p><a href="' + esc(link) + '">Open the full report</a></p>' : '',
    '<p style="color:#5B5F68;font-size:13px">Audit ' + esc(report.audit_id) + '</p>',
    '</div>',
  ].join('');
  const subject = (failed ? 'Audit incomplete: ' : 'Review needed: ') + title + ' (' + report.total + '/100)';
  const mime = [
    'To: ' + to,
    'Subject: =?UTF-8?B?' + base64Encode(subject) + '?=',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Encode(html),
  ].join('\r\n');
  return { raw: base64Url(mime), subject };
}
