/** Pitch colors, MIDI, solfège, and note helpers. */

export const LETTER_COLORS = {
  C: '#E44B3C',
  D: '#F09A2A',
  E: '#F0C93A',
  F: '#7BC85A',
  G: '#1FB3A8',
  A: '#7B5EC8',
  B: '#EE7AAF',
};

export const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const LETTER_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
export const DURATION_BEATS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };

export const SOLFEGE_SHARPS = [
  'do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti',
];
export const SOLFEGE_FLATS = [
  'do', 'ra', 're', 'me', 'mi', 'fa', 'se', 'sol', 'le', 'la', 'te', 'ti',
];

export const KEYS = {
  C: { pc: 0, acc: 'sharp' },
  G: { pc: 7, acc: 'sharp' },
  D: { pc: 2, acc: 'sharp' },
  A: { pc: 9, acc: 'sharp' },
  E: { pc: 4, acc: 'sharp' },
  B: { pc: 11, acc: 'sharp' },
  F: { pc: 5, acc: 'flat' },
  Bb: { pc: 10, acc: 'flat' },
  Eb: { pc: 3, acc: 'flat' },
  Ab: { pc: 8, acc: 'flat' },
  Db: { pc: 1, acc: 'flat' },
  Gb: { pc: 6, acc: 'flat' },
  'F#': { pc: 6, acc: 'sharp' },
  'C#': { pc: 1, acc: 'sharp' },
  Am: { pc: 0, acc: 'sharp' },
  Em: { pc: 7, acc: 'sharp' },
  Bm: { pc: 11, acc: 'sharp' },
  Dm: { pc: 2, acc: 'flat' },
  Gm: { pc: 5, acc: 'flat' },
  Cm: { pc: 3, acc: 'flat' },
  Fm: { pc: 5, acc: 'flat' },
  'F#m': { pc: 6, acc: 'sharp' },
  Cb: { pc: 11, acc: 'flat' },
  'C#m': { pc: 1, acc: 'sharp' },
  'G#m': { pc: 8, acc: 'sharp' },
  'D#m': { pc: 3, acc: 'sharp' },
  'A#m': { pc: 10, acc: 'sharp' },
  Bbm: { pc: 10, acc: 'flat' },
  Ebm: { pc: 3, acc: 'flat' },
  Abm: { pc: 8, acc: 'flat' },
};

const MINOR_KEYS = new Set(['Am', 'Em', 'Bm', 'Dm', 'Gm', 'Cm', 'Fm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Bbm', 'Ebm', 'Abm']);

export function parsePitch(token) {
  const m = String(token).trim().match(/^([A-G])(#|b)?(\d)$/);
  if (!m) return null;
  return { letter: m[1], acc: m[2] || '', octave: Number(m[3]), token: `${m[1]}${m[2] || ''}${m[3]}` };
}

export function toMidi(pitch) {
  const p = typeof pitch === 'string' ? parsePitch(pitch) : pitch;
  if (!p) return null;
  const acc = p.acc === '#' ? 1 : p.acc === 'b' ? -1 : 0;
  return (p.octave + 1) * 12 + LETTER_PC[p.letter] + acc;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function pitchLetter(pitch) {
  const p = typeof pitch === 'string' ? parsePitch(pitch) : pitch;
  return p ? p.letter : '';
}

export function colorForPitch(pitch) {
  const letter = pitchLetter(pitch);
  return LETTER_COLORS[letter] || '#888888';
}

export function displayLetter(pitch) {
  const p = typeof pitch === 'string' ? parsePitch(pitch) : pitch;
  if (!p) return '';
  const mark = p.acc === '#' ? '♯' : p.acc === 'b' ? '♭' : '';
  return p.letter + mark;
}

/** Diatonic steps above E4 (bottom line of the treble staff). C4 = -2, E4 = 0, F5 = 8. */
export function stepsFromE4(pitch) {
  const p = typeof pitch === 'string' ? parsePitch(pitch) : pitch;
  if (!p) return 0;
  return (p.octave - 4) * 7 + (LETTER_STEP[p.letter] - LETTER_STEP.E);
}

export function solfegeFor(pitch, key = 'C') {
  const midi = toMidi(pitch);
  const info = KEYS[key] || KEYS.C;
  const pc = ((midi - info.pc) % 12 + 12) % 12;
  const table = info.acc === 'flat' ? SOLFEGE_FLATS : SOLFEGE_SHARPS;
  return table[pc];
}

export function parseDuration(token) {
  const t = String(token).trim();
  const m = t.match(/^([whqes])(\.)?$/i);
  if (m) return DURATION_BEATS[m[1].toLowerCase()] * (m[2] ? 1.5 : 1);
  // Triplet values: tq = 2/3 (quarter triplet), te = 1/3, th = 4/3
  const trip = t.match(/^t([qeh])$/i);
  if (trip) return (DURATION_BEATS[trip[1].toLowerCase()] * 2) / 3;
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split('/').map(Number);
    if (b) return a / b;
  }
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function lighten(hex, amt = 0.45) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return rgbToHex(mix(r), mix(g), mix(b));
}

export function darken(hex, amt = 0.25) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => Math.round(c * (1 - amt));
  return rgbToHex(mix(r), mix(g), mix(b));
}

export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function keyLabel(key) {
  if (!key) return 'C major';
  if (MINOR_KEYS.has(key)) return `${key.slice(0, -1)} minor`;
  return `${key} major`;
}


const CHORD_QUALITIES = [
  'maj7', 'm7b5', 'min7', 'maj', 'min', 'dim', 'aug', 'sus4', 'sus2', 'add9', 'm7', 'm', '7', '6', '9', '11',
];
const QUALITY_INTERVALS = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  '6': [0, 4, 7, 9],
  '9': [0, 4, 7, 10, 14],
  '11': [0, 4, 7, 10, 17],
  add9: [0, 4, 7, 14],
};
function normalizeQuality(raw) {
  const q = (raw || '').toLowerCase();
  if (q === 'maj') return '';
  if (q === 'min') return 'm';
  if (q === 'min7') return 'm7';
  return q;
}

export function parseChordSymbol(token) {
  const t = String(token || '').trim();
  if (/^(n\.?c\.?|nc|-)$/i.test(t)) {
    return { name: 'N.C.', letter: '', acc: '', quality: '', rootPc: null, intervals: [], silent: true };
  }
  const m = t.match(/^([A-G])(#|b)?(.*)$/i);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = m[2] || '';
  const rawQual = m[3] || '';
  if (rawQual && !CHORD_QUALITIES.some((q) => q.toLowerCase() === rawQual.toLowerCase())) {
    return null;
  }
  const quality = normalizeQuality(rawQual);
  if (!(quality in QUALITY_INTERVALS) && quality !== '') return null;
  const rootPc = (LETTER_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
  let displayQual = rawQual;
  if (displayQual.toLowerCase() === 'min') displayQual = 'm';
  if (displayQual.toLowerCase() === 'maj') displayQual = '';
  return {
    name: `${letter}${acc}${displayQual}`,
    letter,
    acc,
    quality,
    rootPc,
    intervals: QUALITY_INTERVALS[quality] || QUALITY_INTERVALS[''],
    silent: false,
  };
}

const CHORD_COLORS = {
  C: '#E44B3C',
  F: '#7BC85A',
  G: '#1FB3A8',
  G7: '#148FA3',
  Gb: '#C4A84A',
  Dm: '#F09A2A',
  Am: '#7B5EC8',
  Ab: '#C46B8A',
  D: '#F09A2A',
  E: '#F0C93A',
  A: '#7B5EC8',
  B: '#EE7AAF',
  Em: '#C9A227',
  Fm: '#5FA36A',
  Cm: '#C45C3E',
};

export function colorForChord(chord) {
  if (!chord || chord.silent || !chord.letter) return '#8A7A6C';
  if (CHORD_COLORS[chord.name]) return CHORD_COLORS[chord.name];
  return LETTER_COLORS[chord.letter] || '#8A7A6C';
}

/** Close voicing under the melody, roughly G2–G4, with the root in the bass. */
export function chordMidis(chord, bassOctave = 3) {
  if (!chord || chord.silent || chord.rootPc == null) return [];
  const root = (bassOctave + 1) * 12 + chord.rootPc;
  const midis = [];
  const bass = root > 55 ? root - 12 : root;
  midis.push(bass);
  for (const iv of chord.intervals) {
    let m = root + iv;
    while (m > 67) m -= 12;
    while (m < 48) m += 12;
    if (!midis.includes(m) && m !== bass) midis.push(m);
  }
  return midis.sort((a, b) => a - b);
}

export function isAccidental(pitch) {
  const parsed = typeof pitch === 'string' ? parsePitch(pitch) : pitch;
  return !!(parsed && parsed.acc);
}

export function accidentalMark(pitch) {
  const parsed = typeof pitch === 'string' ? parsePitch(pitch) : pitch;
  if (!parsed) return '';
  return parsed.acc === '#' ? '♯' : parsed.acc === 'b' ? '♭' : '';
}

/** Same letter-family color, deepened for sharps and flats. */
export function noteColor(pitch) {
  const base = colorForPitch(pitch);
  return isAccidental(pitch) ? darken(base, 0.28) : base;
}

export function midiIsBlack(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

const SHARP_SPELL = {
  0: ['C', ''],
  1: ['C', '#'],
  2: ['D', ''],
  3: ['D', '#'],
  4: ['E', ''],
  5: ['F', ''],
  6: ['F', '#'],
  7: ['G', ''],
  8: ['G', '#'],
  9: ['A', ''],
  10: ['A', '#'],
  11: ['B', ''],
};
const FLAT_SPELL = {
  0: ['C', ''],
  1: ['D', 'b'],
  2: ['D', ''],
  3: ['E', 'b'],
  4: ['E', ''],
  5: ['F', ''],
  6: ['G', 'b'],
  7: ['G', ''],
  8: ['A', 'b'],
  9: ['A', ''],
  10: ['B', 'b'],
  11: ['B', ''],
};

export function midiToPitchToken(midi, preferFlat = false) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const [letter, acc] = (preferFlat ? FLAT_SPELL : SHARP_SPELL)[pc];
  return `${letter}${acc}${octave}`;
}

/** Prefer the spelling the song actually uses for this MIDI, if any. */
export function spellingForMidi(midi, song, preferFlat = false) {
  for (const ev of song?.events || []) {
    if (ev.type === 'note' && ev.midi === midi) return ev.pitch;
  }
  return midiToPitchToken(midi, preferFlat);
}
