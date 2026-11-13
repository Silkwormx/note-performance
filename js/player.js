import { parseSong, songDurationSec, countInBeats, songPages } from './parser.js';
import { midiToFreq, chordMidis } from './music.js';
import {
  drawFrame,
  drawTitleSlide,
  whenAssetsReady,
  setViewOptions,
  speedLabelFor,
} from './draw.js';
import { createPiano, PIANO_CREDIT } from './piano.js';
import { readMusicXmlFile, musicXmlToSong } from './musicxml.js';

const TITLE_AT_REST = true;
const BARS_PER_PAGE = 4;
const TAIL_BEATS = 2;
const SPEEDS = [0.25, 0.5, 0.75, 1];
// Audio is scheduled this far ahead (wall seconds) so notes land exactly on time.
const SCHEDULE_AHEAD = 0.12;
const params = new URLSearchParams(location.search);

const els = {
  canvas: document.getElementById('stage'),
  play: document.getElementById('btn-play'),
  pause: document.getElementById('btn-pause'),
  restart: document.getElementById('btn-restart'),
  speeds: document.getElementById('speeds'),
  time: document.getElementById('time-label'),
  prev: document.getElementById('btn-prev'),
  next: document.getElementById('btn-next'),
  loop: document.getElementById('btn-loop'),
  playPage: document.getElementById('btn-play-page'),
  pageLabel: document.getElementById('page-label'),
  songSelect: document.getElementById('song-select'),
  open: document.getElementById('btn-open'),
  file: document.getElementById('file-input'),
  status: document.getElementById('song-status'),
  credit: document.getElementById('credit'),
};

const synth = createPiano({ onLoad: () => setStatus(state.statusText) });
const state = {
  song: parseSong('title: Untitled\ntempo: 100\nkey: C\n'),
  time: 0,
  playing: false,
  speed: 1,
  lastTs: null,
  mode: 'song', // 'song' | 'page'
  pageIndex: 0,
  loopPage: false,
  pages: [],
  ready: false,
  // audio clock anchor: songTime = anchorSong + (ctxNow - anchorCtx) * speed
  anchorCtx: null,
  anchorSong: 0,
  scheduledUntil: 0,
  statusText: '',
  songs: [],
  songId: '',
};

function spb() {
  return 60 / state.song.meta.tempo;
}

function ci() {
  return countInBeats(state.song);
}

function currentPage() {
  return state.pages[state.pageIndex] || state.pages[0];
}

function currentWindow() {
  if (state.mode !== 'page' || !currentPage()) {
    return { startBeat: 0, endBeat: Infinity, countInAt: 0 };
  }
  const page = currentPage();
  return {
    startBeat: page.startBeat,
    endBeat: page.endBeat,
    countInAt: page.startBeat * spb(),
  };
}

function playEndTime() {
  if (state.mode === 'page') {
    const page = currentPage();
    return (ci() + page.endBeat) * spb();
  }
  return songDurationSec(state.song, { countIn: true, tailBeats: TAIL_BEATS, speed: 1 });
}

function formatTime(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

function getScale() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function sizeCanvas() {
  const canvas = els.canvas;
  const cssW = Math.max(320, canvas.clientWidth || canvas.parentElement?.clientWidth || 1280);
  const cssH = Math.round(cssW * 9 / 16);
  const dpr = getScale();
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

function applyViewOptions() {
  const page = currentPage();
  const inPage = state.mode === 'page' && page;
  setViewOptions({
    speed: state.speed,
    speedLabel: speedLabelFor(state.speed),
    showKeyboard: true,
    showSpeedBadge: false,
    showReady: state.playing,
    background: 'photo',
    page: inPage ? { startBeat: page.startBeat, endBeat: page.endBeat } : null,
    pageLabel: inPage ? `Page ${page.number} of ${page.count}` : '',
    countInAt: inPage ? page.startBeat * spb() : 0,
  });
}

function showingTitle() {
  return TITLE_AT_REST && !state.playing && state.time <= 0.001 && state.mode === 'song';
}

function draw() {
  const ctx = els.canvas.getContext('2d');
  const dpr = getScale();
  const w = els.canvas.width / dpr;
  const h = els.canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (showingTitle()) {
    drawTitleSlide(ctx, w, h, state.song, 2.4, 5.5);
  } else {
    drawFrame(ctx, w, h, state.song, state.time);
  }
}

function updateChrome() {
  const d = playEndTime();
  if (els.time) {
    const total = songDurationSec(state.song, { countIn: true, tailBeats: TAIL_BEATS, speed: 1 });
    els.time.textContent = `${formatTime(state.time)} / ${formatTime(total)}`;
  }
  if (els.play) els.play.hidden = state.playing;
  if (els.pause) els.pause.hidden = !state.playing;
  if (els.pageLabel && currentPage()) {
    const p = currentPage();
    els.pageLabel.textContent = `Page ${p.number} of ${p.count}`;
  }
  if (els.prev) els.prev.disabled = state.pageIndex <= 0;
  if (els.next) els.next.disabled = state.pageIndex >= state.pages.length - 1;
  if (els.loop) els.loop.setAttribute('aria-pressed', state.loopPage ? 'true' : 'false');
  if (els.speeds) {
    for (const btn of els.speeds.querySelectorAll('button[data-speed]')) {
      const v = Number(btn.dataset.speed);
      btn.classList.toggle('active', Math.abs(v - state.speed) < 0.001);
    }
  }
}

function inPlayWindow(startBeat) {
  const win = currentWindow();
  return startBeat >= win.startBeat - 1e-6 && startBeat < win.endBeat - 1e-6;
}

function audioRunning() {
  const T = window.Tone;
  return !!(T && T.getContext().rawContext.state === 'running');
}

/** Pin the song clock to the audio clock at the current song time. */
function reanchor({ keepSchedule = false } = {}) {
  state.anchorCtx = audioRunning() ? synth.now() : null;
  state.anchorSong = state.time;
  if (!keepSchedule) state.scheduledUntil = state.time;
}

/** AudioContext time at which a song time should be heard. */
function ctxTimeFor(songT) {
  if (state.anchorCtx == null) return undefined;
  const t = state.anchorCtx + (songT - state.anchorSong) / state.speed - synth.latency();
  return Math.max(synth.now(), t);
}

/** Schedule every click, note and chord whose start is in (t0, t1] (song seconds). */
function scheduleBetween(t0, t1) {
  const beatSec = spb();
  const count = ci();
  const speed = state.speed;
  const win = currentWindow();

  for (let b = 0; b < count; b += 1) {
    const t = win.countInAt + b * beatSec;
    if (t0 < t && t1 >= t) synth.click(ctxTimeFor(t), b === 0);
  }

  for (const ev of state.song.events) {
    if (ev.type !== 'note') continue;
    if (!inPlayWindow(ev.startBeat)) continue;
    const t = (count + ev.startBeat) * beatSec;
    if (t0 < t && t1 >= t) {
      synth.bell(midiToFreq(ev.midi), (ev.beats * beatSec) / speed, ctxTimeFor(t), 0.22, ev.midi);
    }
  }

  for (const ch of state.song.chords || []) {
    if (ch.silent) continue;
    if (!inPlayWindow(ch.startBeat)) continue;
    const t = (count + ch.startBeat) * beatSec;
    if (t0 < t && t1 >= t) {
      synth.pad(chordMidis(ch), (ch.beats * beatSec) / speed, ctxTimeFor(t));
    }
  }
}

/** After play/seek/speed change: silence, re-anchor, and sound what is mid-note now. */
function retriggerActive() {
  synth.stopAll();
  reanchor();
  const beatSec = spb();
  const count = ci();
  const songTime = state.time - count * beatSec;
  const speed = state.speed;
  for (const ev of state.song.events) {
    if (ev.type !== 'note') continue;
    if (!inPlayWindow(ev.startBeat)) continue;
    const start = ev.startBeat * beatSec;
    const end = start + ev.beats * beatSec;
    if (songTime > start + 1e-4 && songTime < end) {
      synth.bell(midiToFreq(ev.midi), (end - songTime) / speed, undefined, 0.22, ev.midi);
    }
  }
  for (const ch of state.song.chords || []) {
    if (ch.silent) continue;
    if (!inPlayWindow(ch.startBeat)) continue;
    const start = ch.startBeat * beatSec;
    const end = start + ch.beats * beatSec;
    if (songTime > start + 1e-4 && songTime < end - 0.02) {
      const remain = end - songTime;
      if (remain > 0) synth.pad(chordMidis(ch), remain / speed);
    }
  }
  // Events exactly at the current time (e.g. the first beat) are picked up by the scheduler.
  state.scheduledUntil = state.time - 1e-6;
}

function play() {
  synth.ensure();
  if (state.mode === 'song' && state.time >= playEndTime() - 0.02) state.time = 0;
  state.playing = true;
  state.lastTs = null;
  applyViewOptions();
  retriggerActive();
  updateChrome();
}

function pause() {
  state.playing = false;
  state.lastTs = null;
  synth.stopAll();
  updateChrome();
  draw();
}

function seek(t) {
  const end = playEndTime();
  state.time = Math.max(0, Math.min(end, t));
  state.lastTs = null;
  applyViewOptions();
  if (state.playing) retriggerActive();
  else synth.stopAll();
  updateChrome();
  draw();
}

function playFullSong({ fromStart = true } = {}) {
  state.mode = 'song';
  if (fromStart) state.time = 0;
  applyViewOptions();
  play();
}

function playPage() {
  const page = currentPage();
  if (!page) return;
  state.mode = 'page';
  state.time = page.startBeat * spb();
  applyViewOptions();
  play();
}

function gotoPage(index, { autoplay = false } = {}) {
  const next = Math.max(0, Math.min(state.pages.length - 1, index));
  state.pageIndex = next;
  state.mode = 'page';
  const page = currentPage();
  pause();
  // Land on the first beat of the page so the notes are on the staff.
  state.time = (ci() + page.startBeat) * spb();
  applyViewOptions();
  updateChrome();
  draw();
  if (autoplay) playPage();
}

function setSpeed(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return;
  state.speed = v;
  applyViewOptions();
  if (state.playing) retriggerActive();
  updateChrome();
  draw();
}

function finishOrLoop() {
  if (state.mode === 'page' && state.loopPage) {
    const page = currentPage();
    state.time = page.startBeat * spb();
    state.lastTs = null;
    retriggerActive();
    return;
  }
  state.playing = false;
  state.lastTs = null;
  synth.stopAll();
  if (state.mode === 'song') state.time = playEndTime();
  updateChrome();
}

function loop(ts) {
  if (state.playing) {
    const end = playEndTime();
    if (state.anchorCtx == null && audioRunning() && state.lastTs != null) reanchor({ keepSchedule: true });
    let next = state.time;
    if (state.anchorCtx != null) {
      next = state.anchorSong + (synth.now() - state.anchorCtx) * state.speed;
    } else if (state.lastTs != null) {
      next = state.time + ((ts - state.lastTs) / 1000) * state.speed;
    }
    state.time = Math.min(end, Math.max(state.time, next));
    const horizon = Math.min(end, state.time + SCHEDULE_AHEAD * state.speed);
    if (horizon > state.scheduledUntil) {
      scheduleBetween(state.scheduledUntil, horizon);
      state.scheduledUntil = horizon;
    }
    if (state.time >= end - 0.0005) finishOrLoop();
    if (state.playing) state.lastTs = ts;
    updateChrome();
  }
  draw();
  requestAnimationFrame(loop);
}

function wireUi() {
  els.play?.addEventListener('click', () => playFullSong({ fromStart: state.time <= 0.001 || state.time >= playEndTime() - 0.02 }));
  els.pause?.addEventListener('click', pause);
  els.restart?.addEventListener('click', () => {
    state.mode = 'song';
    pause();
    state.time = 0;
    applyViewOptions();
    updateChrome();
    draw();
  });
  els.speeds?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-speed]');
    if (btn) setSpeed(btn.dataset.speed);
  });
  els.prev?.addEventListener('click', () => gotoPage(state.pageIndex - 1));
  els.next?.addEventListener('click', () => gotoPage(state.pageIndex + 1));
  els.loop?.addEventListener('click', () => {
    state.loopPage = !state.loopPage;
    updateChrome();
  });
  els.playPage?.addEventListener('click', () => playPage());
  els.songSelect?.addEventListener('change', () => {
    const entry = state.songs.find((s) => s.id === els.songSelect.value);
    if (entry) loadSongEntry(entry).catch((e) => setStatus(e.message));
  });
  els.open?.addEventListener('click', () => els.file?.click());
  els.file?.addEventListener('change', () => {
    const f = els.file.files?.[0];
    if (f) openFile(f);
    els.file.value = '';
  });
  // Drop a file anywhere on the player.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) openFile(f);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      state.playing ? pause() : playFullSong({ fromStart: state.time <= 0.001 });
    }
    if (e.code === 'Home') {
      state.mode = 'song';
      pause();
      seek(0);
    }
    if (e.code === 'ArrowLeft') gotoPage(state.pageIndex - 1);
    if (e.code === 'ArrowRight') gotoPage(state.pageIndex + 1);
  });

  window.addEventListener('resize', () => {
    sizeCanvas();
    draw();
  });
}

function setStatus(text) {
  state.statusText = text || '';
  if (!els.status) return;
  const piano = synth.isLoaded() ? '' : 'Loading piano sound…';
  els.status.textContent = [state.statusText, piano].filter(Boolean).join('  ·  ');
}

function useSong(song, { id = '', status = '' } = {}) {
  synth.stopAll();
  state.playing = false;
  state.song = song;
  state.pages = songPages(state.song, BARS_PER_PAGE);
  state.pageIndex = 0;
  state.time = 0;
  state.mode = 'song';
  state.songId = id;
  document.title = `${song.meta.title || 'Song'} — Practice Player`;
  const notes = [];
  if (song.meta.chordsGuessed) notes.push('Chords are a best guess from the notes');
  if (song.errors?.length) notes.push(`${song.errors.length} line(s) could not be read`);
  setStatus([status, ...notes].filter(Boolean).join('  ·  '));
  if (els.songSelect) {
    const has = [...els.songSelect.options].some((o) => o.value === id);
    if (!has && id) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = song.meta.title || id;
      els.songSelect.appendChild(opt);
    }
    if (id) els.songSelect.value = id;
  }
  applyViewOptions();
  updateChrome();
  draw();
}

/** Text in the song format, or MusicXML (.musicxml/.xml/.mxl). */
async function songFromBytes(bytes, filename) {
  const lower = filename.toLowerCase();
  if (/\.(musicxml|xml|mxl)$/.test(lower)) {
    const xml = await readMusicXmlFile(bytes, filename);
    const { text, info } = musicXmlToSong(xml, { filename });
    const song = parseSong(text);
    song.sourceText = text;
    song.importInfo = info;
    return song;
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  const song = parseSong(text);
  song.sourceText = text;
  return song;
}

async function loadSongEntry(entry) {
  const res = await fetch(entry.file);
  if (!res.ok) throw new Error(`Could not load ${entry.file} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const song = await songFromBytes(bytes, entry.file);
  useSong(song, { id: entry.id, status: entry.note || '' });
}

async function loadSongList() {
  const lists = [];
  for (const url of ['songs/index.json', 'songs/local.json']) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) lists.push(...(await res.json()));
    } catch {
      /* optional */
    }
  }
  state.songs = lists;
  if (els.songSelect) {
    els.songSelect.innerHTML = '';
    for (const s of lists) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.title;
      els.songSelect.appendChild(opt);
    }
  }
  return lists;
}

async function openFile(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const song = await songFromBytes(bytes, file.name);
    if (!song.events.length) throw new Error('No notes found in that file.');
    const w = song.importInfo?.warnings?.filter((x) => !/best guess/.test(x)) || [];
    useSong(song, { id: `file:${file.name}`, status: `Opened ${file.name}${w.length ? ` (${w.length} note${w.length > 1 ? 's' : ''}: ${w[0]})` : ''}` });
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't open ${file.name}: ${err.message}`);
  }
}

const api = {
  ready: false,
  get state() { return state; },
  play: playFullSong,
  playPage,
  pause,
  seek,
  setSpeed,
  gotoPage,
  setLoop(on) {
    state.loopPage = !!on;
    updateChrome();
  },
  draw,
  canvas: () => els.canvas,
  song: () => state.song,
  synth,
  loadSongText(text, id = 'text') {
    const song = parseSong(text);
    song.sourceText = text;
    useSong(song, { id });
  },
  async loadSongBytes(bytes, filename) {
    const song = await songFromBytes(bytes, filename);
    useSong(song, { id: `file:${filename}` });
    return song;
  },
  loadSongById: (id) => loadSongEntry(state.songs.find((s) => s.id === id)),
  pianoLoaded: () => synth.isLoaded(),
};
window.Player = api;
window.MarioPlayer = api; // older scripts

async function boot() {
  sizeCanvas();
  wireUi();
  if (els.credit) els.credit.textContent = PIANO_CREDIT;
  try {
    const list = await loadSongList();
    const want = params.get('song') || document.body.dataset.song || list[0]?.id;
    const entry = list.find((s) => s.id === want) || list[0];
    if (entry) await loadSongEntry(entry);
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't load the song: ${err.message}`);
  }
  await document.fonts.ready;
  await whenAssetsReady();
  applyViewOptions();
  sizeCanvas();
  updateChrome();
  draw();
  state.ready = true;
  api.ready = true;
  requestAnimationFrame(loop);
}

boot();
