import { parseSong, songDurationSec, countInBeats, songPages } from './parser.js';
import { midiToFreq, chordMidis } from './music.js';
import {
  drawFrame,
  drawTitleSlide,
  whenAssetsReady,
  setViewOptions,
  speedLabelFor,
} from './draw.js';
import { createLiveSynth } from './synth.js';

const TITLE_AT_REST = true;
const BARS_PER_PAGE = 4;
const TAIL_BEATS = 2;
const SPEEDS = [0.25, 0.5, 0.75, 1];

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
};

const synth = createLiveSynth();
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

function triggerBetween(t0, t1) {
  const beatSec = spb();
  const count = ci();
  const speed = state.speed;
  const win = currentWindow();

  for (let b = 0; b < count; b += 1) {
    const t = win.countInAt + b * beatSec;
    if (t0 < t && t1 >= t) synth.click(undefined, b === 0);
  }

  for (const ev of state.song.events) {
    if (ev.type !== 'note') continue;
    if (!inPlayWindow(ev.startBeat)) continue;
    const t = (count + ev.startBeat) * beatSec;
    if (t0 < t && t1 >= t) {
      synth.bell(midiToFreq(ev.midi), (ev.beats * beatSec) / speed, undefined, 0.22);
    }
  }

  for (const ch of state.song.chords || []) {
    if (ch.silent) continue;
    if (!inPlayWindow(ch.startBeat)) continue;
    const t = (count + ch.startBeat) * beatSec;
    if (t0 < t && t1 >= t) {
      synth.pad(chordMidis(ch), (ch.beats * beatSec) / speed);
    }
  }
}

function retriggerActive() {
  synth.stopAll();
  const beatSec = spb();
  const count = ci();
  const songTime = state.time - count * beatSec;
  const speed = state.speed;
  for (const ev of state.song.events) {
    if (ev.type !== 'note') continue;
    if (!inPlayWindow(ev.startBeat)) continue;
    const start = ev.startBeat * beatSec;
    const end = start + ev.beats * beatSec;
    if (songTime >= start && songTime < end) {
      synth.bell(midiToFreq(ev.midi), (end - songTime) / speed, undefined, 0.22);
    }
  }
  for (const ch of state.song.chords || []) {
    if (ch.silent) continue;
    if (!inPlayWindow(ch.startBeat)) continue;
    const start = ch.startBeat * beatSec;
    const end = start + ch.beats * beatSec;
    if (songTime >= start && songTime < end - 0.02) {
      const remain = end - songTime;
      if (remain > 0) synth.pad(chordMidis(ch), remain / speed);
    }
  }
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
    if (state.lastTs != null) {
      const dt = (ts - state.lastTs) / 1000;
      const t0 = state.time;
      const end = playEndTime();
      state.time = Math.min(end, t0 + dt * state.speed);
      triggerBetween(t0, state.time);
      if (state.time >= end - 0.0005) finishOrLoop();
    }
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

async function loadMario() {
  const res = await fetch('songs/mario.txt');
  if (!res.ok) throw new Error(`Could not load song (${res.status})`);
  const text = await res.text();
  state.song = parseSong(text);
  state.pages = songPages(state.song, BARS_PER_PAGE);
  state.pageIndex = 0;
  state.time = 0;
  state.mode = 'song';
}

window.MarioPlayer = {
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
};

async function boot() {
  sizeCanvas();
  wireUi();
  try {
    await loadMario();
  } catch (err) {
    console.error(err);
  }
  await document.fonts.ready;
  await whenAssetsReady();
  applyViewOptions();
  sizeCanvas();
  updateChrome();
  draw();
  state.ready = true;
  window.MarioPlayer.ready = true;
  requestAnimationFrame(loop);
}

boot();
