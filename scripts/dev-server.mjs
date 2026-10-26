// Local preview: serves public/ and the api/ routes with a minimal
// Vercel-style req/res. Run: MOCK_MODE=1 npm run dev
// (For a full Vercel emulation, `vercel dev` also works.)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const port = Number(process.env.PORT) || 3000;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z]/g, '');
    let mod;
    try { mod = await import(pathToFileURL(join(root, 'api', name + '.js')).href); } catch (e) {
      res.writeHead(404); return res.end('Not found');
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = raw; }
    res.status = (code) => { res.statusCode = code; return res; };
    return mod.default(req, res);
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(pub, p));
  if (!file.startsWith(pub)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, () => console.log('Preview on http://localhost:' + port + (process.env.MOCK_MODE === '1' ? ' (mock data)' : '')));
