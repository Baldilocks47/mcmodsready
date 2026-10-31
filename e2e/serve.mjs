// Serves dist/ the way the production Worker does: clean URLs, /data from the fixtures, 404.html for misses.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
};
const isFile = (p) => existsSync(p) && statSync(p).isFile();

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.includes('..')) return res.writeHead(400).end();
  const root = path.startsWith('/data/') ? join('tests/fixtures', path) : join('dist', path);
  const file = [root, `${root}.html`, join(root, 'index.html')].find(isFile);
  const target = file ?? 'dist/404.html';
  res.writeHead(file ? 200 : 404, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(res);
}).listen(4322);
