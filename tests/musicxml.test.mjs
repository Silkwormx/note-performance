// node --test tests/   (MusicXML import + export round trip)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { readMusicXmlFile, musicXmlToSong } from '../js/musicxml.js';
import { songToMusicXml } from '../js/musicxml-export.js';
import { parseSong } from '../js/parser.js';

async function load(path) {
  const buf = readFileSync(path);
  const xml = await readMusicXmlFile(path.endsWith('.mxl') ? buf : buf.toString('utf8'), path, { JSZip });
  const { text, info } = musicXmlToSong(xml, { DOMParser, filename: path.split('/').pop() });
  return { text, info, song: parseSong(text) };
}
const notesOf = (song) => song.events.filter((e) => e.type === 'note').map((e) => `${e.pitch}:${e.beats}`);

for (const [txt, xml] of [
  ['songs/twinkle.txt', 'songs/demo/twinkle.musicxml'],
  ['songs/ode.txt', 'songs/demo/ode-to-joy.musicxml'],
  ['songs/frere-jacques.txt', 'songs/demo/frere-jacques.musicxml'],
  ['songs/mary.txt', 'songs/demo/mary.mxl'],
]) {
  test(`round trip ${xml}`, async () => {
    const orig = parseSong(readFileSync(txt, 'utf8'));
    const { song, info } = await load(xml);
    assert.equal(song.errors.length, 0);
    assert.deepEqual(notesOf(song), notesOf(orig));
    assert.equal(song.totalBeats, orig.totalBeats);
    assert.equal(song.meta.tempo, orig.meta.tempo);
    assert.equal(song.meta.key, orig.meta.key);
    assert.deepEqual(song.meta.time, orig.meta.time);
    if (orig.chords.length) {
      assert.equal(info.chordsFrom, 'file');
      const sig = (s) => s.chords.filter((c) => !c.silent).map((c) => `${c.name}@${c.startBeat}`);
      assert.deepEqual(sig(song), sig(orig));
    } else {
      assert.equal(info.chordsFrom, 'guess');
      assert.equal(song.meta.chordsGuessed, true);
    }
  });
}

test('lyrics survive the round trip', async () => {
  const { song } = await load('songs/demo/twinkle.musicxml');
  assert.equal(song.events[0].lyric, 'Twin-');
  assert.equal(song.events[1].lyric, 'kle,');
});

test('key signature: B-flat in F major comes through', async () => {
  const { song } = await load('songs/demo/frere-jacques.musicxml');
  assert.ok(song.events.some((e) => e.pitch === 'Bb4'));
  assert.equal(song.meta.key, 'F');
});

test('Frère Jacques chords guessed as F', async () => {
  const { song } = await load('songs/demo/frere-jacques.musicxml');
  assert.deepEqual([...new Set(song.chords.filter((c) => !c.silent).map((c) => c.name))], ['F']);
});

test('ties merge, dots and triplets keep exact lengths, rests fill gaps', () => {
  const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>6</divisions><key><fifths>1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
  <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type></direction>
  <harmony><root><root-step>G</root-step></root><kind>major</kind></harmony>
  <note><pitch><step>G</step><octave>4</octave></pitch><duration>9</duration><type>quarter</type><dot/></note>
  <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>3</duration><type>eighth</type></note>
  <note><pitch><step>E</step><octave>4</octave></pitch><duration>6</duration><tie type="start"/><type>quarter</type></note></measure>
  <measure number="2"><harmony><root><root-step>D</root-step></root><kind>dominant</kind></harmony>
  <note><pitch><step>E</step><octave>4</octave></pitch><duration>6</duration><tie type="stop"/><type>quarter</type></note>
  <note><rest/><duration>6</duration></note>
  <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>
  <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration></note>
  <note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration></note></measure></part></score-partwise>`;
  const { text } = musicXmlToSong(xml, { DOMParser });
  const song = parseSong(text);
  assert.equal(song.errors.length, 0, text);
  assert.equal(song.meta.tempo, 90);
  assert.equal(song.meta.key, 'G');
  assert.deepEqual(song.meta.time, [3, 4]);
  assert.deepEqual(notesOf(song).slice(0, 3), ['G4:1.5', 'F#4:0.5', 'E4:2']);
  assert.ok(Math.abs(song.events.find((e) => e.pitch === 'D5').beats - 1 / 3) < 1e-9);
  assert.equal(song.events.filter((e) => e.type === 'rest').length, 1);
  assert.ok(Math.abs(song.totalBeats - 6) < 1e-9);
  assert.deepEqual(song.chords.map((c) => c.name), ['G', 'D7']);
});

test('chords in the melody and a second voice: keep the top voice, highest note', () => {
  const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1">
  <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
  <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
  <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
  <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
  <backup><duration>2</duration></backup>
  <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>5</voice><staff>2</staff></note>
  </measure></part></score-partwise>`;
  const { song } = { song: parseSong(musicXmlToSong(xml, { DOMParser }).text) };
  assert.deepEqual(notesOf(song), ['G4:1', 'A4:1']);
});

test('pickup measure is padded so bars line up', () => {
  const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
  <measure number="0" implicit="yes"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
  <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure>
  <measure number="1"><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
  const song = parseSong(musicXmlToSong(xml, { DOMParser }).text);
  assert.equal(song.events[0].type, 'rest');
  assert.equal(song.events[0].beats, 3);
  assert.equal(song.events.find((e) => e.pitch === 'C5').startBeat, 4);
});

test('export then import keeps a 6/8 song', () => {
  const src = parseSong('title: Row\ntempo: 90\nkey: D\ntime: 6/8\nchords: D:3 | A7:3\nD4 1.5 | D4 1.5 | D4 1 | E4 0.5 | F#4 1.5');
  const back = parseSong(musicXmlToSong(songToMusicXml(src), { DOMParser }).text);
  assert.deepEqual(notesOf(back), notesOf(src));
  assert.deepEqual(back.meta.time, [6, 8]);
  assert.deepEqual(back.chords.map((c) => c.name), ['D', 'A7']);
});

test('bad input gives a friendly error', () => {
  assert.throws(() => musicXmlToSong('<html></html>', { DOMParser }), /MusicXML/);
});

// Real-world files from OpenSheetMusicDisplay's test data (downloaded by tests/fetch-external.sh, not committed).
const ext = 'tests/external';
if (existsSync(ext)) {
  for (const f of readdirSync(ext).filter((x) => /\.(xml|musicxml|mxl)$/.test(x))) {
    test(`external: ${f} imports without errors`, async () => {
      const { song, info } = await load(`${ext}/${f}`);
      assert.equal(song.errors.length, 0);
      assert.ok(song.events.some((e) => e.type === 'note'));
      assert.ok(info.measures > 0);
    });
  }
}
