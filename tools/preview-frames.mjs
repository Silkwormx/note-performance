import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = '/workspace/projects/note-performance';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
};
const outDir = '/tmp/np-preview';
mkdirSync(outDir, { recursive: true });

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = resolve(root, `.${rel}`);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const text = readFileSync(join(root, 'songs/twinkle.txt'), 'utf8');
const w = 1280, h = 720;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/index.html?mode=render&w=${w}&h=${h}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.NotePerformance && window.NotePerformance.ready);
await page.evaluate((t) => window.NotePerformance.loadSong(t), text);
await page.evaluate(() => document.fonts.ready);
const times = [0.3, 1.5, 2.5, 3.6, 6.2, 8.0, 12.5];
for (const t of times) {
  const b64 = await page.evaluate((t) => {
    window.NotePerformance.seek(t);
    return window.NotePerformance.canvas().toDataURL('image/jpeg', 0.92).slice(23);
  }, t);
  const p = join(outDir, `t${t.toFixed(1).replace('.','-')}.jpg`);
  writeFileSync(p, Buffer.from(b64, 'base64'));
  console.log('wrote', p);
}
const size = await page.evaluate(() => {
  const c = window.NotePerformance.canvas();
  return { w: c.width, h: c.height, dur: window.NotePerformance.duration() };
});
console.log('size', size);
await browser.close();
server.close();
