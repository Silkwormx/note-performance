/**
 * MusicXML -> Note Performance song text.
 *
 * Reads .musicxml / .xml (uncompressed) and .mxl (zipped, via JSZip, MIT).
 * Pulls out the melody (top voice of the top staff of the first part), plus the key,
 * time signature, tempo, ties, dots/tuplets (from exact durations), rests, lyrics,
 * and chord symbols from <harmony>. When a file has no chord symbols, it guesses one
 * simple chord per measure from all the notes in the part and marks them as a guess.
 *
 * Works in the browser (DOMParser) and in Node tests (pass { DOMParser } from @xmldom/xmldom).
 */
import { midiToPitchToken } from './music.js';

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_BY_FIFTHS = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
const MINOR_BY_FIFTHS = { '-7': 'Abm', '-6': 'Ebm', '-5': 'Bbm', '-4': 'Fm', '-3': 'Cm', '-2': 'Gm', '-1': 'Dm', 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m' };

/** MusicXML <kind> -> a chord suffix the player understands. */
const KIND_SUFFIX = {
  major: '', minor: 'm', augmented: 'aug', diminished: 'dim', dominant: '7',
  'major-seventh': 'maj7', 'minor-seventh': 'm7', 'diminished-seventh': 'dim',
  'augmented-seventh': 'aug', 'half-diminished': 'm7b5', 'major-minor': 'm7',
  'major-sixth': '6', 'minor-sixth': 'm', 'dominant-ninth': '9', 'major-ninth': 'maj7',
  'minor-ninth': 'm7', 'dominant-11th': '11', 'major-11th': 'maj7', 'minor-11th': 'm7',
  'dominant-13th': '7', 'major-13th': 'maj7', 'minor-13th': 'm7',
  'suspended-second': 'sus2', 'suspended-fourth': 'sus4', power: '', other: '',
};

// ---------- small DOM helpers (work with both browser DOM and xmldom) ----------
function kids(el, name) {
  const out = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || n.nodeName === name)) out.push(n);
  }
  return out;
}
const kid = (el, name) => kids(el, name)[0] || null;
const text = (el) => (el ? String(el.textContent || '').trim() : '');
const num = (el, dflt = 0) => {
  const v = Number(text(el));
  return Number.isFinite(v) ? v : dflt;
};
function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
const lcm = (a, b) => (a / gcd(a, b)) * b;

/** Turn ticks into a duration token the song format reads exactly: 1, 0.5, 2/3 ... */
function beatsToken(ticks, tpq) {
  const g = gcd(ticks, tpq);
  const n = ticks / g;
  const d = tpq / g;
  if (d === 1) return String(n);
  if ([2, 4, 8, 16, 32, 64].includes(d)) return String(n / d);
  return `${n}/${d}`;
}

function cleanLyric(s) {
  return String(s || '').replace(/["']/g, '’').replace(/\s+/g, ' ').trim();
}

// ---------- file handling ----------
export async function readMusicXmlFile(bytesOrText, filename = '', { JSZip } = {}) {
  const name = filename.toLowerCase();
  const isZip =
    name.endsWith('.mxl') ||
    (typeof bytesOrText !== 'string' && bytesOrText && new Uint8Array(bytesOrText.slice ? bytesOrText.slice(0, 2) : bytesOrText)[0] === 0x50);
  if (!isZip) {
    if (typeof bytesOrText === 'string') return bytesOrText;
    return new TextDecoder('utf-8').decode(bytesOrText);
  }
  const Zip = JSZip || (typeof window !== 'undefined' ? window.JSZip : null);
  if (!Zip) throw new Error('Opening .mxl needs JSZip.');
  const zip = await Zip.loadAsync(bytesOrText);
  let path = null;
  const container = zip.file('META-INF/container.xml');
  if (container) {
    const c = await container.async('string');
    const m = c.match(/full-path\s*=\s*"([^"]+)"/);
    if (m) path = m[1];
  }
  if (!path || !zip.file(path)) {
    path = Object.keys(zip.files).find((p) => !p.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(p));
  }
  if (!path) throw new Error('This .mxl file has no MusicXML score inside.');
  return zip.file(path).async('string');
}

function parsePart(part, tpq) {
  let divisions = 1;
  let fifths = null;
  let mode = 'major';
  let modeExplicit = false;
  let timeSig = null;
  let tempo = null;
  let transpose = 0;
  const notes = []; // every pitched note in the part: { on, dur, midi, staff, voice, ... }
  const rests = [];
  const harmonies = []; // { at, name, silent }
  const measures = []; // { start, len, nominal, implicit }
  let measureStart = 0;
  let sawRepeat = false;
  let sawTempoChange = false;
  let sawTimeChange = false;
  let sawKeyChange = false;
  let staffCountMax = 1;

  for (const m of kids(part, 'measure')) {
    let cursor = 0;
    let maxCursor = 0;
    let lastOnset = 0;
    const scale = () => tpq / divisions;
    for (const el of kids(m)) {
      const tag = el.nodeName;
      if (tag === 'attributes') {
        const dv = kid(el, 'divisions');
        if (dv) divisions = Math.max(1, num(dv, 1));
        const key = kid(el, 'key');
        if (key && kid(key, 'fifths')) {
          const f = num(kid(key, 'fifths'), 0);
          const md = text(kid(key, 'mode')) || 'major';
          if (kid(key, 'mode')) modeExplicit = true;
          if (fifths != null && (f !== fifths || md !== mode)) sawKeyChange = true;
          if (fifths == null) {
            fifths = f;
            mode = md;
          }
        }
        const time = kid(el, 'time');
        if (time && kid(time, 'beats')) {
          const ts = [parseInt(text(kid(time, 'beats')), 10) || 4, num(kid(time, 'beat-type'), 4)];
          if (timeSig && (ts[0] !== timeSig[0] || ts[1] !== timeSig[1])) sawTimeChange = true;
          if (!timeSig) timeSig = ts;
        }
        const st = kid(el, 'staves');
        if (st) staffCountMax = Math.max(staffCountMax, num(st, 1));
        const tr = kid(el, 'transpose');
        if (tr) transpose = num(kid(tr, 'chromatic'), 0) + 12 * num(kid(tr, 'octave-change'), 0);
      } else if (tag === 'direction' || tag === 'sound') {
        const bpm = readTempo(el);
        if (bpm) {
          if (tempo == null) tempo = bpm;
          else if (Math.abs(bpm - tempo) > 0.5) sawTempoChange = true;
        }
      } else if (tag === 'harmony') {
        const off = Math.round(num(kid(el, 'offset'), 0) * scale());
        harmonies.push({ at: measureStart + cursor + off, ...readHarmony(el) });
      } else if (tag === 'backup') {
        cursor -= Math.round(num(kid(el, 'duration'), 0) * scale());
        if (cursor < 0) cursor = 0;
      } else if (tag === 'forward') {
        cursor += Math.round(num(kid(el, 'duration'), 0) * scale());
        maxCursor = Math.max(maxCursor, cursor);
      } else if (tag === 'barline') {
        if (kid(el, 'repeat') || kid(el, 'ending')) sawRepeat = true;
      } else if (tag === 'note') {
        if (kid(el, 'grace')) continue; // grace notes take no time
        const isChord = !!kid(el, 'chord');
        const dur = Math.round(num(kid(el, 'duration'), 0) * scale());
        const on = isChord ? lastOnset : cursor;
        const staff = num(kid(el, 'staff'), 1);
        const voice = text(kid(el, 'voice')) || '1';
        const abs = measureStart + on;
        if (kid(el, 'rest')) {
          rests.push({ on: abs, dur, staff, voice });
        } else if (kid(el, 'pitch') && !kid(el, 'cue')) {
          const p = kid(el, 'pitch');
          const step = text(kid(p, 'step')).toUpperCase();
          const alter = num(kid(p, 'alter'), 0);
          const octave = num(kid(p, 'octave'), 4);
          const midi = (octave + 1) * 12 + STEP_PC[step] + Math.round(alter) + transpose;
          const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
          for (const n of kids(el, 'notations')) {
            for (const t of kids(n, 'tied')) {
              const ty = t.getAttribute('type');
              if (ty && !ties.includes(ty)) ties.push(ty);
            }
          }
          const ly = kid(el, 'lyric');
          let lyric = '';
          if (ly) {
            lyric = cleanLyric(kids(ly, 'text').map(text).join(''));
            const syl = text(kid(ly, 'syllabic'));
            if (lyric && (syl === 'begin' || syl === 'middle')) lyric += '-';
          }
          notes.push({
            on: abs, dur, midi, staff, voice, step, alter: Math.round(alter), octave,
            tieStart: ties.includes('start'), tieStop: ties.includes('stop'), lyric,
            transposed: transpose !== 0,
          });
        }
        if (!isChord) {
          lastOnset = cursor;
          cursor += dur;
          maxCursor = Math.max(maxCursor, cursor);
        }
      }
    }
    const nominal = timeSig ? Math.round((timeSig[0] * 4 * tpq) / timeSig[1]) : 4 * tpq;
    const implicit = m.getAttribute('implicit') === 'yes';
    let len = maxCursor;
    if (!implicit && len < nominal && measures.length > 0) len = nominal; // underfull measures keep the bar line grid
    if (len <= 0) len = nominal;
    measures.push({ start: measureStart, len, nominal, implicit, number: m.getAttribute('number') });
    measureStart += len;
  }

  return { notes, rests, harmonies, measures, measureStart, fifths, mode, modeExplicit, timeSig, tempo, sawRepeat, sawTempoChange, sawTimeChange, sawKeyChange, staffCountMax };
}

// ---------- main conversion ----------
/**
 * @returns {{ text: string, info: { title, partName, parts, measures, notes, chordsFrom, warnings: string[] } }}
 */
export function musicXmlToSong(xmlText, opts = {}) {
  const Parser = opts.DOMParser || (typeof DOMParser !== 'undefined' ? DOMParser : null);
  if (!Parser) throw new Error('No XML parser available.');
  const doc = new Parser().parseFromString(String(xmlText).replace(/^\uFEFF/, ''), 'application/xml');
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
    throw new Error("This file isn't valid MusicXML.");
  }
  if (root.nodeName === 'score-timewise') {
    throw new Error('Timewise MusicXML is not supported yet. Please export as "partwise" MusicXML.');
  }
  if (root.nodeName !== 'score-partwise') throw new Error("This file isn't a MusicXML score.");

  const warnings = [];
  const parts = kids(root, 'part');
  if (!parts.length) throw new Error('This score has no parts.');
  const partList = kid(root, 'part-list');
  const partNames = {};
  for (const sp of kids(partList, 'score-part')) partNames[sp.getAttribute('id')] = text(kid(sp, 'part-name'));

  const partIndex = Math.min(parts.length - 1, Math.max(0, opts.partIndex ?? pickMelodyPart(parts)));
  const part = parts[partIndex];
  if (parts.length > 1) {
    warnings.push(`This score has ${parts.length} parts; using "${partNames[part.getAttribute('id')] || `part ${partIndex + 1}`}" for the melody.`);
  }

  // Common tick grid: LCM of every <divisions> in the part.
  let tpq = 1;
  for (const d of root.getElementsByTagName('divisions')) tpq = lcm(tpq, Math.max(1, Math.round(num(d, 1))));

  const title =
    opts.title ||
    text(kid(kid(root, 'work'), 'work-title')) ||
    text(kid(root, 'movement-title')) ||
    firstCredit(root) ||
    (opts.filename ? opts.filename.replace(/\.(musicxml|xml|mxl)$/i, '').replace(/[_-]+/g, ' ').trim() : '') ||
    'Imported song';

  const P = parsePart(part, tpq);
  const { notes, harmonies, measures, measureStart, sawRepeat, sawTempoChange, sawTimeChange, sawKeyChange, staffCountMax } = P;
  let { fifths, mode, timeSig, tempo } = P;
  // Other parts (e.g. a separate left-hand or accompaniment part) help with chords and missing tempo.
  const others = parts.filter((p) => p !== part).map((p) => parsePart(p, tpq));
  const allNotes = notes.concat(...others.map((o) => o.notes));
  if (!tempo) tempo = others.map((o) => o.tempo).find(Boolean) || null;
  if (fifths == null) fifths = others.map((o) => o.fifths).find((f) => f != null) ?? null;
  if (!timeSig) timeSig = others.map((o) => o.timeSig).find(Boolean) || null;
  if (!P.modeExplicit && fifths != null && allNotes.length) {
    // No <mode>: call it minor when the piece ends on the relative minor's tonic.
    const lastOn = Math.max(...allNotes.map((n) => n.on));
    const lowest = allNotes.filter((n) => n.on === lastOn).reduce((a, b) => (b.midi < a.midi ? b : a));
    const minorTonic = ((((fifths * 7) % 12) + 12) % 12 + 9) % 12;
    if (((lowest.midi % 12) + 12) % 12 === minorTonic) mode = 'minor';
  }
  let allHarmonies = harmonies;
  if (!allHarmonies.length) allHarmonies = others.map((o) => o.harmonies).find((h) => h.length) || [];
  if (!notes.length) throw new Error('No notes found in this score.');
  if (!timeSig) timeSig = [4, 4];
  if (fifths == null) fifths = 0;
  if (!tempo) {
    tempo = 100;
    warnings.push('No tempo marking found; using 100 BPM.');
  }
  tempo = Math.max(30, Math.min(240, Math.round(tempo)));
  if (sawRepeat) warnings.push('Repeat signs are played straight through once (repeats are not expanded yet).');
  if (sawTempoChange) warnings.push('Tempo changes are ignored; the first tempo is used.');
  if (sawTimeChange) warnings.push('Time signature changes are ignored; the first one is used.');
  if (sawKeyChange) warnings.push('Key changes are shown with the first key signature (the notes are still correct).');

  // Pickup (anacrusis): pad the start with a rest so bars and practice pages line up.
  let shift = 0;
  const first = measures[0];
  if (first && first.len < first.nominal) {
    shift = first.nominal - first.len;
    warnings.push('The pickup measure is padded with a rest so the bars line up.');
  }

  const melody = pickMelody(notes, staffCountMax);
  const melodyTies = mergeTies(melody);
  const keyName = (mode === 'minor' ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS)[fifths] || 'C';
  const preferFlat = fifths < 0;

  // Build the monophonic line with rests in the gaps.
  const lines = [];
  const totalTicks = measureStart;
  const tokensByMeasure = measures.map(() => []);
  const measureAt = (tick) => {
    let lo = 0;
    for (let i = 0; i < measures.length; i += 1) if (measures[i].start <= tick) lo = i;
    return lo;
  };
  const pushRest = (from, to) => {
    // split rests at bar lines for readability
    let t = from;
    while (t < to) {
      const mi = measureAt(t);
      const end = Math.min(to, measures[mi].start + measures[mi].len);
      if (end <= t) break;
      tokensByMeasure[mi].push(`r ${beatsToken(end - t, tpq)}`);
      t = end;
    }
  };
  let t = 0;
  if (shift) tokensByMeasure[0].push(`r ${beatsToken(shift, tpq)}`);
  for (const n of melodyTies) {
    if (n.on > t) pushRest(t, n.on);
    const tok = spell(n, preferFlat);
    const lyric = n.lyric ? ` "${n.lyric}"` : '';
    tokensByMeasure[measureAt(n.on)].push(`${tok} ${beatsToken(n.dur, tpq)}${lyric}`);
    t = n.on + n.dur;
  }
  if (t < totalTicks) pushRest(t, totalTicks);

  // Chords: explicit symbols first, otherwise a per-measure guess.
  let chordsFrom = 'none';
  let chordSeq = [];
  if (allHarmonies.length) {
    chordsFrom = 'file';
    chordSeq = allHarmonies
      .filter((h) => h.name)
      .sort((a, b) => a.at - b.at)
      .filter((h, i, arr) => i === 0 || h.at !== arr[i - 1].at);
  } else if (opts.inferChords !== false) {
    chordSeq = inferChords(allNotes, measures, fifths, mode);
    if (chordSeq.length) {
      chordsFrom = 'guess';
      warnings.push('This file has no chord symbols, so the chords are a best guess from the notes (one per measure).');
    }
  }
  const chordTokens = [];
  if (chordSeq.length) {
    let ct = 0;
    const end = totalTicks;
    const firstAt = chordSeq[0].at;
    if (firstAt > 0) chordTokens.push(`N.C.:${beatsToken(firstAt + shift, tpq)}`);
    else if (shift) chordTokens.push(`N.C.:${beatsToken(shift, tpq)}`);
    ct = firstAt;
    chordSeq.forEach((h, i) => {
      const next = i + 1 < chordSeq.length ? chordSeq[i + 1].at : end;
      const len = next - h.at;
      if (len > 0) chordTokens.push(`${h.silent ? 'N.C.' : h.name}:${beatsToken(len, tpq)}`);
      ct = next;
    });
    void ct;
  }

  const head = [
    `# Imported from MusicXML${opts.filename ? ` (${opts.filename})` : ''}`,
    `title: ${title.replace(/\s+/g, ' ').trim()}`,
    `tempo: ${tempo}`,
    `key: ${keyName}`,
    `time: ${timeSig[0]}/${timeSig[1]}`,
  ];
  if (chordsFrom === 'guess') head.push('chordguess: yes');
  for (const w of warnings) head.push(`# Note: ${w}`);
  lines.push(...head, '');
  if (chordTokens.length) {
    // 4 chords per line for readability
    for (let i = 0; i < chordTokens.length; i += 4) lines.push(`chords: ${chordTokens.slice(i, i + 4).join(' | ')}`);
    lines.push('');
  }
  tokensByMeasure.forEach((toks, i) => {
    if (toks.length) lines.push(`${toks.join('  ')}  |`);
  });

  return {
    text: lines.join('\n') + '\n',
    info: {
      title,
      key: keyName,
      tempo,
      time: timeSig,
      partName: partNames[part.getAttribute('id')] || '',
      parts: parts.length,
      measures: measures.length,
      notes: melodyTies.length,
      chordsFrom,
      chords: chordSeq.length,
      warnings,
    },
  };
}

function firstCredit(root) {
  for (const c of kids(root, 'credit')) {
    const type = text(kid(c, 'credit-type'));
    const words = kids(c, 'credit-words').map(text).join(' ').trim();
    if (words && (!type || type === 'title')) return words;
  }
  return '';
}

function readTempo(el) {
  // <sound tempo="..."> (quarter notes per minute) wins; else a <metronome> mark.
  const sounds = el.nodeName === 'sound' ? [el] : kids(el, 'sound');
  for (const s of sounds) {
    const v = Number(s.getAttribute('tempo'));
    if (Number.isFinite(v) && v > 0) return v;
  }
  if (el.nodeName !== 'direction') return null;
  for (const dt of kids(el, 'direction-type')) {
    const met = kid(dt, 'metronome');
    if (!met) continue;
    const unit = text(kid(met, 'beat-unit'));
    const dotted = !!kid(met, 'beat-unit-dot');
    const per = num(kid(met, 'per-minute'), 0);
    if (!per) continue;
    const q = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[unit] || 1;
    return per * q * (dotted ? 1.5 : 1);
  }
  return null;
}

function readHarmony(el) {
  const root = kid(el, 'root');
  const kindEl = kid(el, 'kind');
  const kind = text(kindEl) || 'major';
  if (kind === 'none' || !root) return { name: 'N.C.', silent: true };
  const step = text(kid(root, 'root-step')).toUpperCase();
  const alter = num(kid(root, 'root-alter'), 0);
  if (!STEP_PC.hasOwnProperty(step)) return { name: '' };
  const acc = alter > 0 ? '#' : alter < 0 ? 'b' : '';
  let suffix = KIND_SUFFIX[kind];
  if (suffix == null) suffix = /minor/.test(kind) ? 'm' : '';
  // Chords with an extra in <degree> stay as their base triad/seventh.
  return { name: `${step}${acc}${suffix}`, silent: false, kind };
}

/** Prefer the part with the most notes on a treble-ish staff (usually the first). */
function pickMelodyPart(parts) {
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].getElementsByTagName('pitch').length) return i;
  }
  return 0;
}

/** Top voice of the top staff; on stacked chord notes keep the highest. */
function pickMelody(notes, staves) {
  let pool = notes;
  if (staves > 1 || notes.some((n) => n.staff !== 1)) {
    const top = Math.min(...notes.map((n) => n.staff));
    pool = notes.filter((n) => n.staff === top);
  }
  // choose the voice that is highest on average among voices on this staff
  const byVoice = new Map();
  for (const n of pool) {
    if (!byVoice.has(n.voice)) byVoice.set(n.voice, []);
    byVoice.get(n.voice).push(n);
  }
  let voice = null;
  let best = -Infinity;
  for (const [v, list] of byVoice) {
    const avg = list.reduce((s, n) => s + n.midi, 0) / list.length;
    const score = avg + Math.min(6, list.length / 8); // slight preference for the busier voice
    if (score > best) {
      best = score;
      voice = v;
    }
  }
  pool = pool.filter((n) => n.voice === voice);
  const byOnset = new Map();
  for (const n of pool) {
    const cur = byOnset.get(n.on);
    if (!cur || n.midi > cur.midi) byOnset.set(n.on, n);
  }
  const line = [...byOnset.values()].sort((a, b) => a.on - b.on).map((n) => ({ ...n }));
  // no overlaps in a single line
  for (let i = 0; i < line.length - 1; i += 1) {
    const end = line[i].on + line[i].dur;
    if (end > line[i + 1].on) line[i].dur = line[i + 1].on - line[i].on;
  }
  return line.filter((n) => n.dur > 0);
}

function mergeTies(line) {
  const out = [];
  for (const n of line) {
    const prev = out[out.length - 1];
    if (prev && n.tieStop && prev.tieStart && prev.midi === n.midi && prev.on + prev.dur === n.on) {
      prev.dur += n.dur;
      prev.tieStart = n.tieStart;
      continue;
    }
    out.push({ ...n });
  }
  return out;
}

function spell(n, preferFlat) {
  if (!n.transposed && Math.abs(n.alter) <= 1 && STEP_PC.hasOwnProperty(n.step)) {
    const acc = n.alter === 1 ? '#' : n.alter === -1 ? 'b' : '';
    return `${n.step}${acc}${n.octave}`;
  }
  // double sharps/flats (or transposed parts): respell to the nearest simple name
  return midiToPitchToken(n.midi, preferFlat);
}

// ---------- chord guessing ----------
const TRIADS = { '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], '7': [0, 4, 7, 10] };
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function diatonicCandidates(fifths, mode) {
  const tonicMajor = ((fifths * 7) % 12 + 12) % 12;
  const tonic = mode === 'minor' ? (tonicMajor + 9) % 12 : tonicMajor;
  const names = fifths < 0 ? NAMES_FLAT : NAMES_SHARP;
  const scale = mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const quals = mode === 'minor' ? ['m', 'dim', '', 'm', '', '', ''] : ['', 'm', 'm', '', '', 'm', 'dim'];
  // how common each degree is in simple songs (I, IV, V strongest)
  const prior = mode === 'minor' ? [1.0, 0.1, 0.4, 0.7, 0.9, 0.5, 0.4] : [1.0, 0.45, 0.3, 0.8, 0.9, 0.5, 0.1];
  const out = [];
  scale.forEach((deg, i) => {
    const root = (tonic + deg) % 12;
    out.push({ root, q: quals[i], prior: prior[i] });
  });
  // V7 and the major V in minor (harmonic minor)
  const five = (tonic + 7) % 12;
  out.push({ root: five, q: '7', prior: 0.6 });
  if (mode === 'minor') out.push({ root: five, q: '', prior: 0.8 });
  return out.map((c) => ({ ...c, name: `${names[c.root]}${c.q}`, tones: TRIADS[c.q].map((iv) => (c.root + iv) % 12) }));
}

export function inferChords(notes, measures, fifths = 0, mode = 'major') {
  const cands = diatonicCandidates(fifths, mode);
  const out = [];
  for (const m of measures) {
    const w = new Array(12).fill(0);
    let bass = null;
    const end = m.start + m.len;
    for (const n of notes) {
      const s = Math.max(n.on, m.start);
      const e = Math.min(n.on + n.dur, end);
      if (e <= s) continue;
      let weight = (e - s) / m.len;
      if (n.on === m.start) weight *= 1.5; // downbeat notes count more
      w[((n.midi % 12) + 12) % 12] += weight;
      if (n.on <= m.start + m.len / 4 && (!bass || n.midi < bass.midi)) bass = n;
    }
    const total = w.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      out.push({ at: m.start, name: 'N.C.', silent: true });
      continue;
    }
    let best = null;
    for (const c of cands) {
      let s = 0;
      for (let pc = 0; pc < 12; pc += 1) s += c.tones.includes(pc) ? w[pc] : -0.6 * w[pc];
      s /= total;
      if (c.q === '7' && !(w[(c.root + 10) % 12] > 0)) s -= 0.15; // only call it a 7th if the 7th is there
      if (bass && bass.midi < 57 && ((bass.midi % 12) + 12) % 12 === c.root) s += 0.15; // only a real bass line counts
      s += 0.12 * c.prior;
      if (!best || s > best.s) best = { s, c };
    }
    out.push({ at: m.start, name: best.c.name, silent: false, guess: true });
  }
  // merge repeats of the same chord
  return out.filter((h, i) => i === 0 || h.name !== out[i - 1].name);
}
