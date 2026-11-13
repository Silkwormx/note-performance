import { readFileSync, writeFileSync } from 'fs';
import { midiToFreq, chordMidis } from './music.js';
import { countInBeats, songDurationSec } from './parser.js';

const PARTIALS = [
  [1.0, 1.0, 1.0],
  [2.003, 0.34, 0.52],
  [3.01, 0.16, 0.38],
  [4.06, 0.09, 0.28],
  [5.15, 0.05, 0.2],
  [6.79, 0.03, 0.15],
  [8.21, 0.016, 0.12],
];

export function writeSongWav(song, outPath, opts = {}) {
  const sampleRate = opts.sampleRate || 44100;
  const tailBeats = opts.tailBeats ?? 2;
  const speed = opts.speed || 1;
  const secPerBeat = (60 / song.meta.tempo) / speed;
  const ci = countInBeats(song);
  const duration = songDurationSec(song, { countIn: true, tailBeats, speed });
  const n = Math.ceil(duration * sampleRate);
  const L = new Float64Array(n);
  const R = new Float64Array(n);

  for (let b = 0; b < ci; b += 1) {
    mixClick(L, R, sampleRate, b * secPerBeat, b === 0);
  }

  for (const ev of song.events) {
    if (ev.type !== 'note') continue;
    const t = (ci + ev.startBeat) * secPerBeat;
    const dur = ev.beats * secPerBeat;
    mixBell(L, R, sampleRate, t, midiToFreq(ev.midi), dur);
  }

  const sounding = (song.chords || []).filter((ch) => !ch.silent);
  for (let i = 0; i < sounding.length; i += 1) {
    const ch = sounding[i];
    const t = (ci + ch.startBeat) * secPerBeat;
    const rawDur = ch.beats * secPerBeat;
    const next = sounding[i + 1];
    const nextT = next ? (ci + next.startBeat) * secPerBeat : Infinity;
    const dur = Math.max(0, Math.min(rawDur, nextT - t));
    mixPad(L, R, sampleRate, t, chordMidis(ch), dur);
  }

  let peak = 1e-9;
  for (let i = 0; i < n; i += 1) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const gain = Math.pow(10, -1.4 / 20) / peak;
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i += 1) {
    pcm.writeInt16LE(s16(L[i] * gain), i * 4);
    pcm.writeInt16LE(s16(R[i] * gain), i * 4 + 2);
  }
  writeFileSync(outPath, buildWav(pcm, sampleRate, 2));
  return { duration, sampleRate };
}

function mixBell(L, R, sr, t0, freq, dur) {
  const n = L.length;
  const attack = 0.007;
  const rel = Math.max(0.42, dur * 0.95);
  const start = Math.max(0, Math.floor(t0 * sr));
  const end = Math.min(n, Math.floor((t0 + rel + 0.05) * sr));
  const pan = Math.max(-0.28, Math.min(0.28, (freq - 340) / 850));
  const gL = Math.sqrt(0.5 * (1 - pan));
  const gR = Math.sqrt(0.5 * (1 + pan));

  for (let i = start; i < end; i += 1) {
    const t = i / sr - t0;
    if (t < 0) continue;
    const envA = t < attack ? t / attack : 1;
    let sample = 0;
    for (const [ratio, amp, decayMul] of PARTIALS) {
      const dec = Math.exp(-t / (rel * decayMul));
      sample += amp * dec * Math.sin(2 * Math.PI * freq * ratio * t);
    }
    // Soft mallet noise click at the attack
    if (t < 0.012) {
      const noise = (Math.sin(t * 17347.1 + freq) * 0.5 + 0.5) * 2 - 1;
      sample += noise * 0.22 * (1 - t / 0.012);
    }
    sample *= envA * 0.22;
    L[i] += sample * gL;
    R[i] += sample * gR;
  }
}


function mixPad(L, R, sr, t0, midis, dur) {
  if (!midis.length || dur <= 0) return;
  const n = L.length;
  const attack = Math.min(0.05, dur * 0.2);
  // Release happens inside the chord so nothing is left ringing into the next one.
  const release = Math.min(0.06, Math.max(0.02, dur * 0.15));
  const start = Math.max(0, Math.floor(t0 * sr));
  const end = Math.min(n, Math.floor((t0 + dur) * sr));
  const vol = 0.05 / Math.sqrt(midis.length);
  const holdEnd = Math.max(attack, dur - release);
  for (let i = start; i < end; i += 1) {
    const t = i / sr - t0;
    if (t < 0 || t >= dur) continue;
    let env = 1;
    if (t < attack) env = t / attack;
    else if (t > holdEnd) env = Math.max(0, 1 - (t - holdEnd) / release);
    let sample = 0;
    for (const midi of midis) {
      const f = midiToFreq(midi);
      sample += Math.sin(2 * Math.PI * f * t) + 0.16 * Math.sin(4 * Math.PI * f * t);
    }
    sample *= env * vol / 1.16;
    L[i] += sample * 0.96;
    R[i] += sample * 0.96;
  }
}

function mixClick(L, R, sr, t0, strong) {
  const n = L.length;
  const start = Math.max(0, Math.floor(t0 * sr));
  const end = Math.min(n, start + Math.floor(0.06 * sr));
  const f1 = strong ? 1240 : 980;
  const f2 = strong ? 1860 : 1480;
  const vol = strong ? 0.22 : 0.14;
  for (let i = start; i < end; i += 1) {
    const t = i / sr - t0;
    const env = Math.exp(-t * 55);
    const sample = vol * env * (Math.sin(2 * Math.PI * f1 * t) * 0.7 + Math.sin(2 * Math.PI * f2 * t) * 0.3);
    L[i] += sample;
    R[i] += sample;
  }
}

function s16(v) {
  const x = Math.max(-1, Math.min(1, v));
  return x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
}

function buildWav(pcm, sampleRate, channels) {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}


export function writeSilenceWav(outPath, duration, opts = {}) {
  const sampleRate = opts.sampleRate || 44100;
  const n = Math.max(0, Math.ceil(duration * sampleRate));
  const pcm = Buffer.alloc(n * 4);
  writeFileSync(outPath, buildWav(pcm, sampleRate, 2));
  return { duration: n / sampleRate, sampleRate };
}

export function writeSoftPadWav(outPath, duration, midis, opts = {}) {
  const sampleRate = opts.sampleRate || 44100;
  const n = Math.max(0, Math.ceil(duration * sampleRate));
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  if (midis && midis.length && duration > 0.1) {
    mixPad(L, R, sampleRate, 0.05, midis, Math.max(0.05, duration - 0.12));
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const gain = peak > 1e-6 ? Math.pow(10, -18 / 20) / peak : 0;
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i += 1) {
    pcm.writeInt16LE(s16(L[i] * gain), i * 4);
    pcm.writeInt16LE(s16(R[i] * gain), i * 4 + 2);
  }
  writeFileSync(outPath, buildWav(pcm, sampleRate, 2));
  return { duration: n / sampleRate, sampleRate };
}

export function concatWavs(paths, outPath) {
  if (!paths.length) throw new Error('No wavs to concatenate.');
  const parts = paths.map((p) => readFileSync(p));
  const sampleRate = parts[0].readUInt32LE(24);
  const pcm = Buffer.concat(parts.map((buf) => buf.subarray(44)));
  writeFileSync(outPath, buildWav(pcm, sampleRate, 2));
  const duration = pcm.length / 4 / sampleRate;
  return { duration, sampleRate };
}
