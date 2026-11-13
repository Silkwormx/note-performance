import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'verify');
mkdirSync(outDir, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function startServer() {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const file = resolve(root, `.${rel}`);
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const type = TYPES[extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => {
      resolveServer({ server, port: server.address().port });
    });
  });
}

async function snapCanvas(page, name) {
  const b64 = await page.evaluate(() => {
    const c = window.MarioPlayer.canvas();
    return c.toDataURL('image/png').slice('data:image/png;base64,'.length);
  });
  const dest = join(outDir, name);
  writeFileSync(dest, Buffer.from(b64, 'base64'));
  return dest;
}

async function main() {
  const { server, port } = await startServer();
  const url = `http://127.0.0.1:${port}/mario_player.html`;
  console.log('Server', url);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--font-render-hinting=medium', '--disable-font-subpixel-positioning'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.MarioPlayer && window.MarioPlayer.ready, null, { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);

    // 1. Title slide + speed buttons + page controls
    await page.screenshot({ path: join(outDir, '01-title-and-controls.png'), fullPage: true });
    await snapCanvas(page, '01-title-canvas.png');
    console.log('title');

    // 2. Bb4 + Gb chord, keys lit (m4)
    const spb = await page.evaluate(() => 60 / window.MarioPlayer.song().meta.tempo);
    const ci = 4;
    const bbTime = (ci + 14.55) * spb;
    await page.evaluate((t) => {
      window.MarioPlayer.pause();
      window.MarioPlayer.state.mode = 'song';
      window.MarioPlayer.seek(t);
    }, bbTime);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(outDir, '02-accidental-and-keyboard.png'), fullPage: true });
    await snapCanvas(page, '02-accidental-canvas.png');
    console.log('accidental at', bbTime.toFixed(3));

    // 3. F#5 in m11 — another accidental, later in the song
    const fsTime = (ci + 41.55) * spb;
    await page.evaluate((t) => window.MarioPlayer.seek(t), fsTime);
    await page.waitForTimeout(80);
    await snapCanvas(page, '03-sharp-canvas.png');
    console.log('sharp at', fsTime.toFixed(3));

    // 4. Speed 0.5 selected
    await page.evaluate(() => window.MarioPlayer.setSpeed(0.5));
    await page.screenshot({ path: join(outDir, '04-speed-05.png'), fullPage: true });
    console.log('speed 0.5');

    // 5. Page 2 of 5
    await page.evaluate(() => {
      window.MarioPlayer.setSpeed(1);
      window.MarioPlayer.gotoPage(1);
    });
    await page.waitForTimeout(80);
    await page.screenshot({ path: join(outDir, '05-page-2.png'), fullPage: true });
    await snapCanvas(page, '05-page-2-canvas.png');
    console.log('page 2');

    // 6. Page 3 (has F#) mid-page
    const page3Time = (ci + 41.55) * spb;
    await page.evaluate((t) => {
      window.MarioPlayer.gotoPage(2);
      window.MarioPlayer.state.mode = 'page';
      window.MarioPlayer.seek(t);
    }, page3Time);
    await page.waitForTimeout(80);
    await page.screenshot({ path: join(outDir, '06-page-3-sharp.png'), fullPage: true });
    await snapCanvas(page, '06-page-3-canvas.png');
    console.log('page 3');

    // 7. Loop toggle on
    await page.evaluate(() => window.MarioPlayer.setLoop(true));
    await page.screenshot({ path: join(outDir, '07-loop-on.png'), fullPage: true });
    console.log('loop');

    console.log('Wrote shots to', outDir);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
