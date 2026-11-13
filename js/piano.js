/**
 * Real piano sound for the live player.
 *
 * Uses Tone.js (MIT, https://tonejs.github.io) Sampler with the Salamander
 * Grand Piano samples (CC-BY 3.0, Alexander Holm), bundled in assets/piano/ so it
 * works offline. Falls back to the old bell synth until the samples have loaded.
 *
 * Interface matches createLiveSynth(): ensure, bell, pad, click, cutPad, stopAll, now.
 * `when` arguments are AudioContext times (seconds); omit for "now".
 */
import { createLiveSynth } from './synth.js';

export const SAMPLE_NOTES = [
  'A1',
  ...['2', '3', '4', '5', '6', '7'].flatMap((o) => [`C${o}`, `Ds${o}`, `Fs${o}`, `A${o}`]),
  'C8',
];

export const PIANO_CREDIT =
  'Piano sound: Salamander Grand Piano by Alexander Holm (CC-BY 3.0). Audio engine: Tone.js (MIT).';

const MELODY_RELEASE = 0.9; // soft sustain after the key is let go
const CHORD_RELEASE = 0.55;

export function createPiano({ baseUrl = 'assets/piano/', onLoad } = {}) {
  const T = typeof window !== 'undefined' ? window.Tone : null;
  const fallback = createLiveSynth();
  let buffers = null;
  let bus = null; // reverb -> compressor -> volume -> speakers
  let sampler = null;
  let gate = null;
  let loaded = false;
  let started = false;

  function rawCtx() {
    return T ? T.getContext().rawContext : null;
  }

  function makeSampler() {
    // A fresh Sampler over the already-decoded buffers is cheap. Each one has its own
    // gate, so pause/seek can fade out every note (even ones scheduled a few ms ahead)
    // without touching the next notes.
    gate = new T.Gain(1).connect(bus);
    const urls = {};
    for (const n of SAMPLE_NOTES) urls[n.replace("s", "#")] = buffers.get(n).get(); // raw AudioBuffer, so disposing a Sampler never frees the shared samples
    sampler = new T.Sampler({ urls, attack: 0.002, release: MELODY_RELEASE, curve: 'exponential' }).connect(gate);
  }

  function build() {
    if (!T) return;
    // Notes are scheduled at exact AudioContext times; no extra Tone lookahead.
    T.getContext().lookAhead = 0;
    const reverb = new T.Reverb({ decay: 2.4, preDelay: 0.01, wet: 0.16 });
    const comp = new T.Compressor({ threshold: -16, ratio: 3, attack: 0.005, release: 0.2 });
    const vol = new T.Volume(-3);
    reverb.chain(comp, vol, T.getDestination());
    bus = reverb;
    const urls = {};
    for (const n of SAMPLE_NOTES) urls[n] = `${n}.mp3`;
    buffers = new T.ToneAudioBuffers({
      urls,
      baseUrl,
      onload: () => {
        makeSampler();
        loaded = true;
        onLoad?.();
      },
      onerror: (e) => console.warn('Piano samples failed to load; using the bell synth.', e),
    });
  }

  try {
    build(); // fetching/decoding does not need a user gesture
  } catch (e) {
    console.warn('Tone.js not available, using the bell synth', e);
  }

  function ensure() {
    if (T) {
      if (!started) {
        started = true;
        T.start().catch(() => {});
      }
      const ctx = rawCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    return fallback.ensure();
  }

  function now() {
    const ctx = rawCtx();
    return ctx ? ctx.currentTime : fallback.now();
  }

  const ready = () => loaded && sampler;

  function noteName(midi) {
    return T.Frequency(midi, 'midi').toNote();
  }

  /** Melody note. dur in wall-clock seconds; vol is the old synth scale (~0.22). */
  function bell(freq, dur, when, vol = 0.22, midi) {
    if (!ready()) return fallback.bell(freq, dur, when, vol);
    ensure();
    const t = when ?? now();
    const m = midi ?? Math.round(69 + 12 * Math.log2(freq / 440));
    sampler.release = MELODY_RELEASE;
    sampler.triggerAttackRelease(noteName(m), Math.max(0.06, dur * 0.97), t, Math.max(0.15, Math.min(1, vol * 3.4)));
  }

  /** Accompaniment chord: softer, struck once with a tiny roll, held for dur, then released. */
  function pad(midis, dur, when, vol = 0.05) {
    if (!midis || !midis.length || dur <= 0) return;
    if (!ready()) return fallback.pad(midis, dur, when, vol);
    ensure();
    const t = when ?? now();
    const hold = Math.max(0.08, dur - 0.03);
    sampler.release = CHORD_RELEASE;
    midis.forEach((m, i) => {
      const off = i * 0.012;
      sampler.triggerAttackRelease(noteName(m), Math.max(0.05, hold - off), t + off, i === 0 ? 0.4 : 0.3);
    });
    sampler.release = MELODY_RELEASE;
  }

  function cutPad(release) {
    if (!ready()) fallback.cutPad(release);
  }

  /** Count-in tick: short wood-block style click. */
  function click(when, strong = false) {
    const ctx = rawCtx();
    if (!ctx) return fallback.click(when, strong);
    ensure();
    const t0 = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(strong ? 1500 : 1100, t0);
    osc.frequency.exponentialRampToValueAtTime(strong ? 900 : 700, t0 + 0.04);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(strong ? 0.28 : 0.18, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }

  /** Silence everything, including notes already scheduled a little ahead. */
  function stopAll() {
    fallback.stopAll();
    if (!ready()) return;
    const oldGate = gate;
    const oldSampler = sampler;
    oldGate.gain.cancelScheduledValues(now());
    oldGate.gain.rampTo(0, 0.05, now());
    setTimeout(() => {
      oldSampler.dispose();
      oldGate.dispose();
    }, 400);
    makeSampler();
  }

  /** Output latency we can compensate for when scheduling ahead. */
  function latency() {
    const ctx = rawCtx();
    if (!ctx) return 0;
    return Math.min(0.08, (ctx.outputLatency || 0) + (ctx.baseLatency || 0));
  }

  return {
    ensure,
    bell,
    pad,
    click,
    cutPad,
    stopAll,
    now,
    latency,
    isLoaded: () => loaded,
    hasContext: () => !!rawCtx(),
  };
}
