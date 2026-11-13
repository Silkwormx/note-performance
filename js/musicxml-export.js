/**
 * Song (parsed song format) -> MusicXML 4.0 partwise, single treble staff.
 * Used to make the demo files and for "Download MusicXML" in the editor.
 * Notes that cross a bar line are split and tied.
 */
const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MINOR_FIFTHS = { Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7, Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5, Ebm: -6, Abm: -7 };
const DIV = 48; // divisions per quarter: handles 16ths, dots and triplets
const TYPES = [
  [4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0],
  [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.375, '16th', 1], [0.25, '16th', 0], [0.125, '32nd', 0],
];
const SUFFIX_KIND = {
  '': 'major', m: 'minor', '7': 'dominant', maj7: 'major-seventh', m7: 'minor-seventh', dim: 'diminished',
  aug: 'augmented', sus4: 'suspended-fourth', sus2: 'suspended-second', '6': 'major-sixth', m7b5: 'half-diminished',
  '9': 'dominant-ninth', '11': 'dominant-11th', add9: 'major',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function typeFor(beats) {
  for (const [b, type, dots] of TYPES) if (Math.abs(b - beats) < 1e-6) return { type, dots };
  // triplets and odd lengths: nearest plain type, no dots
  let best = TYPES[0];
  for (const t of TYPES) if (Math.abs(t[0] - beats) < Math.abs(best[0] - beats)) best = t;
  return { type: best[1], dots: 0, tuplet: true };
}

/** Split a length into printable pieces (e.g. 5 beats -> 4 + 1). */
function pieces(beats) {
  const out = [];
  let left = beats;
  while (left > 1e-6) {
    const fit = TYPES.find(([b]) => b <= left + 1e-6);
    if (!fit) {
      out.push(left);
      break;
    }
    out.push(fit[0]);
    left -= fit[0];
  }
  return out;
}

export function songToMusicXml(song, { creator = 'Note Performance', rights = '' } = {}) {
  const [num, den] = song.meta.time || [4, 4];
  const barBeats = num * (4 / den);
  const key = song.meta.key || 'C';
  const minor = key in MINOR_FIFTHS;
  const fifths = minor ? MINOR_FIFTHS[key] : FIFTHS[key] ?? 0;
  // letters the key signature already sharpens or flattens
  const keyAcc = {};
  'FCGDAEB'.slice(0, Math.max(0, fifths)).split('').forEach((l) => (keyAcc[l] = '#'));
  'BEADGCF'.slice(0, Math.max(0, -fifths)).split('').forEach((l) => (keyAcc[l] = 'b'));
  const total = Math.max(song.totalBeats, barBeats);
  const bars = Math.ceil(total / barBeats - 1e-9);
  const chords = (song.chords || []).slice().sort((a, b) => a.startBeat - b.startBeat);

  // Flatten notes/rests into per-bar segments.
  const segs = [];
  for (const ev of song.events) {
    let start = ev.startBeat;
    let left = ev.beats;
    let first = true;
    while (left > 1e-6) {
      const barEnd = (Math.floor(start / barBeats + 1e-9) + 1) * barBeats;
      const len = Math.min(left, barEnd - start);
      for (const [i, p] of pieces(len).entries()) {
        const last = left - p <= 1e-6;
        segs.push({ ev, start, beats: p, tieStop: !first, tieStart: !last, lyric: first && i === 0 ? ev.lyric : '' });
        start += p;
        left -= p;
        first = false;
      }
    }
  }

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="4.0">');
  out.push(`  <work><work-title>${esc(song.meta.title || 'Untitled')}</work-title></work>`);
  out.push('  <identification>');
  out.push(`    <creator type="arranger">${esc(creator)}</creator>`);
  if (rights) out.push(`    <rights>${esc(rights)}</rights>`);
  out.push('    <encoding><software>Note Performance</software></encoding>');
  out.push('  </identification>');
  out.push('  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>');
  out.push('  <part id="P1">');
  for (let b = 0; b < bars; b += 1) {
    const b0 = b * barBeats;
    const b1 = b0 + barBeats;
    out.push(`    <measure number="${b + 1}">`);
    if (b === 0) {
      out.push(`      <attributes><divisions>${DIV}</divisions><key><fifths>${fifths}</fifths><mode>${minor ? 'minor' : 'major'}</mode></key>`);
      out.push(`        <time><beats>${num}</beats><beat-type>${den}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`);
      out.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${song.meta.tempo}</per-minute></metronome></direction-type><sound tempo="${song.meta.tempo}"/></direction>`);
    }
    const inBar = segs.filter((s) => s.start >= b0 - 1e-6 && s.start < b1 - 1e-6);
    const barChords = chords.filter((c) => c.startBeat >= b0 - 1e-6 && c.startBeat < b1 - 1e-6);
    let pos = b0;
    const emitHarmony = (upTo) => {
      while (barChords.length && barChords[0].startBeat <= upTo + 1e-6) {
        const c = barChords.shift();
        const off = Math.round((c.startBeat - pos) * DIV);
        if (c.silent) {
          out.push(`      <harmony><root><root-step>C</root-step></root><kind text="N.C.">none</kind>${off ? `<offset>${off}</offset>` : ''}</harmony>`);
        } else {
          const alter = c.acc === '#' ? 1 : c.acc === 'b' ? -1 : 0;
          const suffix = c.name.slice(1 + (c.acc ? 1 : 0));
          const kind = SUFFIX_KIND[suffix] || 'major';
          out.push(`      <harmony><root><root-step>${c.letter}</root-step>${alter ? `<root-alter>${alter}</root-alter>` : ''}</root><kind text="${esc(suffix)}">${kind}</kind>${off ? `<offset>${off}</offset>` : ''}</harmony>`);
        }
      }
    };
    for (const s of inBar) {
      emitHarmony(s.start);
      const dur = Math.round(s.beats * DIV);
      const { type, dots, tuplet } = typeFor(s.beats);
      const parts = ['      <note>'];
      if (s.ev.type === 'rest') parts.push('<rest/>');
      else {
        const alter = s.ev.acc === '#' ? 1 : s.ev.acc === 'b' ? -1 : 0;
        parts.push(`<pitch><step>${s.ev.letter}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${s.ev.octave}</octave></pitch>`);
      }
      parts.push(`<duration>${dur}</duration>`);
      if (s.tieStop && s.ev.type !== 'rest') parts.push('<tie type="stop"/>');
      if (s.tieStart && s.ev.type !== 'rest') parts.push('<tie type="start"/>');
      parts.push(`<voice>1</voice><type>${type}</type>`);
      for (let d = 0; d < dots; d += 1) parts.push('<dot/>');
      if (tuplet) {
        const n = Math.round(1 / (s.beats / ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 }[type] || 1)));
        if (n === 3 || n === 2) parts.push('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
      }
      if (s.ev.type !== 'rest' && (s.ev.acc || '') !== (keyAcc[s.ev.letter] || '')) {
        // (simple rule: printed whenever the note differs from the key signature)
        parts.push(`<accidental>${s.ev.acc === '#' ? 'sharp' : s.ev.acc === 'b' ? 'flat' : 'natural'}</accidental>`);
      }
      const nt = [];
      if (s.tieStop && s.ev.type !== 'rest') nt.push('<tied type="stop"/>');
      if (s.tieStart && s.ev.type !== 'rest') nt.push('<tied type="start"/>');
      if (nt.length) parts.push(`<notations>${nt.join('')}</notations>`);
      if (s.lyric) parts.push(`<lyric number="1"><syllabic>${/-$/.test(s.lyric) ? 'begin' : 'single'}</syllabic><text>${esc(s.lyric.replace(/-$/, ''))}</text></lyric>`);
      parts.push('</note>');
      out.push(parts.join(''));
      pos = s.start + s.beats;
    }
    emitHarmony(b1 - 1e-3);
    if (!inBar.length) out.push(`      <note><rest measure="yes"/><duration>${Math.round(barBeats * DIV)}</duration><voice>1</voice></note>`);
    if (b === bars - 1) out.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
    out.push('    </measure>');
  }
  out.push('  </part>');
  out.push('</score-partwise>');
  return out.join('\n') + '\n';
}
