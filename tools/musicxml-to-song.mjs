#!/usr/bin/env node
// Convert MusicXML (.musicxml/.xml/.mxl) to the song .txt format.
// usage: node tools/musicxml-to-song.mjs in.musicxml [out.txt]
import { readFileSync, writeFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { readMusicXmlFile, musicXmlToSong } from '../js/musicxml.js';
import { parseSong } from '../js/parser.js';

const [inp, out] = process.argv.slice(2);
if (!inp) {
  console.error('usage: node tools/musicxml-to-song.mjs in.musicxml [out.txt]');
  process.exit(2);
}
const buf = readFileSync(inp);
const xml = await readMusicXmlFile(inp.endsWith('.mxl') ? buf : buf.toString('utf8'), inp, { JSZip });
const { text, info } = musicXmlToSong(xml, { DOMParser, filename: inp.split('/').pop() });
const song = parseSong(text);
if (out) writeFileSync(out, text);
else process.stdout.write(text);
console.error(`${info.title}: ${info.notes} melody notes, ${info.measures} measures, key ${info.key}, ${info.time.join('/')}, ${info.tempo} BPM, chords from ${info.chordsFrom}; parse errors: ${song.errors.length}`);
for (const w of info.warnings) console.error(`  note: ${w}`);
