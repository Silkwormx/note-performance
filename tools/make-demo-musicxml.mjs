#!/usr/bin/env node
// Builds the public-domain demo songs as MusicXML from songs/*.txt (our own CC0 encodings).
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { parseSong } from '../js/parser.js';
import { songToMusicXml } from '../js/musicxml-export.js';

const rights = 'Public domain melody. This encoding: CC0 1.0 (Note Performance).';
const plain = [
  ['songs/twinkle.txt', 'songs/demo/twinkle.musicxml'],
  ['songs/ode.txt', 'songs/demo/ode-to-joy.musicxml'],
  ['songs/frere-jacques.txt', 'songs/demo/frere-jacques.musicxml'],
];
for (const [src, out] of plain) {
  const song = parseSong(readFileSync(src, 'utf8'));
  if (song.errors.length) throw new Error(`${src}: ${JSON.stringify(song.errors)}`);
  writeFileSync(out, songToMusicXml(song, { rights }));
  console.log('wrote', out);
}
// Mary as a compressed .mxl, to exercise the zip path.
const mary = parseSong(readFileSync('songs/mary.txt', 'utf8'));
const zip = new JSZip();
zip.file('mimetype', 'application/vnd.recordare.musicxml', { compression: 'STORE' });
zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles><rootfile full-path="mary.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>\n');
zip.file('mary.musicxml', songToMusicXml(mary, { rights }));
writeFileSync('songs/demo/mary.mxl', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('wrote songs/demo/mary.mxl');
