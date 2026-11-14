// Scan page: photo/PDF -> scan backend (Audiveris) -> "Fix the notes" -> player.
import { readMusicXmlFile, musicXmlToSong } from './musicxml.js';
import { parseSong } from './parser.js';
import { songToMusicXml } from './musicxml-export.js';
import { createPiano } from './piano.js';
import {
  docFromImports, docToSongText, renderScore, barIssues, allIssues, stepNote, keyAlter, midiOf,
  parseChordInput, chordInputText, beatsText, durationShape, MAJOR_BY_FIFTHS, MINOR_BY_FIFTHS, pitchToken,
} from './scoreedit.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LS = { api: 'np-scan-api', key: 'np-scan-key', doc: 'np-scan-doc', song: 'np-scan-song' };

const state = {
  files: [], // { file, url, isPdf }
  doc: null,
  pages: [], // { job, base, original, cleaned, sheetImage, sheet, urls: {} }
  selected: null, // { bar, item|null }
  undo: [],
  layer: 'sheet',
  pageIdx: 0,
  server: { base: null, ok: false, sameOrigin: false },
};

// ---------- scanner connection ----------
if (params.get('api')) localStorage.setItem(LS.api, params.get('api').replace(/\/+$/, ''));
if (params.get('key')) localStorage.setItem(LS.key, params.get('key'));
if (params.get('api') || params.get('key')) {
  // keep the key out of the address bar / screenshots (the cookie or storage remembers it)
  const clean = new URL(location.href);
  clean.searchParams.delete('key');
  clean.searchParams.delete('api');
  history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
}
const apiKey = () => localStorage.getItem(LS.key) || '';
const authHeaders = () => (apiKey() ? { 'X-Scan-Key': apiKey() } : {});

async function probe(base) {
  try {
    const res = await fetch(`${base}/api/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.ok ? j : null;
  } catch {
    return null;
  }
}

async function connect() {
  const label = $('server-state');
  label.textContent = 'Looking for the scanner…';
  // 1) this page was opened from the scanner itself (the tunnel link)
  const here = await probe('');
  if (here) {
    state.server = { base: '', ok: true, sameOrigin: true, info: here };
  } else {
    const stored = localStorage.getItem(LS.api) || '';
    const there = stored ? await probe(stored) : null;
    state.server = { base: stored, ok: !!there, sameOrigin: false, info: there };
  }
  const s = state.server;
  if (s.ok) {
    label.textContent = `Scanner connected${s.sameOrigin ? '' : ` at ${s.base}`}.${s.info.ocr ? '' : ' (Chord names and words may not be read: OCR data missing.)'}`;
    $('server-box').open = false;
  } else {
    label.textContent = 'Scanner not reachable. Start it on the computer (server/start.sh) and open the link it prints, or paste its address and key here.';
    $('server-box').open = true;
  }
  $('api-url').value = localStorage.getItem(LS.api) || '';
  $('api-key').value = apiKey();
  updateReadButton();
}

// ---------- step 1: pages ----------
function addFiles(list) {
  for (const file of list) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    state.files.push({ file, isPdf, url: isPdf ? null : URL.createObjectURL(file) });
  }
  renderPageList();
}

function renderPageList() {
  const ol = $('page-list');
  ol.innerHTML = '';
  state.files.forEach((f, i) => {
    const li = document.createElement('li');
    if (f.isPdf) {
      const d = document.createElement('div');
      d.className = 'pdf';
      d.textContent = 'PDF';
      li.appendChild(d);
    } else {
      const img = document.createElement('img');
      img.src = f.url;
      img.alt = `Page ${i + 1}`;
      li.appendChild(img);
    }
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = `${i + 1}. ${f.file.name}`;
    li.appendChild(cap);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '×';
    rm.setAttribute('aria-label', `Remove page ${i + 1}`);
    rm.onclick = () => {
      if (f.url) URL.revokeObjectURL(f.url);
      state.files.splice(i, 1);
      renderPageList();
    };
    li.appendChild(rm);
    ol.appendChild(li);
  });
  $('btn-camera').textContent = state.files.length ? '📷 Add another page' : '📷 Take a photo';
  updateReadButton();
}

function updateReadButton() {
  $('btn-read').disabled = !state.files.length;
}

function setStatus(text, err = false) {
  const p = $('scan-status');
  p.textContent = text;
  p.classList.toggle('err', err);
}

async function fetchJobFile(base, job, path) {
  const res = await fetch(`${base}/api/job/${job}/${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Couldn't fetch ${path} (${res.status})`);
  return res;
}

async function readMusic() {
  if (!state.server.ok) {
    await connect();
    if (!state.server.ok) {
      setStatus('The scanner is not connected (see "Scanner connection" below).', true);
      return;
    }
  }
  const fd = new FormData();
  for (const f of state.files) fd.append('files', f.file, f.file.name);
  const clean = $('opt-clean').checked ? '1' : '0';
  const t0 = performance.now();
  const timer = setInterval(() => {
    setStatus(`Reading the music… ${Math.round((performance.now() - t0) / 1000)} s (about 10–40 s per page)`);
  }, 500);
  $('btn-read').disabled = true;
  try {
    const res = await fetch(`${state.server.base}/api/scan?clean=${clean}`, { method: 'POST', body: fd, headers: authHeaders() });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.detail || j.error || `Scanner error ${res.status}`);
    await openScanResult(j, state.server.base);
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't read it: ${err.message}`, true);
  } finally {
    clearInterval(timer);
    updateReadButton();
  }
}

function sensibleTitle(t) {
  const s = String(t || '').trim();
  if (s.length < 4 || !/[a-z]{3}/i.test(s)) return '';
  return s;
}

async function openScanResult(result, base) {
  const imports = [];
  const pages = [];
  const problems = [];
  for (const p of result.pages) {
    const page = { job: result.job, base, original: p.original, cleaned: p.cleaned, sheetImage: p.sheetImage, sheet: p.sheet, name: p.name, urls: {} };
    pages.push(page);
    if (!p.mxl) {
      problems.push(`${p.name}: ${p.error || 'nothing recognized'}`);
      continue;
    }
    const bytes = new Uint8Array(await (await fetchJobFile(base, result.job, p.mxl)).arrayBuffer());
    const xml = await readMusicXmlFile(bytes, 'scan.mxl');
    const { info } = musicXmlToSong(xml, { filename: p.name });
    info.title = sensibleTitle(info.title) || '';
    imports.push({ info, sheet: p.sheet, pageIndex: pages.length - 1 });
  }
  if (!imports.length) throw new Error(problems.join(' · ') || 'No music found.');
  const doc = docFromImports(imports);
  // bar.page should point at the picture list, not the import list
  let k = 0;
  imports.forEach((im) => {
    for (let n = 0; n < im.info.bars.length; n += 1) doc.bars[k++].page = im.pageIndex;
  });
  if (!doc.title || doc.title === 'Scanned song') doc.title = 'Scanned song';
  doc.scanInfo = { timings: result.timings, problems };
  state.pages = pages;
  startFix(doc);
  setStatus('');
}

// ---------- open a MusicXML directly ----------
async function openXmlFile(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const xml = await readMusicXmlFile(bytes, file.name);
    const { info } = musicXmlToSong(xml, { filename: file.name });
    state.pages = [];
    startFix(docFromImports([{ info }]));
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't open ${file.name}: ${err.message}`, true);
  }
}

// ---------- step 2: fix ----------
function show(step) {
  $('step-scan').hidden = step !== 'scan';
  $('step-fix').hidden = step !== 'fix';
  if (step === 'fix' && location.hash !== '#fix') history.replaceState(null, '', `${location.pathname}${location.search}#fix`);
  if (step === 'scan' && location.hash) history.replaceState(null, '', location.pathname + location.search);
}

function startFix(doc) {
  state.doc = doc;
  state.undo = [];
  const firstIssue = allIssues(doc)[0];
  state.selected = firstIssue ? { bar: firstIssue.bar, item: null } : null;
  state.pageIdx = 0;
  show('fix');
  fillMeta();
  refresh();
  loadPageImage();
  save();
}

function fillMeta() {
  const d = state.doc;
  $('f-title').value = d.title;
  $('f-tempo').value = d.tempo;
  $('f-time').textContent = `${d.time[0]}/${d.time[1]} time`;
  const sel = $('f-key');
  sel.innerHTML = '';
  for (let f = -7; f <= 7; f += 1) {
    for (const [mode, names] of [['major', MAJOR_BY_FIFTHS], ['minor', MINOR_BY_FIFTHS]]) {
      const o = document.createElement('option');
      o.value = `${f}|${mode}`;
      o.textContent = `${names[f]}${mode === 'major' ? ' major' : ' (minor)'}  ${f > 0 ? '♯'.repeat(f) : '♭'.repeat(-f)}`;
      sel.appendChild(o);
    }
  }
  sel.value = `${d.fifths}|${d.mode}`;
}

function save() {
  try {
    const pages = state.pages.map(({ urls, ...rest }) => rest);
    localStorage.setItem(LS.doc, JSON.stringify({ doc: state.doc, pages, savedAt: Date.now() }));
  } catch (e) {
    console.warn('could not save', e);
  }
}

function pushUndo() {
  state.undo.push(JSON.stringify(state.doc));
  if (state.undo.length > 150) state.undo.shift();
}

function refresh() {
  const wrap = $('score-wrap');
  renderScore($('score'), state.doc, {
    // phones: draw a bit wider than the screen and scale down, so two bars fit per line
    width: Math.max(wrap.clientWidth || 800, 460),
    selected: state.selected,
    onPick: pick,
  });
  renderIssues();
  renderSelection();
  renderBoxes();
}

function renderIssues() {
  const box = $('issues');
  box.innerHTML = '';
  const list = allIssues(state.doc);
  if (!list.length) {
    const s = document.createElement('span');
    s.className = 'ok';
    s.textContent = '✓ Every bar adds up. Check the notes against the picture, then press Play it.';
    box.appendChild(s);
    return;
  }
  for (const { bar, issues } of list) {
    const chip = document.createElement('span');
    chip.className = 'issue';
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'linkish';
    t.textContent = `Bar ${bar + 1}`;
    t.onclick = () => pick(bar, null, 'issue');
    chip.appendChild(t);
    chip.appendChild(document.createTextNode(` ${issues.map((x) => x.text).join('; ')}`));
    const beats = issues.find((x) => x.kind === 'beats');
    if (beats && beats.have < beats.need) {
      const f = document.createElement('button');
      f.type = 'button';
      f.textContent = 'Fill with rest';
      f.onclick = () => edit(() => state.doc.bars[bar].items.push({ rest: true, beats: beats.need - beats.have }), { bar, item: null });
      chip.appendChild(f);
    }
    if (issues.some((x) => x.kind === 'unsure')) {
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = 'Looks right';
      ok.onclick = () => edit(() => (state.doc.bars[bar].reviewed = true), state.selected);
      chip.appendChild(ok);
    }
    box.appendChild(chip);
  }
}

function selectedItem() {
  const s = state.selected;
  if (!s || s.item == null) return null;
  return state.doc.bars[s.bar]?.items[s.item] || null;
}

function renderSelection() {
  const s = state.selected;
  const it = selectedItem();
  const label = $('sel-label');
  if (!s) label.textContent = 'Tap a note to change it. Orange bars need a look.';
  else if (!it) label.textContent = `Bar ${s.bar + 1} selected — “+♩” adds a note at the end. ${barIssues(state.doc, s.bar).map((x) => x.text).join('; ')}`;
  else {
    const sh = durationShape(it.beats);
    const len = `${beatsText(it.beats)} beat${it.beats === 1 ? '' : 's'}${sh.exact ? '' : ' (unusual length)'}`;
    label.textContent = it.rest ? `Bar ${s.bar + 1}: rest, ${len}` : `Bar ${s.bar + 1}: ${pitchToken(it).replace('#', '♯').replace(/b(?=\d)/, '♭')}, ${len}`;
  }
  $('f-lyric').value = it && !it.rest ? it.lyric || '' : '';
  $('f-lyric').disabled = !it || !!it.rest;
  const bar = s ? state.doc.bars[s.bar] : null;
  $('chord-bar-no').textContent = bar ? String(s.bar + 1) : '–';
  $('f-chords').value = bar ? chordInputText(bar) : '';
  $('f-chords').disabled = !bar;
  document.querySelectorAll('#toolbar [data-len]').forEach((b) => {
    const base = Number(b.dataset.len);
    b.classList.toggle('on', !!it && (Math.abs(it.beats - base) < 1e-6 || Math.abs(it.beats - base * 1.5) < 1e-6));
  });
  const dot = document.querySelector('#toolbar [data-act="dot"]');
  dot.classList.toggle('on', !!it && durationShape(it.beats).dots > 0 && durationShape(it.beats).exact);
  const needsItem = ['up', 'down', 'sharp', 'flat', 'natural', 'dot', 'delete', 'rest-toggle'];
  document.querySelectorAll('#toolbar [data-act], #toolbar [data-len]').forEach((b) => {
    const act = b.dataset.act;
    if (act === 'undo') b.disabled = !state.undo.length;
    else if (act === 'add-note' || act === 'add-rest') b.disabled = !s;
    else if (b.dataset.len) b.disabled = !it;
    else if (needsItem.includes(act)) b.disabled = !it || (it.rest && ['up', 'down', 'sharp', 'flat', 'natural'].includes(act));
  });
}

function pick(bar, item, where) {
  state.selected = { bar, item };
  if (state.doc.bars[bar]?.page != null && state.doc.bars[bar].page !== state.pageIdx && state.pages.length) {
    state.pageIdx = state.doc.bars[bar].page;
    loadPageImage();
  }
  refresh();
  const it = selectedItem();
  if (it && !it.rest && where === 'staff') preview(it);
  if (where === 'chords') {
    $('f-chords').focus();
    $('f-chords').select();
  }
  scrollBoxIntoView();
}

function edit(fn, nextSel) {
  pushUndo();
  fn();
  if (nextSel !== undefined) state.selected = nextSel;
  const s = state.selected;
  if (s && state.doc.bars[s.bar]) state.doc.bars[s.bar].reviewed = true;
  refresh();
  save();
}

function act(name) {
  const s = state.selected;
  const it = selectedItem();
  const d = state.doc;
  switch (name) {
    case 'up':
    case 'down':
      if (!it || it.rest) return;
      edit(() => Object.assign(it, stepNote(it, name === 'up' ? 1 : -1, d.fifths)));
      preview(it);
      break;
    case 'sharp':
    case 'flat':
    case 'natural':
      if (!it || it.rest) return;
      edit(() => {
        const want = name === 'sharp' ? 1 : name === 'flat' ? -1 : 0;
        it.alter = it.alter === want && name !== 'natural' ? keyAlter(d.fifths, it.step) : want;
      });
      preview(it);
      break;
    case 'dot':
      if (!it) return;
      edit(() => {
        const sh = durationShape(it.beats);
        it.beats = sh.dots && sh.exact ? it.beats / 1.5 : it.beats * 1.5;
      });
      break;
    case 'delete':
      if (!it) return;
      edit(() => d.bars[s.bar].items.splice(s.item, 1), {
        bar: s.bar,
        item: d.bars[s.bar].items.length > 1 ? Math.min(s.item, d.bars[s.bar].items.length - 2) : null,
      });
      break;
    case 'rest-toggle':
      if (!it) return;
      edit(() => {
        if (it.rest) {
          const prev = d.bars[s.bar].items.slice(0, s.item).reverse().find((x) => !x.rest);
          Object.assign(it, { rest: false, step: prev?.step || 'B', alter: prev?.alter || 0, octave: prev?.octave || 4, lyric: '' });
          delete it.rest;
        } else {
          for (const k of ['step', 'alter', 'octave', 'lyric']) delete it[k];
          it.rest = true;
        }
      });
      break;
    case 'add-note':
    case 'add-rest': {
      if (!s) return;
      const bar = d.bars[s.bar];
      const at = s.item == null ? bar.items.length : s.item + 1;
      const ref = it && !it.rest ? it : bar.items.slice(0, at).reverse().find((x) => !x.rest) || { step: 'B', alter: keyAlter(d.fifths, 'B'), octave: 4 };
      const beats = it ? it.beats : 1;
      const neu = name === 'add-rest' ? { rest: true, beats } : { step: ref.step, alter: ref.alter, octave: ref.octave, beats, lyric: '' };
      edit(() => bar.items.splice(at, 0, neu), { bar: s.bar, item: at });
      if (!neu.rest) preview(neu);
      break;
    }
    case 'undo': {
      const prev = state.undo.pop();
      if (!prev) return;
      state.doc = JSON.parse(prev);
      if (state.selected && !state.doc.bars[state.selected.bar]) state.selected = null;
      else if (state.selected && state.selected.item != null && !state.doc.bars[state.selected.bar].items[state.selected.item]) state.selected.item = null;
      fillMeta();
      refresh();
      save();
      break;
    }
    default:
  }
}

function setLength(base) {
  const it = selectedItem();
  if (!it) return;
  const sh = durationShape(it.beats);
  const dotted = sh.dots > 0 && sh.exact;
  edit(() => (it.beats = dotted ? base * 1.5 : base));
}

// ---------- sound ----------
let piano = null;
function preview(it) {
  try {
    if (!piano) piano = createPiano();
    piano.ensure?.();
    const m = midiOf(it);
    piano.bell(440 * 2 ** ((m - 69) / 12), 0.45, undefined, 0.22, m);
  } catch (e) {
    /* sound is optional */
  }
}

// ---------- page picture ----------
async function imageUrl(page, layer) {
  const file = layer === 'sheet' ? page.sheetImage || page.cleaned : layer === 'cleaned' ? page.cleaned : page.original;
  if (!file) return null;
  if (page.urls[file]) return page.urls[file];
  const res = await fetchJobFile(page.base ?? state.server.base ?? '', page.job, file);
  const url = URL.createObjectURL(await res.blob());
  page.urls[file] = url;
  return url;
}

async function loadPageImage() {
  const page = state.pages[state.pageIdx];
  const img = $('page-img');
  $('image-pane').hidden = !state.pages.length;
  $('no-image').hidden = !!page;
  $('img-wrap').hidden = !page;
  $('img-page-label').textContent = state.pages.length ? `Page ${state.pageIdx + 1} of ${state.pages.length}` : 'Picture';
  document.querySelectorAll('#image-pane [data-layer]').forEach((b) => b.classList.toggle('active', b.dataset.layer === state.layer));
  if (!page) return;
  try {
    const url = await imageUrl(page, state.layer);
    if (url) img.src = url;
    img.onload = () => {
      renderBoxes();
      scrollBoxIntoView();
    };
  } catch (e) {
    $('no-image').hidden = false;
    $('no-image').textContent = 'The picture is no longer on the scanner (pictures are kept for a day).';
  }
}

function renderBoxes() {
  const holder = $('img-boxes');
  holder.innerHTML = '';
  const page = state.pages[state.pageIdx];
  if (!page || !page.sheet || state.layer === 'original') return;
  const img = $('page-img');
  // the cleaned image and Audiveris' picture share a pixel grid unless Audiveris rescaled
  const W = page.sheet.width;
  const Hh = page.sheet.height;
  if (state.layer === 'cleaned' && img.naturalWidth && Math.abs(img.naturalWidth / img.naturalHeight - W / Hh) > 0.01) return;
  state.doc.bars.forEach((bar, bi) => {
    if (bar.page !== state.pageIdx || !bar.omr?.box) return;
    const [x, y, w, h] = bar.omr.box;
    const d = document.createElement('div');
    const flagged = barIssues(state.doc, bi).length > 0;
    d.className = `mbox${flagged ? ' flagged' : ''}${state.selected?.bar === bi ? ' sel' : ''}`;
    Object.assign(d.style, { left: `${(x / W) * 100}%`, top: `${(y / Hh) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / Hh) * 100}%` });
    d.title = `Bar ${bi + 1}`;
    d.onclick = () => pick(bi, null, 'image');
    holder.appendChild(d);
    if (!bar.reviewed) {
      for (const [sx, sy, sw, sh] of bar.omr.lowSpots || []) {
        const s = document.createElement('div');
        s.className = 'spot';
        const pad = 6;
        Object.assign(s.style, { left: `${((sx - pad) / W) * 100}%`, top: `${((sy - pad) / Hh) * 100}%`, width: `${((sw + 2 * pad) / W) * 100}%`, height: `${((sh + 2 * pad) / Hh) * 100}%` });
        holder.appendChild(s);
      }
    }
  });
}

function scrollBoxIntoView() {
  const sel = document.querySelector('#img-boxes .mbox.sel');
  const wrap = $('img-wrap');
  if (sel && wrap) {
    const top = sel.offsetTop - wrap.clientHeight / 3;
    wrap.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
}

// ---------- outputs ----------
function songText() {
  return docToSongText(state.doc);
}

function playIt() {
  const text = songText();
  const song = parseSong(text);
  if (song.errors?.length) console.warn('song errors', song.errors);
  localStorage.setItem(LS.song, JSON.stringify({ text, title: state.doc.title, savedAt: Date.now() }));
  save();
  location.href = 'index.html?song=scan';
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
const fileBase = () => (state.doc.title || 'scanned-song').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'scanned-song';

// ---------- wiring ----------
function wire() {
  $('btn-camera').onclick = () => $('in-camera').click();
  $('btn-files').onclick = () => $('in-files').click();
  $('in-camera').onchange = (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  };
  $('in-files').onchange = (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  };
  $('btn-read').onclick = readMusic;
  $('btn-open-xml').onclick = () => $('in-xml').click();
  $('in-xml').onchange = (e) => {
    if (e.target.files[0]) openXmlFile(e.target.files[0]);
    e.target.value = '';
  };
  $('btn-save-server').onclick = () => {
    localStorage.setItem(LS.api, $('api-url').value.trim().replace(/\/+$/, ''));
    localStorage.setItem(LS.key, $('api-key').value.trim());
    connect();
  };
  $('btn-back').onclick = () => show('scan');
  $('btn-play-it').onclick = playIt;
  $('btn-play-it-2').onclick = playIt;
  $('btn-dl-txt').onclick = () => download(`${fileBase()}.txt`, songText(), 'text/plain');
  $('btn-dl-xml').onclick = () => download(`${fileBase()}.musicxml`, songToMusicXml(parseSong(songText())), 'application/vnd.recordare.musicxml+xml');
  $('f-title').oninput = (e) => {
    state.doc.title = e.target.value;
    save();
  };
  $('f-tempo').onchange = (e) => {
    const v = Math.max(30, Math.min(240, Math.round(Number(e.target.value) || 100)));
    e.target.value = v;
    edit(() => (state.doc.tempo = v));
  };
  $('f-key').onchange = (e) => {
    const [f, mode] = e.target.value.split('|');
    edit(() => {
      state.doc.fifths = Number(f);
      state.doc.mode = mode;
      state.doc.key = (mode === 'minor' ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS)[f];
    });
  };
  $('f-lyric').onchange = (e) => {
    const it = selectedItem();
    if (it && !it.rest) edit(() => (it.lyric = e.target.value.trim()));
  };
  $('f-chords').onchange = (e) => {
    const s = state.selected;
    if (!s) return;
    const bar = state.doc.bars[s.bar];
    const len = bar.items.reduce((a, it) => a + it.beats, 0) || bar.nominal;
    edit(() => {
      bar.chords = parseChordInput(e.target.value, len);
      state.doc.chordsGuessed = false;
      state.doc.hasChords = true;
    });
  };
  document.querySelectorAll('#toolbar [data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act)));
  document.querySelectorAll('#toolbar [data-len]').forEach((b) => (b.onclick = () => setLength(Number(b.dataset.len))));
  document.querySelectorAll('#image-pane [data-layer]').forEach((b) => {
    b.onclick = () => {
      state.layer = b.dataset.layer;
      loadPageImage();
    };
  });
  $('img-prev').onclick = () => {
    if (state.pageIdx > 0) {
      state.pageIdx -= 1;
      loadPageImage();
      renderBoxes();
    }
  };
  $('img-next').onclick = () => {
    if (state.pageIdx < state.pages.length - 1) {
      state.pageIdx += 1;
      loadPageImage();
      renderBoxes();
    }
  };
  document.addEventListener('keydown', (e) => {
    if ($('step-fix').hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    const map = { ArrowUp: 'up', ArrowDown: 'down', Delete: 'delete', Backspace: 'delete' };
    if (map[e.key]) {
      e.preventDefault();
      act(map[e.key]);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      act('undo');
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      moveSel(e.key === 'ArrowRight' ? 1 : -1);
    }
  });
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => state.doc && !$('step-fix').hidden && refresh(), 150);
  });
}

function moveSel(dir) {
  const d = state.doc;
  const flat = [];
  d.bars.forEach((b, bi) => b.items.forEach((_, ii) => flat.push([bi, ii])));
  if (!flat.length) return;
  const s = state.selected;
  let idx = s && s.item != null ? flat.findIndex(([b, i]) => b === s.bar && i === s.item) : -1;
  idx = Math.max(0, Math.min(flat.length - 1, idx + dir));
  pick(flat[idx][0], flat[idx][1], 'staff');
}

function restore() {
  try {
    const raw = localStorage.getItem(LS.doc);
    if (!raw) return false;
    const v = JSON.parse(raw);
    if (!v?.doc?.bars) return false;
    state.pages = (v.pages || []).map((p) => ({ ...p, urls: {} }));
    state.doc = v.doc;
    return true;
  } catch {
    return false;
  }
}

wire();
connect();
if (location.hash === '#fix' && restore()) {
  state.selected = null;
  show('fix');
  fillMeta();
  refresh();
  loadPageImage();
}

// for tests
window.Scan = {
  state,
  openScanResult,
  openXmlText: (xml, name = 'test.musicxml') => {
    const { info } = musicXmlToSong(xml, { filename: name });
    state.pages = [];
    startFix(docFromImports([{ info }]));
  },
  songText,
  act,
  setLength,
  pick,
};
