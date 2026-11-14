#!/usr/bin/env node
// Compare a scanned MusicXML against the true song: note-by-note alignment (edit distance).
// usage: node tools/compare-songs.mjs truth.(txt|musicxml|mxl) scanned.musicxml
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { readMusicXmlFile, musicXmlToSong } from '../js/musicxml.js';
import { parseSong } from '../js/parser.js';

async function load(p) {
  if (p.endsWith('.txt')) return parseSong(readFileSync(p, 'utf8'));
  const buf = readFileSync(p);
  const xml = await readMusicXmlFile(p.endsWith('.mxl') ? buf : buf.toString('utf8'), p, { JSZip });
  return parseSong(musicXmlToSong(xml, { DOMParser, expandRepeats: !process.argv.includes("--page-order") }).text);
}
const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
const truth = (await load(a)).events.filter((e) => e.type === 'note');
const scan = (await load(b)).events.filter((e) => e.type === 'note');
// alignment on pitch (midi); then count rhythm matches among aligned pairs
const n = truth.length, m = scan.length;
const D = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
  D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (truth[i - 1].midi === scan[j - 1].midi ? 0 : 1));
}
let i = n, j = m, pitchOk = 0, rhythmOk = 0, subs = 0;
while (i > 0 && j > 0) {
  const same = truth[i - 1].midi === scan[j - 1].midi;
  if (D[i][j] === D[i - 1][j - 1] + (same ? 0 : 1)) {
    if (same) { pitchOk++; if (Math.abs(truth[i - 1].beats - scan[j - 1].beats) < 1e-6) rhythmOk++; } else subs++;
    i--; j--;
  } else if (D[i][j] === D[i - 1][j] + 1) i--; else j--;
}
const res = {
  trueNotes: n, scannedNotes: m, editDistance: D[n][m],
  pitchAccuracy: +(pitchOk / n * 100).toFixed(1), pitchAndRhythm: +(rhythmOk / n * 100).toFixed(1),
  wrongPitch: subs, missingOrExtra: D[n][m] - subs,
};
console.log(JSON.stringify(res));
