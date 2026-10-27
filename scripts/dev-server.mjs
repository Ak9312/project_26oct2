// Local preview of the built app: serves dist/ (run `npm run build` first)
// and the api/ routes with a minimal Vercel-style req/res.
//   MOCK_MODE=1 npm run preview     → sample data, no keys needed
// For live editing use `npm run dev` (Vite) together with `npm run dev:api`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const port = Number(process.env.PORT) || 3000;
const apiOnly = process.argv.includes('--api-only');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

export function createApp() {
  return createServer(async (req, res) => {
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
    if (apiOnly) { res.writeHead(404); return res.end(); }
    const file = normalize(join(dist, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) {
      // Single-page app: unknown paths get index.html (like the Vercel rewrite).
      try {
        res.writeHead(200, { 'Content-Type': types['.html'] });
        res.end(await readFile(join(dist, 'index.html')));
      } catch (e2) {
        res.writeHead(500); res.end('Run `npm run build` first.');
      }
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createApp().listen(port, () => console.log('http://localhost:' + port + (apiOnly ? ' (API only)' : '') + (process.env.MOCK_MODE === '1' ? ' — sample data' : '')));
}
