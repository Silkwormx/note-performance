// node --test tests/scoreedit.test.mjs   ("Fix the notes" model: import, edits, export)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { readMusicXmlFile, musicXmlToSong } from '../js/musicxml.js';
import { parseSong } from '../js/parser.js';
import { docFromImports, docToSongText, barIssues, stepNote, parseChordInput, beatsText } from '../js/scoreedit.js';

async function doc(path) {
  const buf = readFileSync(path);
  const xml = await readMusicXmlFile(path.endsWith('.mxl') ? buf : buf.toString('utf8'), path, { JSZip });
  const r = musicXmlToSong(xml, { DOMParser, filename: path });
  return { d: docFromImports([{ info: r.info }]), text: r.text };
}
const events = (text) => parseSong(text).events.filter((e) => e.type === 'note' || e.type === 'rest').map((e) => `${e.type === 'note' ? e.pitch : 'r'}:${+e.beats.toFixed(4)}`);
const chords = (text) => parseSong(text).chords.map((c) => `${c.name}@${+c.startBeat.toFixed(3)}`);

for (const f of ['songs/demo/twinkle.musicxml', 'songs/demo/ode-to-joy.musicxml', 'songs/demo/frere-jacques.musicxml', 'songs/demo/mary.mxl', 'tests/external/scanned-ode-audiveris.mxl']) {
  test(`untouched doc exports the same song: ${f}`, async (t) => {
    let r;
    try {
      r = await doc(f);
    } catch (e) {
      if (e.code === 'ENOENT') return t.skip('not downloaded');
      throw e;
    }
    const out = docToSongText(r.d);
    assert.deepEqual(events(out), events(r.text));
    assert.deepEqual(chords(out), chords(r.text));
    assert.equal(parseSong(out).errors.length, 0);
    assert.equal(r.d.bars.map((_, i) => barIssues(r.d, i)).flat().length, 0, 'clean files have no flags');
  });
}

test('edits: step in key, flag short bar, chords per bar', async () => {
  const { d } = await doc('songs/demo/frere-jacques.musicxml'); // F major
  const n = d.bars[0].items.find((x) => !x.rest);
  assert.equal(n.step, 'F');
  const up = stepNote(stepNote(stepNote(n, 1, d.fifths), 1, d.fifths), 1, d.fifths);
  assert.equal(`${up.step}${up.alter}`, 'B-1', 'B is flat in F major');
  d.bars[0].items.pop();
  const iss = barIssues(d, 0);
  assert.ok(iss.some((x) => x.kind === 'beats' && x.have === 3 && x.need === 4));
  d.bars[1].chords = parseChordInput('F C7', 4);
  const text = docToSongText(d);
  assert.match(text, /C7:2/);
  assert.equal(parseSong(text).errors.length, 0);
});

test('beat text', () => {
  assert.equal(beatsText(1.5), '1.5');
  assert.equal(beatsText(1 / 3), '1/3');
  assert.equal(beatsText(2), '2');
});

test('low-confidence bars are flagged until reviewed', async () => {
  const { d } = await doc('songs/demo/twinkle.musicxml');
  d.bars[2].omr = { minGrade: 0.4, durationOk: true, lowSpots: [] };
  assert.ok(barIssues(d, 2).some((x) => x.kind === 'unsure'));
  d.bars[2].reviewed = true;
  assert.equal(barIssues(d, 2).length, 0);
});
