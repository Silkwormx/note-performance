/**
 * Offline (Node) piano renderer for MP4 export, using the same bundled Salamander
 * Grand Piano samples and the same note/chord rules as the live player (js/piano.js):
 * nearest sample, pitch-shifted by playback rate; melody held for 97% of the note then
 * a soft 0.9 s release; chords struck softly with a tiny roll; light room reverb.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chordMidis } from './music.js';
import { countInBeats, songDurationSec } from './parser.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 44100;
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SAMPLE_NOTES = ['A1', ...['2', '3', '4', '5', '6', '7'].flatMap((o) => [`C${o}`, `Ds${o}`, `Fs${o}`, `A${o}`]), 'C8'];
const MELODY_RELEASE = 0.9;
const CHORD_RELEASE = 0.55;

let bank = null;
function loadBank() {
  if (bank) return bank;
  bank = new Map();
  for (const n of SAMPLE_NOTES) {
    const m = n.match(/^([A-G])(s?)(\d)$/);
    const midi = (Number(m[3]) + 1) * 12 + NAMES[m[1]] + (m[2] ? 1 : 0);
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(root, 'assets/piano', `${n}.mp3`), '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
    const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const L = new Float32Array(f.length / 2);
    const R = new Float32Array(f.length / 2);
    for (let i = 0; i < L.length; i += 1) {
      L[i] = f[2 * i];
      R[i] = f[2 * i + 1];
    }
    bank.set(midi, { L, R });
  }
  return bank;
}

function mixNote(L, R, t0, midi, hold, velocity, release) {
  const b = loadBank();
  let best = null;
  for (const k of b.keys()) if (best == null || Math.abs(k - midi) < Math.abs(best - midi)) best = k;
  const smp = b.get(best);
  const rate = Math.pow(2, (midi - best) / 12);
  const start = Math.max(0, Math.round(t0 * SR));
  const holdN = Math.round(hold * SR);
  const tau = release / 4.6; // ~99% gone after `release`
  const endN = holdN + Math.round(release * 1.2 * SR);
  const attackN = Math.round(0.002 * SR);
  for (let i = 0; i < endN; i += 1) {
    const o = start + i;
    if (o >= L.length) break;
    const pos = i * rate;
    const j = Math.floor(pos);
    if (j + 1 >= smp.L.length) break;
    const fr = pos - j;
    let g = velocity;
    if (i < attackN) g *= i / attackN;
    if (i > holdN) g *= Math.exp(-(i - holdN) / SR / tau);
    L[o] += (smp.L[j] * (1 - fr) + smp.L[j + 1] * fr) * g;
    R[o] += (smp.R[j] * (1 - fr) + smp.R[j + 1] * fr) * g;
  }
}

function mixChord(L, R, t0, midis, dur) {
  const hold = Math.max(0.08, dur - 0.03);
  midis.forEach((m, i) => {
    const off = i * 0.012;
    mixNote(L, R, t0 + off, m, Math.max(0.05, hold - off), i === 0 ? 0.4 : 0.3, CHORD_RELEASE);
  });
}

function mixClick(L, R, t0, strong) {
  const start = Math.max(0, Math.floor(t0 * SR));
  const n = Math.floor(0.07 * SR);
  const f0 = strong ? 1500 : 1100;
  const f1 = strong ? 900 : 700;
  const vol = strong ? 0.16 : 0.1;
  let phase = 0;
  for (let i = 0; i < n && start + i < L.length; i += 1) {
    const t = i / SR;
    const f = f0 * Math.pow(f1 / f0, Math.min(1, t / 0.04));
    phase += (2 * Math.PI * f) / SR;
    const tri = (2 / Math.PI) * Math.asin(Math.sin(phase));
    const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.012);
    L[start + i] += tri * vol * env;
    R[start + i] += tri * vol * env;
  }
}

function wavFile(pcm, channels = 2) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Write L/R through a light room reverb (synthetic impulse, ffmpeg afir) to a 16-bit WAV. */
function finish(L, R, outPath, targetDb = -1.4) {
  const dir = mkdtempSync(join(tmpdir(), 'pianowav-'));
  try {
    const n = L.length;
    const inter = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      inter[2 * i] = L[i];
      inter[2 * i + 1] = R[i];
    }
    writeFileSync(join(dir, 'dry.f32'), Buffer.from(inter.buffer));
    // 2.4 s decaying stereo noise impulse, like Tone.Reverb
    const irN = Math.round(2.4 * SR);
    const ir = new Float32Array(irN * 2);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let i = 0; i < irN; i += 1) {
      const e = Math.exp((-i / SR) * 2.9);
      ir[2 * i] = rnd() * e;
      ir[2 * i + 1] = rnd() * e;
    }
    writeFileSync(join(dir, 'ir.f32'), Buffer.from(ir.buffer));
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', join(dir, 'dry.f32'),
      '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', join(dir, 'ir.f32'),
      '-filter_complex',
      '[0:a]asplit=2[d][w0];[w0][1:a]afir=dry=1:wet=1:irgain=0.035[w];[d][w]amix=inputs=2:weights=1 1:normalize=0:duration=first,acompressor=threshold=-16dB:ratio=3:attack=5:release=200',
      '-f', 'f32le', '-ac', '2', join(dir, 'wet.f32'),
    ]);
    const wet = readFileSync(join(dir, 'wet.f32'));
    const f = new Float32Array(wet.buffer, wet.byteOffset, wet.byteLength / 4);
    let peak = 1e-9;
    for (let i = 0; i < f.length; i += 1) peak = Math.max(peak, Math.abs(f[i]));
    const gain = Math.pow(10, targetDb / 20) / peak;
    const pcm = Buffer.alloc(f.length * 2);
    for (let i = 0; i < f.length; i += 1) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f[i] * gain * 32767))), i * 2);
    writeFileSync(outPath, wavFile(pcm));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writePianoSongWav(song, outPath, opts = {}) {
  const tailBeats = opts.tailBeats ?? 2;
  const speed = opts.speed || 1;
  const secPerBeat = 60 / song.meta.tempo / speed;
  const ci = countInBeats(song);
  const duration = songDurationSec(song, { countIn: true, tailBeats, speed });
  const n = Math.ceil(duration * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let b = 0; b < ci; b += 1) mixClick(L, R, b * secPerBeat, b === 0);
  for (const ev of song.events) {
    if (ev.type !== 'note') continue;
    const t = (ci + ev.startBeat) * secPerBeat;
    mixNote(L, R, t, ev.midi, Math.max(0.06, ev.beats * secPerBeat * 0.97), 0.75, MELODY_RELEASE);
  }
  for (const ch of song.chords || []) {
    if (ch.silent) continue;
    mixChord(L, R, (ci + ch.startBeat) * secPerBeat, chordMidis(ch), ch.beats * secPerBeat);
  }
  finish(L, R, outPath);
  return { duration, sampleRate: SR };
}

/** Title-slide bed: one soft rolled chord. */
export function writePianoSlideWav(outPath, duration, midis) {
  const n = Math.max(1, Math.ceil(duration * SR));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  if (midis && midis.length) {
    midis.forEach((m, i) => mixNote(L, R, 0.4 + i * 0.18, m, Math.max(0.2, duration - 1.6 - i * 0.18), 0.22, 1.0));
  }
  finish(L, R, outPath, -10); // quieter than the song
  return { duration: n / SR, sampleRate: SR };
}
