// Playwright checks: piano loads, audio is produced, notes are scheduled on time at each speed,
// MusicXML open works, practice pages still work, and the offline cache serves the app.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8831/';
const OUT = 'verify/v2';
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

async function snap(name) {
  const b64 = await page.evaluate(() => window.Player.canvas().toDataURL('image/png').split(',')[1]);
  writeFileSync(`${OUT}/${name}`, Buffer.from(b64, 'base64'));
}

await page.goto(`${BASE}index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.Player && window.Player.ready, null, { timeout: 20000 });
await page.waitForFunction(() => window.Player.pianoLoaded(), null, { timeout: 30000 });
ok('player boots and piano samples load', true);
const opts = await page.$$eval('#song-select option', (o) => o.map((x) => x.textContent));
ok('demo song list', opts.length >= 4, opts.join(' | '));
await snap('01-title-twinkle.png');
await page.screenshot({ path: `${OUT}/01-page.png` });

// Instrument: analyser on Tone's output + log of every scheduled note.
await page.evaluate(() => {
  const T = window.Tone;
  const raw = T.getContext().rawContext;
  window.__an = raw.createAnalyser();
  window.__an.fftSize = 2048;
  T.getDestination().connect(window.__an);
  window.__rms = [];
  setInterval(() => {
    const a = new Float32Array(window.__an.fftSize);
    window.__an.getFloatTimeDomainData(a);
    let s = 0;
    for (const v of a) s += v * v;
    window.__rms.push(Math.sqrt(s / a.length));
  }, 50);
  const synth = window.Player.synth;
  window.__sched = [];
  const orig = synth.bell;
  synth.bell = (freq, dur, when, vol, midi) => {
    const P = window.Player.state;
    window.__sched.push({ when, now: synth.now(), midi, songTime: P.time, anchorCtx: P.anchorCtx, anchorSong: P.anchorSong, speed: P.speed });
    return orig(freq, dur, when, vol, midi);
  };
});

async function playFor(speed, ms) {
  await page.evaluate((s) => {
    window.__sched.length = 0;
    window.__rms.length = 0;
    window.Player.pause();
    window.Player.setSpeed(s);
    // start just before the first note (after the count-in) so slow speeds still play notes
    const P = window.Player;
    P.seek((P.song().meta.time[0] * 60) / P.song().meta.tempo - 0.3);
  }, speed);
  await page.click('#btn-play');
  await page.waitForTimeout(ms);
  const r = await page.evaluate(() => {
    const P = window.Player;
    const beatSec = 60 / P.song().meta.tempo;
    const ci = P.song().meta.time[0];
    // Each scheduled note: when it should sound by the audio clock vs. when it was scheduled.
    const errs = [];
    const late = [];
    for (const e of window.__sched) {
      if (e.when == null || e.anchorCtx == null) continue;
      const ev = P.song().events.find((x) => x.midi === e.midi && Math.abs((ci + x.startBeat) * beatSec - (e.anchorSong + (e.when - e.anchorCtx + P.synth.latency()) * e.speed)) < 0.05);
      if (ev) errs.push(Math.abs((ci + ev.startBeat) * beatSec - (e.anchorSong + (e.when - e.anchorCtx + P.synth.latency()) * e.speed)) * 1000);
      if (e.when < e.now - 0.001) late.push(e);
    }
    const rms = window.__rms;
    return {
      scheduled: window.__sched.length,
      matched: errs.length,
      maxErrMs: errs.length ? Math.max(...errs) : null,
      lateCount: late.length,
      leadMs: window.__sched.filter((e) => e.when != null).map((e) => (e.when - e.now) * 1000),
      peakRms: Math.max(0, ...rms),
      audibleFrac: rms.filter((v) => v > 0.005).length / Math.max(1, rms.length),
      time: P.state.time,
    };
  });
  await page.evaluate(() => window.Player.pause());
  return r;
}

for (const speed of [1, 0.5, 0.25]) {
  const r = await playFor(speed, 6000);
  const lead = r.leadMs.length ? `${Math.min(...r.leadMs).toFixed(0)}–${Math.max(...r.leadMs).toFixed(0)}ms ahead` : '';
  ok(`audio at ${speed}x`, r.peakRms > 0.01 && r.scheduled > 0, `notes=${r.scheduled} peakRMS=${r.peakRms.toFixed(3)} audible=${(r.audibleFrac * 100).toFixed(0)}%`);
  ok(`timing at ${speed}x`, r.lateCount === 0 && (r.maxErrMs ?? 0) < 2, `matched=${r.matched} maxErr=${r.maxErrMs?.toFixed(2)}ms late=${r.lateCount} ${lead}`);
}

// Pause really silences (including notes scheduled ahead).
await page.evaluate(() => { window.Player.seek(0); window.Player.setSpeed(1); });
await page.click('#btn-play');
await page.waitForTimeout(3500);
await snap('02-playing-twinkle.png');
await page.click('#btn-pause');
await page.evaluate(() => (window.__rms.length = 0));
await page.waitForTimeout(700);
const afterPause = await page.evaluate(() => Math.max(0, ...window.__rms.slice(4)));
ok('pause silences quickly', afterPause < 0.004, `rms after 200ms: ${afterPause.toFixed(4)}`);

// Speed change while playing keeps the clock moving and in sync.
await page.click('#btn-play');
await page.waitForTimeout(1500);
const t1 = await page.evaluate(() => window.Player.state.time);
await page.click('#speeds button[data-speed="0.5"]');
await page.waitForTimeout(2000);
const t2 = await page.evaluate(() => window.Player.state.time);
ok('speed change mid-play', t2 > t1 + 0.7 && t2 < t1 + 1.3, `advanced ${(t2 - t1).toFixed(2)}s song time in 2s at 0.5x`);
await page.click('#btn-pause');

// Open MusicXML via the file picker: .musicxml, .mxl, and an external file with chord symbols.
for (const [file, name] of [
  ['songs/demo/ode-to-joy.musicxml', '03-ode.png'],
  ['songs/demo/mary.mxl', '04-mary-mxl.png'],
  ['songs/demo/frere-jacques.musicxml', '05-frere-guess.png'],
  ['tests/external/OSMD_function_test_chord_symbols.musicxml', '06-osmd-chords.png'],
  ['tests/external/scanned-ode-audiveris.mxl', '06b-scanned-ode.png'],
].filter(([f]) => existsSync(f))) {
  await page.setInputFiles('#file-input', file);
  await page.waitForFunction((f) => window.Player.state.songId === `file:${f.split('/').pop()}`, file, { timeout: 5000 });
  const info = await page.evaluate(() => ({ title: window.Player.song().meta.title, notes: window.Player.song().events.filter((e) => e.type === 'note').length, chords: window.Player.song().chords.length, status: document.getElementById('song-status').textContent, guess: !!window.Player.song().meta.chordsGuessed }));
  ok(`open ${file.split('/').pop()}`, info.notes > 0, `${info.title}: ${info.notes} notes, ${info.chords} chords${info.guess ? ' (guessed)' : ''} · ${info.status}`);
  await snap(name);
}
// A playing frame of the imported score with chords.
await page.evaluate(() => { window.Player.seek(6); });
await snap('07-osmd-chords-playing.png');

// Practice pages still work.
await page.selectOption('#song-select', 'ode');
await page.waitForFunction(() => window.Player.state.songId === 'ode');
await page.click('#btn-next');
await page.click('#btn-loop');
const pg = await page.evaluate(() => ({ label: document.getElementById('page-label').textContent, mode: window.Player.state.mode }));
ok('practice pages', /Page 2 of 4/.test(pg.label) && pg.mode === 'page', pg.label);
await page.click('#btn-play-page');
await page.waitForTimeout(2500);
await snap('08-ode-page2.png');
await page.click('#btn-pause');

// Offline: wait for the service worker, then reload with the network off.
const swOk = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return !!reg.active;
});
await page.waitForTimeout(1500);
const before = logs.length;
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
let offline = false;
try {
  await page.waitForFunction(() => window.Player && window.Player.ready && window.Player.pianoLoaded(), null, { timeout: 20000 });
  offline = true;
} catch {}
const offErrs = logs.slice(before).filter((l) => /pageerror/.test(l));
ok('works offline (service worker)', swOk && offline && !offErrs.length, offErrs.join(' / '));
await page.screenshot({ path: `${OUT}/09-offline.png` });
await ctx.setOffline(false);

// The song editor still loads, and can open MusicXML.
const ed = await ctx.newPage();
const edErrs = [];
ed.on('pageerror', (e) => edErrs.push(e.message));
await ed.goto(`${BASE}editor.html`, { waitUntil: 'load' });
await ed.waitForFunction(() => window.NotePerformance && window.NotePerformance.ready, null, { timeout: 15000 });
await ed.setInputFiles('#file-xml', 'songs/demo/frere-jacques.musicxml');
await ed.waitForFunction(() => /Fr/.test(document.getElementById('field-title').value));
const edBody = await ed.$eval('#field-body', (t) => t.value);
ok('editor opens MusicXML', /Bb4/.test(edBody) && edErrs.length === 0, edErrs.join(' / '));
await ed.screenshot({ path: `${OUT}/10-editor.png` });
await ed.close();

const errs = logs.slice(0, before).filter((l) => /^(error|pageerror)/.test(l) && !/local\.json|favicon/.test(l));
ok('no page errors', errs.length === 0, errs.slice(0, 5).join(' / '));
writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, logs }, null, 2));
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
