#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { parseSong, songDurationSec } from './js/parser.js';
import { chordMidis } from './js/music.js';
import { writeSongWav, writeSoftPadWav, writeSilenceWav, concatWavs } from './js/wav.js';
import { writePianoSongWav, writePianoSlideWav } from './js/pianowav.js';

const root = dirname(fileURLToPath(import.meta.url));
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

const SPEED_LABELS = {
  0.25: 'Very Slow',
  0.5: 'Slow',
  0.75: 'Medium',
  1: 'Full Speed',
};

function labelForSpeed(speed, override) {
  if (override) return override;
  const key = Object.keys(SPEED_LABELS).find((k) => Math.abs(Number(k) - speed) < 0.001);
  return key ? SPEED_LABELS[key] : '';
}

function parseArgs(argv) {
  const opts = {
    width: 1280,
    height: 720,
    fps: 30,
    tailBeats: 2,
    speed: 1,
    scale: 2,
    label: '',
    titleSlide: false,
    titleSeconds: 5.5,
    cardSeconds: 2.2,
    speeds: null,
    sound: 'piano',
    song: 'songs/twinkle.txt',
    out: 'demo.mp4',
  };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--width') opts.width = Number(argv[++i]);
    else if (a === '--height') opts.height = Number(argv[++i]);
    else if (a === '--fps') opts.fps = Number(argv[++i]);
    else if (a === '--speed') opts.speed = Number(argv[++i]);
    else if (a === '--scale') opts.scale = Number(argv[++i]);
    else if (a === '--label') opts.label = String(argv[++i]);
    else if (a === '--title-slide') opts.titleSlide = true;
    else if (a === '--sound') opts.sound = String(argv[++i]);
    else if (a === '--title-seconds') opts.titleSeconds = Number(argv[++i]);
    else if (a === '--card-seconds') opts.cardSeconds = Number(argv[++i]);
    else if (a === '--speeds') {
      opts.speeds = String(argv[++i])
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    } else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else pos.push(a);
  }
  if (!Number.isFinite(opts.speed) || opts.speed <= 0 || opts.speed > 2) {
    throw new Error(`Speed should be a number like 0.25, 0.5, 0.75, or 1 (got "${opts.speed}").`);
  }
  if (!Number.isFinite(opts.scale) || opts.scale < 1 || opts.scale > 3) {
    throw new Error(`Scale should be 1, 2, or 3 (got "${opts.scale}").`);
  }
  if (pos[0]) opts.song = pos[0];
  if (pos[1]) opts.out = pos[1];
  return opts;
}

function buildProgram(opts, song) {
  const sections = [];
  if (opts.titleSlide) {
    sections.push({ type: 'title', duration: opts.titleSeconds, name: 'Title' });
  }
  const speeds = opts.speeds && opts.speeds.length ? opts.speeds : [opts.speed];
  speeds.forEach((speed, i) => {
    const label = i === 0 && !opts.speeds ? labelForSpeed(speed, opts.label) : labelForSpeed(speed);
    if (opts.speeds && i > 0) {
      sections.push({
        type: 'card',
        duration: opts.cardSeconds,
        speed,
        label,
        name: `${label || speed} card`,
      });
    }
    const duration = songDurationSec(song, { countIn: true, tailBeats: opts.tailBeats, speed });
    sections.push({
      type: 'song',
      speed,
      label,
      tailBeats: opts.tailBeats,
      duration,
      name: `${label || 'Play'} ${speed}×`,
    });
  });
  let t = 0;
  for (const sec of sections) {
    sec.start = t;
    sec.end = t + sec.duration;
    t = sec.end;
  }
  return sections;
}

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

async function captureFrame(page, tmp, index, evaluateArg, evaluateFn) {
  const b64 = await page.evaluate(evaluateFn, evaluateArg);
  writeFileSync(join(tmp, `frame_${String(index).padStart(5, '0')}.jpg`), Buffer.from(b64, 'base64'));
}

const SNAP_JPEG = ({ t, duration, kind, info }) => {
  if (kind === 'title') window.NotePerformance.drawTitleSlide(t, duration);
  else if (kind === 'card') window.NotePerformance.drawSpeedCard(info, t, duration);
  else window.NotePerformance.seek(t);
  const canvas = window.NotePerformance.canvas();
  return canvas.toDataURL('image/jpeg', 0.94).slice('data:image/jpeg;base64,'.length);
};

async function render() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      'Usage: node render.mjs [song.txt] [out.mp4] [--width 1280] [--height 720] [--fps 30] [--speed 1] [--scale 2] [--label "Full Speed"] [--title-slide] [--speeds 0.5,0.75,1] [--sound piano|bell]',
    );
    return;
  }

  const songPath = resolve(root, opts.song);
  const outPath = resolve(root, opts.out);
  if (!existsSync(songPath)) throw new Error(`Song not found: ${songPath}`);
  const text = readFileSync(songPath, 'utf8');
  const song = parseSong(text);
  if (song.errors.length) {
    for (const e of song.errors) console.warn(`Line ${e.line}: ${e.message}`);
  }
  if (!song.events.length) throw new Error('Song has no notes.');

  const sections = buildProgram(opts, song);
  const totalDuration = sections[sections.length - 1].end;
  const totalFrames = Math.round(totalDuration * opts.fps);
  console.log(`Song: ${song.meta.title}  ${song.totalBeats} beats`);
  for (const sec of sections) {
    console.log(
      `  ${sec.start.toFixed(2).padStart(7)}–${sec.end.toFixed(2).padStart(7)}s  ${sec.name}`,
    );
  }
  console.log(`Total ${totalDuration.toFixed(2)}s  ${totalFrames} frames`);

  const tmp = join(root, '.tmp-frames');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const wavParts = [];
  const firstChord = (song.chords || []).find((ch) => !ch.silent);
  const padMidis = firstChord ? chordMidis(firstChord) : [48, 52, 55];
  sections.forEach((sec, i) => {
    const part = join(tmp, `audio_${String(i).padStart(2, '0')}.wav`);
    const piano = opts.sound !== 'bell';
    if (sec.type === 'song') {
      if (piano) writePianoSongWav(song, part, { tailBeats: sec.tailBeats, speed: sec.speed });
      else writeSongWav(song, part, { tailBeats: sec.tailBeats, speed: sec.speed });
    } else if (piano) {
      writePianoSlideWav(part, sec.duration, padMidis);
    } else {
      writeSoftPadWav(part, sec.duration, padMidis);
    }
    wavParts.push(part);
  });
  const wavPath = join(tmp, 'audio.wav');
  concatWavs(wavParts, wavPath);
  console.log('Wrote audio', wavPath);

  const { server, port } = await startServer();
  const scale = Math.round(opts.scale || 1);
  const url = `http://127.0.0.1:${port}/editor.html?mode=render&w=${opts.width}&h=${opts.height}&scale=${scale}`;
  console.log('Preview server', url, `scale=${scale}`);

  let browser;
  let frameIndex = 0;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--font-render-hinting=medium', '--disable-font-subpixel-positioning'],
    });
    const page = await browser.newPage({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.NotePerformance && window.NotePerformance.ready, null, {
      timeout: 15000,
    });
    await page.evaluate((songText) => window.NotePerformance.loadSong(songText), text);
    await page.evaluate(() => document.fonts.ready);

    const size = await page.evaluate(() => {
      const c = window.NotePerformance.canvas();
      return { w: c.width, h: c.height };
    });
    console.log('Canvas', size);

    for (const sec of sections) {
      const frames = Math.round(sec.duration * opts.fps);
      if (sec.type === 'song') {
        const hideBadge = !opts.speeds && Math.abs(sec.speed - 1) < 0.001 && !opts.label;
        await page.evaluate(({ speed, speedLabel, showSpeedBadge }) => {
          window.NotePerformance.setOptions({ speed, speedLabel, showSpeedBadge, showKeyboard: true });
        }, { speed: sec.speed, speedLabel: hideBadge ? '' : sec.label, showSpeedBadge: !hideBadge });
      }
      for (let i = 0; i < frames; i += 1) {
        const local = i / opts.fps;
        const payload =
          sec.type === 'song'
            ? { kind: 'song', t: local * sec.speed }
            : { kind: sec.type, t: local, duration: sec.duration, info: { speed: sec.speed, label: sec.label } };
        const b64 = await page.evaluate(SNAP_JPEG, payload);
        writeFileSync(
          join(tmp, `frame_${String(frameIndex).padStart(5, '0')}.jpg`),
          Buffer.from(b64, 'base64'),
        );
        if (frameIndex % 60 === 0 || i === frames - 1) {
          const wall = frameIndex / opts.fps;
          console.log(`  frame ${frameIndex + 1}/${totalFrames}  wall=${wall.toFixed(2)}s  ${sec.name}`);
        }
        frameIndex += 1;
      }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  console.log('Muxing', outPath);
  await new Promise((resolveP, reject) => {
    const ff = spawn(
      'ffmpeg',
      [
        '-y',
        '-framerate',
        String(opts.fps),
        '-i',
        join(tmp, 'frame_%05d.jpg'),
        '-i',
        wavPath,
        '-vf',
        `scale=${opts.width}:${opts.height}:flags=lanczos`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '17',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '-movflags',
        '+faststart',
        outPath,
      ],
      { stdio: 'inherit' },
    );
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolveP() : reject(new Error(`ffmpeg exited ${code}`))));
  });

  rmSync(tmp, { recursive: true, force: true });
  console.log('Done', outPath);
  for (const sec of sections) {
    console.log(`SECTION ${sec.name}: ${sec.start.toFixed(2)}–${sec.end.toFixed(2)}`);
  }
}

render().catch((err) => {
  console.error(err);
  process.exit(1);
});
