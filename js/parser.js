import { parsePitch, parseDuration, toMidi, parseChordSymbol } from './music.js';

const HEADER = /^(title|tempo|key|time|lookahead)\s*:\s*(.+)$/i;

export function parseSong(text) {
  const meta = { title: 'Untitled', tempo: 100, key: 'C', time: [4, 4] };
  const events = [];
  const chords = [];
  const errors = [];
  let beat = 0;
  let chordBeat = 0;
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    const chordHeader = line.match(/^chords\s*:\s*(.*)$/i);
    if (chordHeader) {
      chordBeat = parseChordLine(chordHeader[1], chords, chordBeat, errors, lineNo);
      return;
    }

    const header = line.match(HEADER);
    if (header) {
      applyHeader(meta, header[1].toLowerCase(), header[2].trim(), errors, lineNo);
      return;
    }

    const tokens = tokenize(line);
    let idx = 0;
    while (idx < tokens.length) {
      const tok = tokens[idx];
      if (tok === '|' || tok === '/') {
        idx += 1;
        continue;
      }

      const inline = tok.match(/^\[(.+)\]$/);
      if (inline) {
        const chord = parseChordSymbol(inline[1]);
        if (!chord) {
          errors.push({
            line: lineNo,
            message: `I don't recognize "${inline[1]}" as a chord (try C, F, G7, or Dm).`,
          });
        } else {
          chords.push({
            type: 'chord',
            startBeat: beat,
            beats: null,
            line: lineNo,
            ...chord,
          });
        }
        idx += 1;
        continue;
      }

      const isRest = /^(r|R|rest)$/.test(tok);
      const pitch = isRest ? null : parsePitch(tok);
      if (!isRest && !pitch) {
        errors.push({
          line: lineNo,
          message: `I don't recognize "${tok}" as a pitch (try C4) or a rest (r).`,
        });
        idx += 1;
        continue;
      }

      const durTok = tokens[idx + 1];
      const beats = durTok != null ? parseDuration(durTok) : null;
      if (beats == null) {
        errors.push({
          line: lineNo,
          message: `${tok} needs a duration after it, like q, h, e, w, or q.`,
        });
        idx += 1;
        continue;
      }
      idx += 2;

      let lyric = '';
      const next = tokens[idx];
      if (
        next &&
        next !== '|' &&
        next !== '/' &&
        !parsePitch(next) &&
        !/^(r|R|rest)$/.test(next)
      ) {
        if (parseDuration(next) == null || quoted(next)) {
          lyric = stripQuotes(next);
          idx += 1;
        }
      }

      const ev = {
        type: isRest ? 'rest' : 'note',
        startBeat: beat,
        beats,
        lyric,
        line: lineNo,
      };
      if (!isRest) {
        ev.pitch = pitch.token;
        ev.letter = pitch.letter;
        ev.acc = pitch.acc;
        ev.octave = pitch.octave;
        ev.midi = toMidi(pitch);
      }
      events.push(ev);
      beat += beats;
    }
  });

  const last = events[events.length - 1];
  const totalBeats = last ? last.startBeat + last.beats : 0;
  closeOpenChords(chords, totalBeats);
  return { meta, events, chords, totalBeats, errors };
}

export function songDurationSec(song, { countIn = true, tailBeats = 2, speed = 1 } = {}) {
  const spb = 60 / song.meta.tempo / (speed || 1);
  const ci = countIn ? song.meta.time?.[0] || 4 : 0;
  return (ci + song.totalBeats + tailBeats) * spb;
}

export function countInBeats(song) {
  return song.meta.time?.[0] || 4;
}


function parseChordLine(value, chords, startBeat, errors, lineNo) {
  const tokens = tokenize(value);
  let beat = startBeat;
  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (tok === '|' || tok === '/') {
      idx += 1;
      continue;
    }
    let symbol = tok;
    let durTok = null;
    const colon = tok.match(/^(.+):(.+)$/);
    if (colon) {
      symbol = colon[1];
      durTok = colon[2];
      idx += 1;
    } else {
      durTok = tokens[idx + 1];
      idx += 2;
    }
    const chord = parseChordSymbol(symbol);
    const beats = durTok != null ? parseDuration(durTok) : null;
    if (!chord) {
      errors.push({
        line: lineNo,
        message: `I don't recognize "${symbol}" as a chord (try C, F, G7, or Dm).`,
      });
      continue;
    }
    if (beats == null) {
      errors.push({
        line: lineNo,
        message: `Chord ${symbol} needs a length in beats, like C:4 or G7:2.`,
      });
      continue;
    }
    chords.push({
      type: 'chord',
      startBeat: beat,
      beats,
      line: lineNo,
      ...chord,
    });
    beat += beats;
  }
  return beat;
}

function closeOpenChords(chords, totalBeats) {
  const sorted = chords.slice().sort((a, b) => a.startBeat - b.startBeat || a.line - b.line);
  chords.length = 0;
  chords.push(...sorted);
  for (let i = 0; i < chords.length; i += 1) {
    if (chords[i].beats == null) {
      const end = i + 1 < chords.length ? chords[i + 1].startBeat : totalBeats;
      chords[i].beats = Math.max(0, end - chords[i].startBeat);
    }
  }
}

function applyHeader(meta, key, value, errors, lineNo) {
  if (key === 'title') {
    meta.title = value;
    return;
  }
  if (key === 'tempo') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 30 || n > 240) {
      errors.push({
        line: lineNo,
        message: `Tempo should be a BPM number between 30 and 240 (got "${value}").`,
      });
    } else {
      meta.tempo = n;
    }
    return;
  }
  if (key === 'key') {
    meta.key = value.replace(/\s+/g, '');
    return;
  }
  if (key === 'time') {
    const m = value.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!m) {
      errors.push({ line: lineNo, message: 'Time signature should look like 4/4.' });
    } else {
      meta.time = [Number(m[1]), Number(m[2])];
    }
    return;
  }
  if (key === 'lookahead') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 3 || n > 16) {
      errors.push({
        line: lineNo,
        message: `Lookahead should be how many beats are visible ahead (3–16, got "${value}").`,
      });
    } else {
      meta.lookahead = n;
    }
  }
}

function quoted(s) {
  return (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"));
}

function stripQuotes(s) {
  return quoted(s) ? s.slice(1, -1) : s;
}

function tokenize(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|[^\s|]+|\|/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[0] === '|') out.push('|');
    else if (m[1] != null) out.push(`"${m[1]}"`);
    else if (m[2] != null) out.push(`"${m[2]}"`);
    else out.push(m[0]);
  }
  return out;
}

export function beatsPerBar(song) {
  const [n, d] = song.meta.time || [4, 4];
  return n * (4 / d);
}

export function songPages(song, barsPerPage = 4) {
  const bpb = beatsPerBar(song);
  const bars = Math.max(1, Math.ceil((song.totalBeats - 1e-9) / bpb));
  const count = Math.max(1, Math.ceil(bars / barsPerPage));
  const pages = [];
  for (let i = 0; i < count; i += 1) {
    const startBar = i * barsPerPage;
    const endBar = Math.min(bars, startBar + barsPerPage);
    pages.push({
      index: i,
      number: i + 1,
      count,
      startBar,
      endBar,
      startBeat: startBar * bpb,
      endBeat: endBar * bpb,
    });
  }
  return pages;
}
