import { parseSong, songDurationSec, countInBeats } from './parser.js';
import { midiToFreq, chordMidis } from './music.js';
import { drawFrame, whenAssetsReady, setViewOptions, speedLabelFor, drawTitleSlide, drawSpeedCard } from './draw.js';
import { createPiano } from './piano.js';
import { readMusicXmlFile, musicXmlToSong } from './musicxml.js';
import { songToMusicXml } from './musicxml-export.js';

const params = new URLSearchParams(location.search);
const renderMode = params.get('mode') === 'render';

const els = {
  app: document.getElementById('app'),
  canvas: document.getElementById('stage'),
  title: document.getElementById('field-title'),
  tempo: document.getElementById('field-tempo'),
  key: document.getElementById('field-key'),
  body: document.getElementById('field-body'),
  errors: document.getElementById('parse-errors'),
  play: document.getElementById('btn-play'),
  pause: document.getElementById('btn-pause'),
  restart: document.getElementById('btn-restart'),
  speed: document.getElementById('field-speed'),
  speedLabel: document.getElementById('speed-label'),
  scrub: document.getElementById('field-scrub'),
  time: document.getElementById('time-label'),
  loadTwinkle: document.getElementById('btn-twinkle'),
  loadMary: document.getElementById('btn-mary'),
  download: document.getElementById('btn-download'),
  openXml: document.getElementById('btn-open-xml'),
  fileXml: document.getElementById('file-xml'),
  downloadXml: document.getElementById('btn-download-xml'),
};

const synth = renderMode ? { ensure() {}, bell() {}, click() {}, pad() {}, cutPad() {}, stopAll() {}, now: () => 0 } : createPiano();
const state = {
  song: parseSong('title: Untitled\ntempo: 100\nkey: C\n'),
  time: 0,
  playing: false,
  speed: 1,
  lastTs: null,
  lastVisualTime: 0,
};

function headerAndBodyFromForm() {
  const title = (els.title?.value || 'Untitled').trim();
  const tempo = els.tempo?.value || '100';
  const key = els.key?.value || 'C';
  const body = els.body?.value || '';
  const time = /^\s*time\s*:/im.test(body) ? '' : 'time: 4/4\n';
  return `title: ${title}\ntempo: ${tempo}\nkey: ${key}\n${time}\n${body}`;
}

function songBodyOnly(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !/^(title|tempo|key)\s*:/i.test(line.trim()))
    .join('\n')
    .replace(/^\s+/, '');
}

function applySong(text, { resetTime = true } = {}) {
  const song = parseSong(text);
  state.song = song;
  if (els.errors) {
    if (song.errors.length) {
      els.errors.hidden = false;
      els.errors.innerHTML = song.errors
        .map((e) => `Line ${e.line}: ${escapeHtml(e.message)}`)
        .join('<br>');
    } else {
      els.errors.hidden = true;
      els.errors.textContent = '';
    }
  }
  if (els.title) els.title.value = song.meta.title;
  if (els.tempo) els.tempo.value = song.meta.tempo;
  if (els.key && [...els.key.options].some((o) => o.value === song.meta.key)) {
    els.key.value = song.meta.key;
  }
  if (els.body && document.activeElement !== els.body) {
    els.body.value = songBodyOnly(text);
  }
  if (resetTime) {
    state.time = 0;
    state.playing = false;
    state.lastTs = null;
  }
  updateChrome();
  draw();
  return song;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function duration() {
  return songDurationSec(state.song);
}

function drawScale() {
  if (renderMode) return Math.max(1, Number(params.get('scale') || 1));
  return Math.min(window.devicePixelRatio || 1, 2);
}

function sizeCanvas() {
  const canvas = els.canvas;
  if (renderMode) {
    const w = Number(params.get('w') || 1280);
    const h = Number(params.get('h') || 720);
    const scale = drawScale();
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    return;
  }
  const wrap = canvas.parentElement;
  const cssW = Math.max(640, wrap.clientWidth);
  const cssH = Math.round(cssW * 9 / 16);
  const dpr = drawScale();
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
}

function draw() {
  const ctx = els.canvas.getContext('2d');
  const dpr = drawScale();
  const w = els.canvas.width / dpr;
  const h = els.canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawFrame(ctx, w, h, state.song, state.time);
}

function formatTime(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

function updateChrome() {
  const d = duration();
  if (els.scrub) {
    els.scrub.max = String(d);
    els.scrub.value = String(state.time);
  }
  if (els.time) els.time.textContent = `${formatTime(state.time)} / ${formatTime(d)}`;
  if (els.play) els.play.hidden = state.playing;
  if (els.pause) els.pause.hidden = !state.playing;
  if (els.speedLabel) els.speedLabel.textContent = `${Number(state.speed).toFixed(2).replace(/\.00$/, '')}×`;
}

function triggerBetween(t0, t1) {
  const secPerBeat = 60 / state.song.meta.tempo;
  const ci = countInBeats(state.song);
  const speed = state.speed;

  const clickAt = (beat) => {
    const t = beat * secPerBeat;
    if (t0 < t && t1 >= t) synth.click(undefined, beat === 0);
  };
  for (let b = 0; b < ci; b += 1) clickAt(b);

  for (const ev of state.song.events) {
    if (ev.type !== 'note') continue;
    const t = (ci + ev.startBeat) * secPerBeat;
    if (t0 < t && t1 >= t) {
      const dur = (ev.beats * secPerBeat) / speed;
      synth.bell(midiToFreq(ev.midi), dur, undefined, 0.22);
    }
  }

  for (const ch of state.song.chords || []) {
    if (ch.silent) continue;
    const t = (ci + ch.startBeat) * secPerBeat;
    if (t0 < t && t1 >= t) {
      synth.pad(chordMidis(ch), (ch.beats * secPerBeat) / speed);
    }
  }
}

function startActiveChords() {
  const secPerBeat = 60 / state.song.meta.tempo;
  const ci = countInBeats(state.song);
  const songTime = state.time - ci * secPerBeat;
  synth.cutPad?.(0.02);
  let current = null;
  for (const ch of state.song.chords || []) {
    if (ch.silent) continue;
    const start = ch.startBeat * secPerBeat;
    const end = start + ch.beats * secPerBeat;
    if (songTime >= start && songTime < end - 0.02) current = ch;
  }
  if (!current) return;
  const start = current.startBeat * secPerBeat;
  const end = start + current.beats * secPerBeat;
  const next = (state.song.chords || []).find(
    (ch) => !ch.silent && ch.startBeat > current.startBeat,
  );
  const nextT = next ? next.startBeat * secPerBeat : end;
  const remain = Math.min(end, nextT) - songTime;
  if (remain > 0) synth.pad(chordMidis(current), remain / state.speed);
}

function play() {
  synth.ensure();
  if (state.time >= duration() - 0.02) state.time = 0;
  state.playing = true;
  state.lastTs = null;
  startActiveChords();
  updateChrome();
}

function pause() {
  state.playing = false;
  state.lastTs = null;
  synth.stopAll();
  updateChrome();
}

function seek(t) {
  const d = duration();
  state.time = Math.max(0, Math.min(d, t));
  state.lastTs = null;
  if (state.playing) {
    synth.stopAll();
    startActiveChords();
  }
  updateChrome();
  draw();
}

function loop(ts) {
  if (state.playing) {
    if (state.lastTs != null) {
      const dt = (ts - state.lastTs) / 1000;
      const t0 = state.time;
      state.time = Math.min(duration(), t0 + dt * state.speed);
      triggerBetween(t0, state.time);
      if (state.time >= duration()) {
        state.playing = false;
        state.lastTs = null;
      }
    }
    if (state.playing) state.lastTs = ts;
    updateChrome();
  }
  draw();
  requestAnimationFrame(loop);
}

async function loadFile(name) {
  const res = await fetch(`songs/${name}`);
  const text = await res.text();
  applySong(text, { resetTime: true });
}

function wireUi() {
  if (renderMode) {
    els.app.classList.add('mode-render');
    document.body.classList.add('mode-render');
  }

  const rebuild = () => applySong(headerAndBodyFromForm(), { resetTime: false });
  els.title?.addEventListener('change', rebuild);
  els.title?.addEventListener('input', rebuild);
  els.tempo?.addEventListener('change', rebuild);
  els.key?.addEventListener('change', rebuild);
  els.body?.addEventListener('input', rebuild);

  els.play?.addEventListener('click', play);
  els.pause?.addEventListener('click', pause);
  els.restart?.addEventListener('click', () => {
    pause();
    seek(0);
  });
  const onSpeed = () => {
    state.speed = Number(els.speed.value);
    setViewOptions({ speed: state.speed, speedLabel: speedLabelFor(state.speed) });
    if (state.playing) {
      synth.stopAll();
      startActiveChords();
      const secPerBeat = 60 / state.song.meta.tempo;
      const ci = countInBeats(state.song);
      const songTime = state.time - ci * secPerBeat;
      for (const ev of state.song.events) {
        if (ev.type !== 'note') continue;
        const start = ev.startBeat * secPerBeat;
        const end = start + ev.beats * secPerBeat;
        if (songTime >= start && songTime < end) {
          synth.bell(midiToFreq(ev.midi), (end - songTime) / state.speed, undefined, 0.22);
        }
      }
    }
    updateChrome();
    draw();
  };
  els.speed?.addEventListener('input', onSpeed);
  els.speed?.addEventListener('change', onSpeed);
  els.scrub?.addEventListener('input', () => {
    seek(Number(els.scrub.value));
  });
  els.loadTwinkle?.addEventListener('click', () => loadFile('twinkle.txt'));
  els.loadMary?.addEventListener('click', () => loadFile('mary.txt'));
  els.download?.addEventListener('click', () => {
    const text = headerAndBodyFromForm();
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    const safe = (state.song.meta.title || 'song').replace(/[^\w\- ]+/g, '').trim() || 'song';
    a.href = URL.createObjectURL(blob);
    a.download = `${safe}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  els.openXml?.addEventListener('click', () => els.fileXml?.click());
  els.fileXml?.addEventListener('change', async () => {
    const f = els.fileXml.files?.[0];
    els.fileXml.value = '';
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let text;
      if (/\.(musicxml|xml|mxl)$/i.test(f.name)) {
        text = musicXmlToSong(await readMusicXmlFile(bytes, f.name), { filename: f.name }).text;
      } else {
        text = new TextDecoder().decode(bytes);
      }
      if (els.key && !/^\s*key\s*:\s*(C|G|D|A|E|F|Bb|Eb|Am|Em|Dm)\s*$/im.test(text)) {
        const k = text.match(/^\s*key\s*:\s*(\S+)/im)?.[1];
        if (k && ![...els.key.options].some((o) => o.value === k)) els.key.add(new Option(k, k));
      }
      if (els.body) els.body.blur();
      applySong(text);
    } catch (err) {
      if (els.errors) {
        els.errors.hidden = false;
        els.errors.textContent = `Couldn't open ${f.name}: ${err.message}`;
      }
    }
  });
  els.downloadXml?.addEventListener('click', () => {
    const xml = songToMusicXml(state.song);
    const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' });
    const a = document.createElement('a');
    const safe = (state.song.meta.title || 'song').replace(/[^\w\- ]+/g, '').trim() || 'song';
    a.href = URL.createObjectURL(blob);
    a.download = `${safe}.musicxml`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      state.playing ? pause() : play();
    }
    if (e.code === 'Home') seek(0);
  });

  window.addEventListener('resize', () => {
    sizeCanvas();
    draw();
  });
}

window.NotePerformance = {
  ready: false,
  loadSong(text) {
    applySong(text, { resetTime: true });
  },
  setOptions(opts) {
    if (opts && opts.speed != null) state.speed = Number(opts.speed);
    setViewOptions(opts || {});
    updateChrome();
    draw();
  },
  seek(t) {
    seek(t);
  },
  drawTitleSlide(t, duration) {
    const ctx = els.canvas.getContext('2d');
    const dpr = drawScale();
    const w = els.canvas.width / dpr;
    const h = els.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTitleSlide(ctx, w, h, state.song, t, duration);
  },
  drawSpeedCard(info, t, duration) {
    const ctx = els.canvas.getContext('2d');
    const dpr = drawScale();
    const w = els.canvas.width / dpr;
    const h = els.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSpeedCard(ctx, w, h, state.song, info, t, duration);
  },
  draw,
  duration,
  canvas: () => els.canvas,
  song: () => state.song,
};

async function boot() {
  sizeCanvas();
  wireUi();
  const songParam = params.get('song') || 'twinkle.txt';
  try {
    await loadFile(songParam);
  } catch {
    applySong(`title: Untitled\ntempo: 100\nkey: C\n\nC4 q "Hi" | D4 q "there" | E4 h "song"`);
  }
  await document.fonts.ready;
  await whenAssetsReady();
  const speedParam = params.get('speed');
  if (els.speed) {
    if (speedParam && [...els.speed.options].some((o) => o.value === speedParam)) {
      els.speed.value = speedParam;
    }
    state.speed = Number(els.speed.value || 1);
  } else if (speedParam) {
    state.speed = Number(speedParam);
  }
  const labelParam = params.get('label');
  setViewOptions({
    speed: state.speed,
    speedLabel: labelParam || speedLabelFor(state.speed),
  });
  sizeCanvas();
  draw();
  window.NotePerformance.ready = true;
  requestAnimationFrame(loop);
}

boot();
