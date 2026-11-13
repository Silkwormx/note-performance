/** Browser Web Audio bell synth, matching the offline WAV renderer closely. */

import { midiToFreq } from './music.js';

const PARTIALS = [
  [1.0, 1.0, 1.0],
  [2.003, 0.34, 0.52],
  [3.01, 0.16, 0.38],
  [4.06, 0.09, 0.28],
  [5.15, 0.05, 0.2],
  [6.79, 0.03, 0.15],
  [8.21, 0.016, 0.12],
];

export function createLiveSynth() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  const voices = [];
  let padNodes = [];

  function ensure() {
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function cutPad(release = 0.03) {
    if (!ctx || !padNodes.length) return;
    const t0 = ctx.currentTime;
    for (const node of padNodes) {
      try {
        if (node.gain) {
          node.gain.cancelScheduledValues(t0);
          node.gain.setValueAtTime(node.gain.value, t0);
          node.gain.linearRampToValueAtTime(0.0001, t0 + release);
        }
        if (node.stop) node.stop(t0 + release + 0.02);
      } catch {
        /* already stopped */
      }
    }
    padNodes = [];
  }

  function bell(freq, dur, when, vol = 0.22) {
    const ac = ensure();
    const t0 = when ?? ac.currentTime;
    const rel = Math.max(0.42, dur * 0.95);
    const master = ac.createGain();
    const pan = Math.max(-0.28, Math.min(0.28, (freq - 340) / 850));
    const panner = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (panner) {
      panner.pan.setValueAtTime(pan, t0);
      master.connect(panner);
      panner.connect(ac.destination);
    } else {
      master.connect(ac.destination);
    }
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(vol, t0 + 0.007);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + rel);

    for (const [ratio, amp, decayMul] of PARTIALS) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * ratio, t0);
      g.gain.setValueAtTime(amp, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + rel * decayMul);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + rel + 0.02);
      voices.push(osc);
    }
  }

  function click(when, strong = false) {
    const ac = ensure();
    const t0 = when ?? ac.currentTime;
    const osc1 = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const g = ac.createGain();
    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(strong ? 1240 : 980, t0);
    osc2.frequency.setValueAtTime(strong ? 1860 : 1480, t0);
    g.gain.setValueAtTime(strong ? 0.22 : 0.14, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    osc1.connect(g);
    osc2.connect(g);
    g.connect(ac.destination);
    osc1.start(t0);
    osc2.start(t0);
    osc1.stop(t0 + 0.07);
    osc2.stop(t0 + 0.07);
  }

  function pad(midis, dur, when, vol = 0.05) {
    if (!midis || !midis.length || dur <= 0) return;
    const ac = ensure();
    cutPad(0.03);
    const t0 = when ?? ac.currentTime;
    const attack = Math.min(0.05, dur * 0.2);
    const release = Math.min(0.06, Math.max(0.02, dur * 0.15));
    const hold = Math.max(attack, dur - release);
    const master = ac.createGain();
    master.connect(ac.destination);
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(vol, t0 + attack);
    master.gain.setValueAtTime(vol, t0 + hold);
    master.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    const voiceGain = 1 / Math.sqrt(midis.length);
    for (const midi of midis) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(midiToFreq(midi), t0);
      g.gain.setValueAtTime(voiceGain, t0);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      voices.push(osc);
      padNodes.push(osc);
    }
    padNodes.push(master);
  }

  function stopAll() {
    if (!ctx) return;
    cutPad(0.02);
    for (const v of voices) {
      try {
        v.stop();
      } catch {
        /* already stopped */
      }
    }
    voices.length = 0;
  }

  return {
    ensure,
    bell,
    click,
    pad,
    cutPad,
    stopAll,
    now: () => (ctx ? ctx.currentTime : 0),
  };
}
