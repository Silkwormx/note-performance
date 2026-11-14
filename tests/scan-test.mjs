// Playwright checks for the scan page and the "Fix the notes" editor.
//   BASE=http://127.0.0.1:8840/ SCAN_KEY=... PHOTO=path/to/photo.jpg node tests/scan-test.mjs
// Without PHOTO (or without a backend) only the editor is tested, using a demo MusicXML.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8840/';
const KEY = process.env.SCAN_KEY || '';
const PHOTO = process.env.PHOTO || '';
const OUT = 'verify/scan';
mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) fails += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${BASE}scan.html?nosw${KEY ? `&key=${KEY}` : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.Scan, null, { timeout: 10000 });
ok('scan page loads', true);
ok('key removed from address bar', !page.url().includes('key='), page.url());
const camAttr = await page.getAttribute('#in-camera', 'capture');
ok('camera input asks for the back camera', camAttr === 'environment');

let scanned = false;
if (PHOTO) {
  await page.waitForFunction(() => /connected/i.test(document.getElementById('server-state').textContent) || /not reachable/.test(document.getElementById('server-state').textContent), null, { timeout: 15000 });
  const state = await page.textContent('#server-state');
  ok('scanner connection', /connected/i.test(state), state);
  await page.setInputFiles('#in-files', PHOTO);
  ok('photo listed', (await page.$$('#page-list li')).length === 1);
  await page.screenshot({ path: `${OUT}/01-picked.png` });
  const t0 = Date.now();
  await page.click('#btn-read');
  await page.waitForSelector('#step-fix:not([hidden])', { timeout: 240000 });
  ok('photo read and editor opened', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/02-fix.png`, fullPage: true });
  const boxes = await page.$$eval('#img-boxes .mbox', (b) => b.length);
  ok('bar boxes drawn over the scanned page', boxes > 0, `${boxes} boxes`);
  scanned = true;
} else {
  const xml = readFileSync('songs/demo/twinkle.musicxml', 'utf8');
  await page.evaluate((x) => window.Scan.openXmlText(x, 'twinkle.musicxml'), xml);
  await page.waitForSelector('#step-fix:not([hidden])');
}

// editor operations
const before = await page.evaluate(() => window.Scan.songText());
const notes0 = await page.$$eval('#score .head', (h) => h.length);
ok('staff shows notes', notes0 > 10, `${notes0} note heads`);
// tap the first note
await page.locator('#score rect.hit').first().tap();
let sel = await page.textContent('#sel-label');
ok('tap selects a note', /Bar 1:/.test(sel), sel);
await page.tap('[data-act="up"]');
sel = await page.textContent('#sel-label');
ok('up arrow raises it a step', /Bar 1: D/.test(sel) || /Bar 1: [A-G]/.test(sel), sel);
await page.tap('[data-act="sharp"]');
const t1 = await page.evaluate(() => window.Scan.songText());
ok('sharp shows in the song text', /^[A-G]#\d/m.test(t1.split('\n').find((l) => / \|$/.test(l)) || ''), (t1.split('\n').find((l) => / \|$/.test(l)) || '').slice(0, 40));
await page.tap('[data-len="2"]');
const issues = await page.textContent('#issues');
ok('bar that no longer adds up is flagged', /Bar 1/.test(issues) && /needs/.test(issues), issues.slice(0, 80));
const orange = await page.$$eval('#score .bar-bg.flagged', (b) => b.length);
ok('flagged bar drawn orange', orange >= 1);
await page.screenshot({ path: `${OUT}/03-edited.png`, fullPage: true });
await page.tap('[data-act="undo"]');
await page.tap('[data-act="undo"]');
await page.tap('[data-act="undo"]');
const after = await page.evaluate(() => window.Scan.songText());
ok('undo restores the original', after === before);
// chord edit
await page.locator('#score rect.hit').nth(1).tap();
await page.fill('#f-chords', 'F G7');
await page.press('#f-chords', 'Enter');
await page.locator('#f-title').click();
const t2 = await page.evaluate(() => window.Scan.songText());
ok('chord names edited per bar', /chords: F:2 \| G7:2/.test(t2), (t2.match(/chords:.*$/m) || [''])[0]);
// delete + insert
const n1 = await page.$$eval('#score .head', (h) => h.length);
await page.locator('#score rect.hit').nth(2).tap();
await page.tap('[data-act="delete"]');
const n2 = await page.$$eval('#score .head', (h) => h.length);
ok('delete removes a note', n2 === n1 - 1, `${n1} -> ${n2}`);
await page.tap('[data-act="add-rest"]');
const t3 = await page.evaluate(() => window.Scan.songText());
ok('insert rest', /\br 1\b/.test(t3.split('\n').filter((l) => / \|$/.test(l))[0]));

// Play it -> player
await page.tap('#btn-play-it');
await page.waitForURL(/index\.html\?song=scan/, { timeout: 10000 });
await page.waitForFunction(() => window.Player && window.Player.ready, null, { timeout: 30000 });
const status = await page.textContent('#song-status');
const hasBack = await page.$('#back-to-scan');
ok('Play it opens the song in the player', /From your scan/.test(status) && !!hasBack, status);
const title = await page.evaluate(() => window.Player.song().meta.title);
ok('title carried over', !!title, title);
await page.screenshot({ path: `${OUT}/04-player.png` });
// back to the editor keeps the edits
await page.tap('#back-to-scan');
await page.waitForSelector('#step-fix:not([hidden])', { timeout: 10000 });
const t4 = await page.evaluate(() => window.Scan.songText());
ok('back to Fix notes keeps the edits', t4 === t3);
if (scanned) {
  await page.waitForTimeout(1500);
  const boxes = await page.$$eval('#img-boxes .mbox', (b) => b.length);
  ok('scanned picture comes back too', boxes > 0, `${boxes}`);
}
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
