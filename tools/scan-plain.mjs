// helper for the scan test: writes a melody-only MusicXML (no lyrics/chord symbols)
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSong } from '../js/parser.js';
import { songToMusicXml } from '../js/musicxml-export.js';
const [src, out] = process.argv.slice(2);
const song = parseSong(readFileSync(src, 'utf8'));
song.chords = [];
for (const e of song.events) e.lyric = '';
writeFileSync(out, songToMusicXml(song));
