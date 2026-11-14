/**
 * "Fix the notes" editor: a simple one-staff score you can tap and correct.
 *
 * Model (plain JSON so it can be saved in localStorage):
 *   doc = { title, tempo, key, fifths, mode, time: [n, d], chordsGuessed,
 *           bars: [{ items: [{ rest } | { step, alter, octave }, beats, lyric], chords: [{ name, beats }],
 *                    nominal, page, sheetIndex, omr: { minGrade, durationOk, lowSpots }, reviewed }] }
 */

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = 'FCGDAEB';
const FLAT_ORDER = 'BEADGCF';
export const MAJOR_BY_FIFTHS = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
export const MINOR_BY_FIFTHS = { '-7': 'Abm', '-6': 'Ebm', '-5': 'Bbm', '-4': 'Fm', '-3': 'Cm', '-2': 'Gm', '-1': 'Dm', 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m' };
export const LOW_GRADE = 0.6;
const EPS = 1e-6;

// ---------- pitch helpers ----------
export function parsePitchToken(tok) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(tok || '').trim());
  if (!m) return null;
  return { step: m[1].toUpperCase(), alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) };
}
export const pitchToken = (n) => `${n.step}${n.alter === 1 ? '#' : n.alter === -1 ? 'b' : ''}${n.octave}`;
export const midiOf = (n) => (n.octave + 1) * 12 + LETTER_PC[n.step] + n.alter;
const posOf = (n) => n.octave * 7 + LETTERS.indexOf(n.step);

export function keyAlter(fifths, step) {
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(step)) return 1;
  if (fifths < 0 && FLAT_ORDER.slice(0, -fifths).includes(step)) return -1;
  return 0;
}

/** Move a note one letter up/down, taking the key signature's sharp/flat. */
export function stepNote(n, dir, fifths) {
  let i = LETTERS.indexOf(n.step) + dir;
  let octave = n.octave;
  if (i > 6) { i = 0; octave += 1; }
  if (i < 0) { i = 6; octave -= 1; }
  const step = LETTERS[i];
  return { ...n, step, octave: Math.max(0, Math.min(8, octave)), alter: keyAlter(fifths, step) };
}

// ---------- durations ----------
const TYPES = [
  [4, 'w', 0], [3, 'h', 1], [2, 'h', 0], [1.5, 'q', 1], [1, 'q', 0],
  [0.75, 'e', 1], [0.5, 'e', 0], [0.375, 's', 1], [0.25, 's', 0],
];
export function durationShape(beats) {
  for (const [b, type, dots] of TYPES) if (Math.abs(b - beats) < EPS) return { type, dots, exact: true };
  let best = TYPES[0];
  for (const t of TYPES) if (Math.abs(t[0] - beats) < Math.abs(best[0] - beats)) best = t;
  return { type: best[1], dots: best[2], exact: false };
}
export function beatsText(b) {
  if (Math.abs(b - Math.round(b)) < EPS) return String(Math.round(b));
  for (let d = 2; d <= 16; d += 1) {
    const n = b * d;
    if (Math.abs(n - Math.round(n)) < 1e-4) {
      if ([2, 4, 8, 16].includes(d)) return String(+b.toFixed(4));
      return `${Math.round(n)}/${d}`;
    }
  }
  return String(+b.toFixed(4));
}
const sumBeats = (items) => items.reduce((s, it) => s + it.beats, 0);

// ---------- import ----------
/** Build a doc from one or more musicXmlToSong() infos (one per scanned page). */
export function docFromImports(imports) {
  const first = imports[0].info;
  const fifths = first.fifths ?? 0;
  const mode = first.mode || 'major';
  const doc = {
    title: first.title || 'Scanned song',
    tempo: first.tempo || 100,
    key: first.key || 'C',
    fifths,
    mode,
    time: first.time || [4, 4],
    chordsGuessed: imports.every((im) => im.info.chordsFrom !== 'file') && imports.some((im) => im.info.chordsFrom === 'guess'),
    hasChords: imports.some((im) => im.info.chordsFrom !== 'none'),
    bars: [],
    warnings: [...new Set(imports.flatMap((im) => im.info.warnings || []))],
  };
  imports.forEach((im, page) => {
    const sheetMeasures = im.sheet?.measures || [];
    im.info.bars.forEach((b, i) => {
      const items = b.items.map((it) => {
        if (it.rest) return { rest: true, beats: it.beats };
        const p = parsePitchToken(it.pitch) || { step: 'B', alter: 0, octave: 4 };
        return { ...p, beats: it.beats, lyric: it.lyric || '' };
      });
      const sm = sheetMeasures[i];
      doc.bars.push({
        items,
        chords: b.chords.map((c) => ({ ...c })),
        nominal: b.nominalBeats,
        pickup: page === 0 && b.pickup,
        page,
        sheetIndex: sm ? i : null,
        omr: sm ? { minGrade: sm.minGrade, durationOk: sm.durationOk, lowSpots: sm.lowSpots || [], box: sm.box } : null,
        reviewed: false,
      });
    });
  });
  return doc;
}

// ---------- checks ----------
export function barIssues(doc, i) {
  const bar = doc.bars[i];
  const out = [];
  const have = sumBeats(bar.items);
  const need = bar.nominal;
  const isLast = i === doc.bars.length - 1;
  if (Math.abs(have - need) > EPS && !(isLast && have < need && doc.bars[0]?.pickup)) {
    out.push({ kind: 'beats', text: `has ${beatsText(have)} beat${have === 1 ? '' : 's'}, needs ${beatsText(need)}`, have, need });
  }
  if (!bar.reviewed && bar.omr) {
    if (bar.omr.minGrade < LOW_GRADE) out.push({ kind: 'unsure', text: "the scanner wasn't sure about some notes" });
    else if (bar.omr.lowSpots?.length) out.push({ kind: 'unsure', text: 'the scanner was unsure about a symbol here' });
  }
  if (!bar.items.some((it) => !it.rest) && !bar.items.length) out.push({ kind: 'empty', text: 'is empty' });
  return out;
}
export const allIssues = (doc) => doc.bars.map((_, i) => ({ bar: i, issues: barIssues(doc, i) })).filter((x) => x.issues.length);

// ---------- export ----------
export function docToSongText(doc) {
  const lines = ['# Scanned with Note Performance — fixed by hand', `title: ${String(doc.title || 'Scanned song').replace(/\s+/g, ' ').trim()}`, `tempo: ${Math.round(doc.tempo) || 100}`, `key: ${doc.key}`, `time: ${doc.time[0]}/${doc.time[1]}`];
  if (doc.chordsGuessed) lines.push('chordguess: yes');
  lines.push('');
  const anyChords = doc.bars.some((b) => b.chords.some((c) => c.name && c.name !== 'N.C.'));
  if (anyChords) {
    const merged = []; // { n, b, cont }
    doc.bars.forEach((b) => {
      const len = sumBeats(b.items);
      if (len <= EPS) return;
      const named = b.chords.filter((c) => c.beats > EPS);
      const tot = sumBeats(named);
      if (!named.length || tot <= EPS) {
        merged.push({ n: 'N.C.', b: len, cont: merged[merged.length - 1]?.n === 'N.C.' });
      } else {
        // chord lengths follow the bar's real length after edits
        let used = 0;
        named.forEach((c, k) => {
          const b2 = k === named.length - 1 ? len - used : (c.beats * len) / tot;
          used += b2;
          if (b2 > EPS) merged.push({ n: c.name || 'N.C.', b: b2, cont: k === 0 && !!c.cont });
        });
      }
    });
    // a chord held over the bar line stays one chord
    for (let i = merged.length - 1; i > 0; i -= 1) {
      if (merged[i].cont && merged[i].n === merged[i - 1].n) {
        merged[i - 1].b += merged[i].b;
        merged.splice(i, 1);
      }
    }
    const ct = merged.map((m) => `${m.n}:${beatsText(m.b)}`);
    for (let i = 0; i < ct.length; i += 4) lines.push(`chords: ${ct.slice(i, i + 4).join(' | ')}`);
    lines.push('');
  }
  doc.bars.forEach((b) => {
    if (!b.items.length) return;
    const toks = b.items.map((it) => {
      if (it.rest) return `r ${beatsText(it.beats)}`;
      const ly = it.lyric ? ` "${String(it.lyric).replace(/"/g, '’')}"` : '';
      return `${pitchToken(it)} ${beatsText(it.beats)}${ly}`;
    });
    lines.push(`${toks.join('  ')}  |`);
  });
  return lines.join('\n') + '\n';
}
function parseBeats(s) {
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    return a / b;
  }
  return Number(s);
}

/** "C G7" or "C:3 G7:1" -> chords for a bar of `len` beats. */
export function parseChordInput(text, len) {
  const parts = String(text || '').trim().split(/[\s|,]+/).filter(Boolean);
  if (!parts.length) return [];
  const withLen = parts.map((p) => {
    const [name, b] = p.split(':');
    return { name: name === '-' || /^n\.?c\.?$/i.test(name) ? 'N.C.' : name, beats: b ? parseBeats(b) : null };
  });
  const fixed = withLen.filter((c) => c.beats != null).reduce((s, c) => s + c.beats, 0);
  const free = withLen.filter((c) => c.beats == null);
  const each = free.length ? Math.max(0, len - fixed) / free.length : 0;
  return withLen.map((c) => ({ name: c.name, beats: c.beats ?? each }));
}
export const chordInputText = (bar) => bar.chords.filter((c) => c.beats > EPS).map((c) => c.name).join(' ');

// ---------- rendering (SVG) ----------
const SP = 12; // staff space px
const H = SP / 2;
const SVGNS = 'http://www.w3.org/2000/svg';
const GLYPH = { gclef: '\u{1D11E}', fclef: '\u{1D122}', sharp: '\u266F', flat: '\u266D', natural: '\u266E', rest: { w: '\u{1D13B}', h: '\u{1D13C}', q: '\u{1D13D}', e: '\u{1D13E}', s: '\u{1D13F}' } };

export function chooseClef(doc) {
  const m = doc.bars.flatMap((b) => b.items.filter((it) => !it.rest).map(midiOf)).sort((a, b) => a - b);
  if (!m.length) return 'treble';
  return m[Math.floor(m.length / 2)] < 55 ? 'bass' : 'treble';
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function itemWidth(it) {
  const shape = durationShape(it.beats);
  let w = 30 + Math.min(4, it.beats) * 7;
  if (shape.dots) w += 6;
  return w;
}

/**
 * Draw the score into `svg`. Returns hit areas.
 * opts: { width, selected: { bar, item }, onPick(bar, item|null, where) }
 */
export function renderScore(svg, doc, opts = {}) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const width = Math.max(320, opts.width || 800);
  const clef = opts.clef || chooseClef(doc);
  const bottomPos = clef === 'treble' ? 30 : 18; // E4 / G2 on the bottom line
  const ksPos = (clef === 'treble' ? { s: [38, 35, 39, 36, 33, 37, 34], f: [34, 37, 33, 36, 32, 35, 31] } : { s: [24, 21, 25, 22, 19, 23, 20], f: [20, 23, 19, 22, 18, 21, 17] });
  const nAcc = Math.abs(doc.fifths || 0);
  const headW = 34 + nAcc * 9;
  const ROW_H = 168;
  const STAFF_TOP = 58; // within a row
  const left = 8;
  const issues = doc.bars.map((_, i) => barIssues(doc, i));

  // lay bars into rows
  const barW = doc.bars.map((b) => 16 + Math.max(1, b.items.length ? b.items.reduce((s, it) => s + itemWidth(it), 0) : 60));
  const rows = [];
  let cur = [];
  let x = left + headW + 22; // first row has the time signature too
  doc.bars.forEach((b, i) => {
    const w = barW[i];
    if (cur.length && x + w > width - 8) {
      rows.push(cur);
      cur = [];
      x = left + headW;
    }
    cur.push(i);
    x += w;
  });
  if (cur.length) rows.push(cur);
  const totalH = rows.length * ROW_H + 20;
  svg.setAttribute('viewBox', `0 0 ${width} ${totalH}`);
  svg.setAttribute('width', '100%');
  svg.removeAttribute('height');
  svg.style.aspectRatio = `${width} / ${totalH}`;

  const hits = [];
  rows.forEach((row, r) => {
    const g = el('g', { transform: `translate(0 ${r * ROW_H})` }, svg);
    const yTop = STAFF_TOP;
    const yBot = yTop + 4 * SP;
    const yOf = (pos) => yBot - (pos - bottomPos) * H;
    // stretch the row to the full width (except a short last row)
    const natural = row.reduce((s, i) => s + barW[i], 0);
    const startX = left + headW + (r === 0 ? 22 : 0);
    const avail = width - 8 - startX;
    const stretch = r === rows.length - 1 && natural < avail * 0.7 ? 1 : avail / natural;
    const endX = startX + natural * stretch;
    for (let l = 0; l < 5; l += 1) el('line', { x1: left, x2: endX, y1: yTop + l * SP, y2: yTop + l * SP, class: 'staff-line' }, g);
    // clef, key, time
    const ct = el('text', { x: left + 2, y: clef === 'treble' ? yTop + 3 * SP + 2 : yTop + SP + 1, class: 'glyph clef' }, g);
    ct.textContent = clef === 'treble' ? GLYPH.gclef : GLYPH.fclef;
    for (let k = 0; k < nAcc; k += 1) {
      const pos = doc.fifths > 0 ? ksPos.s[k] : ksPos.f[k];
      const t = el('text', { x: left + 34 + k * 9, y: yOf(pos) + 5, class: 'glyph acc' }, g);
      t.textContent = doc.fifths > 0 ? GLYPH.sharp : GLYPH.flat;
    }
    if (r === 0) {
      const tx = left + headW + 4;
      el('text', { x: tx, y: yTop + SP * 2 - 2, class: 'timesig' }, g).textContent = doc.time[0];
      el('text', { x: tx, y: yTop + SP * 4 - 2, class: 'timesig' }, g).textContent = doc.time[1];
    }
    let bx = startX;
    row.forEach((bi) => {
      const bar = doc.bars[bi];
      const bw = barW[bi] * stretch;
      const flagged = issues[bi].length > 0;
      const selBar = opts.selected && opts.selected.bar === bi;
      // bar background (tap target) and flag
      const bg = el('rect', { x: bx, y: 4, width: bw, height: ROW_H - 12, rx: 6, class: `bar-bg${flagged ? ' flagged' : ''}${selBar ? ' sel' : ''}`, 'data-bar': bi }, g);
      hits.push({ el: bg, bar: bi, item: null });
      // bar number + chord labels
      el('text', { x: bx + 3, y: yTop - 30, class: 'barnum' }, g).textContent = String(bi + 1);
      const chordZone = el('rect', { x: bx, y: 8, width: bw, height: 30, class: 'chord-zone', 'data-bar': bi, 'data-chords': '1' }, g);
      hits.push({ el: chordZone, bar: bi, item: null, where: 'chords' });
      const barLen = Math.max(EPS, sumBeats(bar.items) || bar.nominal);
      let cBeat = 0;
      const ctot = sumBeats(bar.chords) || 1;
      bar.chords.forEach((c) => {
        if (c.beats <= EPS) return;
        const cx = bx + 10 + (cBeat / ctot) * (bw - 16);
        const t = el('text', { x: cx, y: 32, class: `chord${doc.chordsGuessed ? ' guess' : ''}` }, g);
        t.textContent = c.name === 'N.C.' ? '–' : c.name;
        cBeat += c.beats;
      });
      if (!bar.chords.length && doc.hasChords !== false) {
        el('text', { x: bx + 10, y: 32, class: 'chord empty' }, g).textContent = '+';
      }
      void barLen;
      // items
      let ix = bx + 14;
      const seen = {};
      bar.items.forEach((it, ii) => {
        const iw = itemWidth(it) * stretch;
        const sel = opts.selected && opts.selected.bar === bi && opts.selected.item === ii;
        const cls = `item${sel ? ' sel' : ''}`;
        const ig = el('g', { class: cls }, g);
        const shape = durationShape(it.beats);
        const hx = ix + 8;
        if (it.rest) {
          const t = el('text', { x: hx - 4, y: shape.type === 'w' ? yTop + SP + 2 : shape.type === 'h' ? yTop + 2 * SP + 1 : yTop + 2.5 * SP + 4, class: `glyph rest r-${shape.type}` }, ig);
          t.textContent = GLYPH.rest[shape.type];
          if (shape.dots) el('circle', { cx: hx + 16, cy: yTop + 1.5 * SP, r: 2, class: 'dot' }, ig);
        } else {
          const pos = posOf(it);
          const y = yOf(pos);
          // ledger lines
          for (let p = bottomPos - 2; p >= pos; p -= 2) el('line', { x1: hx - 9, x2: hx + 9, y1: yOf(p), y2: yOf(p), class: 'ledger' }, ig);
          for (let p = bottomPos + 10; p <= pos; p += 2) el('line', { x1: hx - 9, x2: hx + 9, y1: yOf(p), y2: yOf(p), class: 'ledger' }, ig);
          // accidental if it differs from the key or from earlier in the bar
          const k = `${it.step}${it.octave}`;
          const expected = k in seen ? seen[k] : keyAlter(doc.fifths, it.step);
          if (it.alter !== expected) {
            const t = el('text', { x: hx - 19, y: y + 5, class: 'glyph acc' }, ig);
            t.textContent = it.alter === 1 ? GLYPH.sharp : it.alter === -1 ? GLYPH.flat : GLYPH.natural;
          }
          seen[k] = it.alter;
          const open = shape.type === 'w' || shape.type === 'h';
          el('ellipse', { cx: hx, cy: y, rx: 6.6, ry: 4.8, transform: `rotate(-20 ${hx} ${y})`, class: open ? 'head open' : 'head' }, ig);
          if (shape.type !== 'w') {
            const up = pos < bottomPos + 4;
            const sx = up ? hx + 6 : hx - 6;
            const sy2 = up ? y - 3.5 * SP : y + 3.5 * SP;
            el('line', { x1: sx, x2: sx, y1: y, y2: sy2, class: 'stem' }, ig);
            const flags = shape.type === 'e' ? 1 : shape.type === 's' ? 2 : 0;
            for (let f = 0; f < flags; f += 1) {
              const fy = sy2 + (up ? f * 8 : -f * 8);
              el('path', { d: up ? `M${sx} ${fy} q 10 8 6 20` : `M${sx} ${fy} q 10 -8 6 -20`, class: 'flag' }, ig);
            }
          }
          if (shape.dots) el('circle', { cx: hx + 11, cy: y - (pos % 2 === bottomPos % 2 ? 4 : 0), r: 2.2, class: 'dot' }, ig);
          if (it.lyric) {
            const t = el('text', { x: hx - 6, y: yBot + 52, class: 'lyric' }, ig);
            t.textContent = it.lyric;
          }
        }
        if (!shape.exact) el('text', { x: hx - 3, y: yTop - 8, class: 'odd' }, ig).textContent = beatsText(it.beats);
        const hit = el('rect', { x: ix, y: yTop - 22, width: iw, height: 4 * SP + 44, class: 'hit', 'data-bar': bi, 'data-item': ii }, g);
        hits.push({ el: hit, bar: bi, item: ii });
        ix += iw;
      });
      // insertion caret when the bar (not a note) is selected
      if (selBar && opts.selected.item == null) el('line', { x1: ix + 2, x2: ix + 2, y1: yTop - 10, y2: yBot + 10, class: 'caret' }, g);
      bx += bw;
      el('line', { x1: bx, x2: bx, y1: yTop, y2: yBot, class: bi === doc.bars.length - 1 ? 'barline end' : 'barline' }, g);
      if (flagged) el('text', { x: bx - 16, y: yBot + 28, class: 'flag-mark' }, g).textContent = '!';
    });
  });
  for (const h of hits) {
    h.el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      opts.onPick?.(h.bar, h.item, h.where || 'staff');
    });
  }
  return { rows, hits };
}
