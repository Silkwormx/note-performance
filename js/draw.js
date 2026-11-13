import {
  colorForPitch,
  displayLetter,
  solfegeFor,
  stepsFromE4,
  lighten,
  darken,
  rgba,
  keyLabel,
  colorForChord,
  noteColor,
  isAccidental,
  midiIsBlack,
  spellingForMidi,
  chordMidis,
} from './music.js';
import { countInBeats } from './parser.js';

export const SPEED_OPTIONS = [
  { value: 0.25, label: 'Very Slow' },
  { value: 0.4, label: '' },
  { value: 0.5, label: 'Slow' },
  { value: 0.6, label: '' },
  { value: 0.75, label: 'Medium' },
  { value: 1, label: 'Full Speed' },
];

export function speedLabelFor(speed) {
  const found = SPEED_OPTIONS.find((o) => Math.abs(o.value - Number(speed)) < 0.001);
  return found?.label || '';
}

export const viewOptions = {
  speed: 1,
  speedLabel: 'Full Speed',
  background: 'photo',
  showKeyboard: true,
  showSpeedBadge: true,
  page: null,
  pageLabel: '',
  countInAt: 0,
  showReady: true,
};

export function setViewOptions(partial) {
  Object.assign(viewOptions, partial);
  if (partial && partial.speed != null && partial.speedLabel == null) {
    viewOptions.speedLabel = speedLabelFor(viewOptions.speed);
  }
}

const NEON = '#1FD8FF';
const NEON_SOFT = 'rgba(31, 216, 255, 0.55)';
const NEON_FLASH = '#B8F6FF';

const bgImage = typeof Image !== 'undefined' ? new Image() : null;
let bgReady = false;
if (bgImage) {
  bgImage.decoding = 'async';
  bgImage.src = 'assets/island-bg.jpg';
  bgImage.onload = () => {
    bgReady = true;
  };
}

function backgroundReady() {
  return new Promise((resolve) => {
    if (!bgImage) return resolve(false);
    if (bgImage.complete && bgImage.naturalWidth) {
      bgReady = true;
      return resolve(true);
    }
    bgImage.onload = () => {
      bgReady = true;
      resolve(true);
    };
    bgImage.onerror = () => resolve(false);
  });
}

export async function whenAssetsReady() {
  const fonts = [];
  if (typeof document !== 'undefined' && document.fonts) {
    fonts.push(document.fonts.load('248px "Noto Music"').catch(() => {}));
    fonts.push(document.fonts.load('800 26px Nunito').catch(() => {}));
    fonts.push(document.fonts.load('700 46px Fredoka').catch(() => {}));
    fonts.push(document.fonts.ready);
  }
  await Promise.all([...fonts, backgroundReady()]);
}

export function pianoRange(song) {
  let lo = 60;
  let hi = 84;
  for (const ev of song?.events || []) {
    if (ev.type !== 'note' || ev.midi == null) continue;
    lo = Math.min(lo, ev.midi);
    hi = Math.max(hi, ev.midi);
  }
  lo = Math.floor(lo / 12) * 12;
  hi = Math.ceil(hi / 12) * 12;
  if (hi - lo < 24) hi = lo + 24;
  if (lo > 48) lo = 48;
  if (hi < 96) hi = 96;
  return { lo, hi };
}

export function computeLayout(w, h, song) {
  const s = w / 1920;
  const showKeyboard = viewOptions.showKeyboard !== false;
  const keyboardH = showKeyboard ? Math.round(Math.max(150 * s, h * 0.235)) : 0;
  const keyboardY = h - keyboardH;
  const chordRailH = 52 * s;
  const chordGap = showKeyboard ? 8 * s : 18 * s;
  const bottomPad = showKeyboard ? 0 : 16 * s;
  const chordRailY = keyboardY - chordGap - chordRailH - bottomPad;
  const titleY = 40 * s;
  const lineGap = 54 * s;
  const c6MinY = titleY + 80 * s;
  const staffTop = c6MinY + 2 * lineGap;
  const bottomLineY = staffTop + 4 * lineGap;
  const hitX = 500 * s;
  const rightMargin = 56 * s;
  const tempo = song?.meta?.tempo || 100;
  const futureBeats = song?.meta?.lookahead || (tempo >= 150 ? 5.5 : 7.2);
  const panelY = staffTop - 56 * s;
  const panelBottom = Math.min(bottomLineY + 86 * s, chordRailY - 10 * s);
  return {
    w,
    h,
    s,
    lineGap,
    staffTop,
    bottomLineY,
    panelX: 40 * s,
    panelY,
    panelW: w - 80 * s,
    panelH: Math.max(120 * s, panelBottom - panelY),
    hitX,
    clefX: 88 * s,
    clefRight: 88 * s + 3.9 * lineGap,
    pixelsPerBeat: (w - hitX - rightMargin) / futureBeats,
    futureBeats,
    noteRx: 32 * s,
    noteRy: 23 * s,
    titleY,
    chordRailY,
    chordRailH,
    keyboardY,
    keyboardH,
    piano: pianoRange(song),
  };
}

function snap(n) {
  return Math.round(n);
}

function setCrispFont(ctx, weight, sizePx, family = 'Nunito, Fredoka, sans-serif') {
  const size = Math.max(10, Math.round(sizePx));
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

function strokeFillText(ctx, text, x, y, { fill = '#FFFFFF', stroke = 'rgba(20, 16, 12, 0.88)', width = 3 } = {}) {
  const px = snap(x);
  const py = snap(y);
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (stroke && width > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.strokeText(text, px, py);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, px, py);
}

export function drawFrame(ctx, w, h, song, timeSec) {
  const L = computeLayout(w, h, song);
  const secPerBeat = 60 / song.meta.tempo;
  const ci = countInBeats(song);
  const songTime = timeSec - ci * secPerBeat;

  ctx.clearRect(0, 0, w, h);
  drawBackground(ctx, L, timeSec);
  drawStaffCard(ctx, L);
  drawStaffLines(ctx, L);
  drawSparkles(ctx, L, song, songTime, secPerBeat);
  drawNotes(ctx, L, song, songTime, secPerBeat);
  drawClef(ctx, L);
  drawChordLane(ctx, L, song, songTime, secPerBeat);
  if (viewOptions.showKeyboard !== false) {
    drawKeyboard(ctx, L, song, songTime, secPerBeat);
  }
  drawHitLine(ctx, L, song, songTime, secPerBeat);
  drawTitle(ctx, L, song);
  drawSpeedBadge(ctx, L);
  drawPageBadge(ctx, L);
  drawReady(ctx, L, timeSec, secPerBeat, ci);
}

function drawBackground(ctx, L, time) {
  if (viewOptions.background !== 'meadow' && bgReady && bgImage && bgImage.naturalWidth) {
    drawPhotoBackground(ctx, L);
    return;
  }
  drawMeadowBackground(ctx, L, time);
}

function drawPhotoBackground(ctx, L) {
  const { w, h } = L;
  const iw = bgImage.naturalWidth;
  const ih = bgImage.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(bgImage, dx, dy, dw, dh);
  // Very light veil only — keep the sky clearly blue
  const veil = ctx.createLinearGradient(0, 0, 0, h);
  veil.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
  veil.addColorStop(0.5, 'rgba(255, 255, 255, 0.00)');
  veil.addColorStop(1, 'rgba(20, 40, 70, 0.06)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, w, h);
}

function drawMeadowBackground(ctx, L, time) {
  const { w, h, s } = L;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#AEC4E6');
  sky.addColorStop(0.28, '#E4C5B3');
  sky.addColorStop(0.52, '#F6DFC0');
  sky.addColorStop(0.78, '#E8D9B8');
  sky.addColorStop(1, '#8FA876');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const sx = w * 0.84;
  const sy = h * 0.28;
  const sr = 92 * s;
  const glow = ctx.createRadialGradient(sx, sy, sr * 0.15, sx, sy, sr * 3.4);
  glow.addColorStop(0, 'rgba(255, 224, 140, 0.9)');
  glow.addColorStop(0.22, 'rgba(255, 200, 120, 0.32)');
  glow.addColorStop(1, 'rgba(255, 200, 130, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, sr * 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#F8E4A4';
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 248, 220, 0.55)';
  ctx.beginPath();
  ctx.arc(sx - sr * 0.2, sy - sr * 0.2, sr * 0.55, 0, Math.PI * 2);
  ctx.fill();

  drawCloud(ctx, w * 0.14 + Math.sin(time * 0.07) * 10 * s, h * 0.13, s * 1.15, 0.5);
  drawCloud(ctx, w * 0.46 + Math.cos(time * 0.05) * 12 * s, h * 0.09, s * 0.88, 0.38);
  drawCloud(ctx, w * 0.68 + Math.sin(time * 0.06 + 1) * 8 * s, h * 0.17, s * 0.72, 0.32);

  drawHill(ctx, w, h, '#E3C0AB', [
    [-0.06, 0.56],
    [0.18, 0.49],
    [0.4, 0.54],
    [0.66, 0.47],
    [1.06, 0.53],
  ]);
  drawHill(ctx, w, h, '#C5D4A4', [
    [-0.06, 0.65],
    [0.2, 0.57],
    [0.48, 0.62],
    [0.78, 0.55],
    [1.06, 0.61],
  ]);
  drawHill(ctx, w, h, '#9BB485', [
    [-0.06, 0.78],
    [0.16, 0.69],
    [0.38, 0.74],
    [0.62, 0.66],
    [0.86, 0.73],
    [1.06, 0.69],
  ]);

  const ground = ctx.createLinearGradient(0, h * 0.8, 0, h);
  ground.addColorStop(0, '#8CA674');
  ground.addColorStop(1, '#6F8B58');
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.82);
  ctx.quadraticCurveTo(w * 0.35, h * 0.79, w * 0.55, h * 0.825);
  ctx.quadraticCurveTo(w * 0.8, h * 0.86, w, h * 0.81);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  drawTree(ctx, w * 0.07, h * 0.73, 100 * s, '#5A764B');
  drawTree(ctx, w * 0.155, h * 0.76, 74 * s, '#678556');
  drawTree(ctx, w * 0.935, h * 0.705, 118 * s, '#4F6C44');
  drawTree(ctx, w * 0.865, h * 0.75, 82 * s, '#5E784C');

  for (let i = 0; i < 11; i += 1) {
    const seed = i * 17.13;
    const x = ((Math.sin(time * 0.21 + seed) + 1) / 2) * w;
    const y = h * 0.56 + Math.sin(time * 0.37 + seed * 2) * h * 0.11 + (i % 5) * h * 0.035;
    const a = 0.2 + 0.38 * (0.5 + 0.5 * Math.sin(time * 2.05 + seed));
    ctx.fillStyle = `rgba(255, 232, 140, ${a})`;
    ctx.beginPath();
    ctx.arc(x, y, 3.4 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Soften the painted meadow when used as a fallback
  ctx.fillStyle = 'rgba(20, 24, 28, 0.08)';
  ctx.fillRect(0, 0, w, h);
}

function drawCloud(ctx, x, y, scale, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = `rgba(255, 250, 244, ${alpha})`;
  ctx.beginPath();
  ctx.arc(0, 16, 28, 0, Math.PI * 2);
  ctx.arc(30, 10, 36, 0, Math.PI * 2);
  ctx.arc(64, 16, 26, 0, Math.PI * 2);
  ctx.arc(44, 24, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHill(ctx, w, h, color, points) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0][0] * w, points[0][1] * h);
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const cx = (a[0] + b[0]) / 2;
    const cy = Math.min(a[1], b[1]) - 0.03;
    ctx.quadraticCurveTo(a[0] * w, a[1] * h, cx * w, cy * h);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0] * w, last[1] * h);
  ctx.lineTo(w * 1.05, h);
  ctx.lineTo(-w * 0.05, h);
  ctx.closePath();
  ctx.fill();
}

function drawTree(ctx, x, y, h, color) {
  ctx.save();
  ctx.fillStyle = '#5A4638';
  ctx.fillRect(x - h * 0.04, y - h * 0.22, h * 0.08, h * 0.32);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - h * 0.42, h * 0.28, 0, Math.PI * 2);
  ctx.arc(x - h * 0.2, y - h * 0.3, h * 0.2, 0, Math.PI * 2);
  ctx.arc(x + h * 0.2, y - h * 0.3, h * 0.2, 0, Math.PI * 2);
  ctx.arc(x, y - h * 0.22, h * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawStaffCard(ctx, L) {
  ctx.save();
  ctx.shadowColor = 'rgba(20, 28, 32, 0.22)';
  ctx.shadowBlur = 28 * L.s;
  ctx.shadowOffsetY = 8 * L.s;
  ctx.fillStyle = 'rgba(252, 248, 240, 0.88)';
  roundRect(ctx, L.panelX, L.panelY, L.panelW, L.panelH, 28 * L.s);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
  ctx.lineWidth = 2 * L.s;
  roundRect(ctx, L.panelX, L.panelY, L.panelW, L.panelH, 28 * L.s);
  ctx.stroke();
}

function drawStaffLines(ctx, L) {
  ctx.strokeStyle = 'rgba(74, 58, 48, 0.42)';
  ctx.lineWidth = 2.4 * L.s;
  ctx.lineCap = 'round';
  const x0 = L.panelX + 28 * L.s;
  const x1 = L.panelX + L.panelW - 28 * L.s;
  for (let i = 0; i < 5; i += 1) {
    const y = L.staffTop + i * L.lineGap;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
}

function drawHitLine(ctx, L, song, songTime, secPerBeat) {
  const y0 = L.staffTop - 22 * L.s;
  const y1 = L.chordRailY + L.chordRailH - 6 * L.s;
  let flash = 0;
  for (const ev of song.events) {
    if (ev.type !== 'note') continue;
    const age = songTime - ev.startBeat * secPerBeat;
    if (age >= 0 && age < 0.22) {
      flash = Math.max(flash, 1 - age / 0.22);
    }
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = NEON;
  ctx.shadowBlur = (20 + flash * 28) * L.s;
  ctx.strokeStyle = `rgba(31, 216, 255, ${0.22 + flash * 0.55})`;
  ctx.lineWidth = (16 + flash * 14) * L.s;
  ctx.beginPath();
  ctx.moveTo(L.hitX, y0);
  ctx.lineTo(L.hitX, y1);
  ctx.stroke();
  ctx.strokeStyle = flash > 0 ? NEON_FLASH : NEON;
  ctx.lineWidth = 5 * L.s;
  ctx.beginPath();
  ctx.moveTo(L.hitX, y0);
  ctx.lineTo(L.hitX, y1);
  ctx.stroke();
  ctx.restore();
}

function staffY(L, pitch) {
  const steps = stepsFromE4(pitch);
  return L.bottomLineY - steps * (L.lineGap / 2);
}

function drawLedgerLines(ctx, L, x, pitch, alpha) {
  const steps = stepsFromE4(pitch);
  const hw = L.noteRx * 1.55;
  ctx.strokeStyle = rgba('#4A3A30', 0.5 * alpha);
  ctx.lineWidth = 2.4 * L.s;
  ctx.lineCap = 'round';
  // Only draw a ledger if the note is on or beyond that ledger line.
  // D4 (one step below the staff) must not get a C4 ledger.
  if (steps <= -2) {
    for (let s = -2; s >= steps; s -= 2) {
      const y = L.bottomLineY - s * (L.lineGap / 2);
      ctx.beginPath();
      ctx.moveTo(x - hw, y);
      ctx.lineTo(x + hw, y);
      ctx.stroke();
    }
  }
  if (steps >= 10) {
    for (let s = 10; s <= steps; s += 2) {
      const y = L.bottomLineY - s * (L.lineGap / 2);
      ctx.beginPath();
      ctx.moveTo(x - hw, y);
      ctx.lineTo(x + hw, y);
      ctx.stroke();
    }
  }
}

function drawNotes(ctx, L, song, songTime, secPerBeat) {
  const pps = L.pixelsPerBeat / secPerBeat;
  for (const ev of song.events) {
    if (ev.type !== 'note') continue;
    const start = ev.startBeat * secPerBeat;
    const dur = ev.beats * secPerBeat;
    const x = L.hitX + (start - songTime) * pps;
    const barW = Math.max(dur * pps - 12 * L.s, L.noteRx * 1.15);
    const y = staffY(L, ev.pitch);
    const end = start + dur;
    let alpha = 1;
    if (songTime > end) alpha = 1 - (songTime - end) / 0.5;
    const fadeStart = L.hitX - L.pixelsPerBeat * 0.7;
    const fadeEnd = L.clefX;
    if (x < fadeStart) {
      alpha *= Math.max(0, (x - fadeEnd) / Math.max(fadeStart - fadeEnd, 1));
    }
    if (x + barW < L.panelX + 20 || x > L.w + 40 || alpha <= 0) continue;

    const accidental = isAccidental(ev.pitch);
    const color = noteColor(ev.pitch);
    const active = songTime >= start && songTime < end;
    const approaching = start - songTime < 0.12 && start - songTime >= 0;
    const scale = active || approaching ? 1.08 : 1;
    const inPage = pageContains(ev.startBeat);
    if (!inPage) alpha *= 0.18;

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);

    const barH = L.noteRy * 1.25;
    const barX = x;
    roundRect(ctx, barX, y - barH / 2, barW, barH, barH / 2);
    ctx.fillStyle = rgba(lighten(color, 0.72), 0.88);
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.35);
    ctx.lineWidth = 1.5 * L.s;
    ctx.stroke();

    drawLedgerLines(ctx, L, x, ev.pitch, alpha);

    if (ev.beats < 3.5) {
      const steps = stepsFromE4(ev.pitch);
      const up = steps < 4;
      ctx.strokeStyle = darken(color, 0.25);
      ctx.lineWidth = 3.2 * L.s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (up) {
        const sx = x + L.noteRx * 0.72 * scale;
        ctx.moveTo(sx, y);
        ctx.lineTo(sx, y - L.lineGap * 3.15);
        ctx.stroke();
        if (ev.beats <= 0.6) drawFlag(ctx, sx, y - L.lineGap * 3.15, color, 1, L.s);
        if (ev.beats <= 0.3) drawFlag(ctx, sx, y - L.lineGap * 2.45, color, 1, L.s);
      } else {
        const sx = x - L.noteRx * 0.72 * scale;
        ctx.moveTo(sx, y);
        ctx.lineTo(sx, y + L.lineGap * 3.15);
        ctx.stroke();
        if (ev.beats <= 0.6) drawFlag(ctx, sx, y + L.lineGap * 3.15, color, -1, L.s);
        if (ev.beats <= 0.3) drawFlag(ctx, sx, y + L.lineGap * 2.45, color, -1, L.s);
      }
    }

    drawNoteHead(ctx, x, y, L.noteRx, L.noteRy, color, accidental, scale, L.s);

    const letter = displayLetter(ev.pitch);
    const letterSize = letter.length > 1 ? 18 : 25;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    setCrispFont(ctx, '800', letterSize * L.s);
    strokeFillText(ctx, letter, x, y + 0.5 * L.s, {
      fill: '#FFFFFF',
      stroke: 'rgba(20, 16, 12, 0.92)',
      width: Math.max(2.2, 3 * L.s),
    });

    ctx.restore();
  }
}

function drawFlag(ctx, x, y, color, dir, s) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + 22 * s, y + dir * 4 * s, x + 32 * s, y + dir * 22 * s, x + 16 * s, y + dir * 36 * s);
  ctx.bezierCurveTo(x + 24 * s, y + dir * 18 * s, x + 8 * s, y + dir * 10 * s, x, y + dir * 14 * s);
  ctx.closePath();
  ctx.fill();
}

function drawClef(ctx, L) {
  const gY = L.bottomLineY - L.lineGap;
  const fontSize = 4 * L.lineGap;
  // Noto Music's typographic baseline is not the G curl. Shift down so the
  // inner loop sits on the G4 line (second line from the bottom).
  const baselineAdjust = 1.2 * L.lineGap;
  ctx.save();
  ctx.font = `${fontSize}px "Noto Music"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#2C241F';
  ctx.fillText('\u{1D11E}', L.clefX, gY + baselineAdjust);
  ctx.restore();
}

function drawSparkles(ctx, L, song, songTime, secPerBeat) {
  const pps = L.pixelsPerBeat / secPerBeat;
  for (const ev of song.events) {
    if (ev.type !== 'note') continue;
    const start = ev.startBeat * secPerBeat;
    const age = songTime - start;
    if (age < 0 || age > 0.4) continue;
    const y = staffY(L, ev.pitch);
    const x = L.hitX + Math.max(-8, (start - songTime) * pps) * 0.15;
    drawSparkle(ctx, x, y, age, noteColor(ev.pitch), L.s);
  }
}

function drawSparkle(ctx, x, y, age, color, s) {
  const t = age / 0.4;
  const alpha = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
  const scale = (22 + t * 38) * s;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.5);
  ctx.globalAlpha = Math.max(0, alpha);
  for (let i = 0; i < 8; i += 1) {
    ctx.rotate(Math.PI / 4);
    const len = scale * (i % 2 ? 0.55 : 1);
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(2.4 * s, 0);
    ctx.lineTo(-2.4 * s, 0);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? NEON_FLASH : color;
    ctx.fill();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, scale * 0.7);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(31, 216, 255, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, scale * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function prettyAccidental(name) {
  return String(name || '')
    .replace(/([A-G])b/g, '$1♭')
    .replace(/([A-G])#/g, '$1♯');
}

export function uniqueChords(song) {
  const seen = new Set();
  const out = [];
  for (const ch of song.chords || []) {
    if (ch.silent || !ch.name || seen.has(ch.name)) continue;
    seen.add(ch.name);
    out.push(ch);
  }
  return out;
}

export function uniqueNotes(song) {
  const seen = new Set();
  const out = [];
  for (const ev of song.events || []) {
    if (ev.type !== 'note') continue;
    const label = displayLetter(ev.pitch);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(ev);
  }
  out.sort((a, b) => (a.midi - b.midi) || String(a.pitch).localeCompare(String(b.pitch)));
  return out;
}

function pageContains(beat) {
  const page = viewOptions.page;
  if (!page) return true;
  return beat >= page.startBeat - 1e-6 && beat < page.endBeat - 1e-6;
}

function drawNoteHead(ctx, x, y, rx, ry, color, accidental, scale, s) {
  ctx.save();
  ctx.translate(snap(x), snap(y));
  ctx.scale(scale, scale);
  ctx.rotate(-0.22);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  if (accidental) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.lineWidth = Math.max(2, 2.6 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx + 3.4 * s, ry + 3.4 * s, 0, 0, Math.PI * 2);
    ctx.setLineDash([3.6 * s, 2.5 * s]);
    ctx.lineWidth = Math.max(1.4, 1.8 * s);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2 * s;
    ctx.stroke();
  }
  ctx.restore();
}

function soundingPitches(song, songTime, secPerBeat) {
  const melody = new Map();
  for (const ev of song.events || []) {
    if (ev.type !== 'note') continue;
    if (!pageContains(ev.startBeat)) continue;
    const start = ev.startBeat * secPerBeat;
    const end = start + ev.beats * secPerBeat;
    if (songTime >= start && songTime < end) melody.set(ev.midi, ev.pitch);
  }
  const harmony = new Map();
  for (const ch of song.chords || []) {
    if (ch.silent) continue;
    if (!pageContains(ch.startBeat)) continue;
    const start = ch.startBeat * secPerBeat;
    const end = start + ch.beats * secPerBeat;
    if (songTime >= start && songTime < end) {
      for (const midi of chordMidis(ch)) {
        if (!melody.has(midi)) harmony.set(midi, ch);
      }
    }
  }
  return { melody, harmony };
}

function whiteIndex(midi, lo) {
  let n = 0;
  for (let m = lo; m < midi; m += 1) {
    if (!midiIsBlack(m)) n += 1;
  }
  return n;
}

function countWhite(lo, hi) {
  let n = 0;
  for (let m = lo; m <= hi; m += 1) {
    if (!midiIsBlack(m)) n += 1;
  }
  return n;
}

function drawKeyboard(ctx, L, song, songTime, secPerBeat) {
  if (!L.keyboardH) return;
  const { lo, hi } = L.piano;
  const y = L.keyboardY;
  const kh = L.keyboardH;
  const whites = countWhite(lo, hi);
  const ww = L.w / whites;
  const { melody, harmony } = soundingPitches(song, songTime, secPerBeat);
  const blackH = kh * 0.62;
  const blackW = ww * 0.58;
  const nudge = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };

  ctx.save();
  ctx.fillStyle = '#1A1E24';
  ctx.fillRect(0, y, L.w, kh);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, y, L.w, 2);

  // White keys first
  for (let m = lo; m <= hi; m += 1) {
    if (midiIsBlack(m)) continue;
    const i = whiteIndex(m, lo);
    const x = i * ww;
    const pitch = spellingForMidi(m, song);
    const color = noteColor(pitch);
    const lit = melody.has(m);
    const harm = !lit && harmony.has(m);
    const press = lit ? 5 : harm ? 2 : 0;
    const keyY = y + press;
    const keyH = kh - press - 3;
    ctx.fillStyle = lit ? color : harm ? lighten(color, 0.55) : '#F4F1EA';
    ctx.fillRect(x + 0.6, keyY, ww - 1.2, keyH);
    // front lip
    ctx.fillStyle = lit ? darken(color, 0.22) : harm ? color : '#D8D2C8';
    ctx.fillRect(x + 0.6, keyY + keyH - 10 * L.s, ww - 1.2, 10 * L.s);
    ctx.strokeStyle = 'rgba(30, 28, 26, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.6, keyY, ww - 1.2, keyH);
    const letter = displayLetter(pitch);
    const isC = letter === 'C' || pitch[0] === 'C';
    setCrispFont(ctx, isC ? '800' : '700', (isC ? 15 : 13) * L.s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelY = keyY + keyH - 22 * L.s;
    const fill = lit ? '#FFFFFF' : isC ? '#5A4A40' : 'rgba(90, 74, 64, 0.55)';
    strokeFillText(ctx, isC ? `${letter}${Math.floor(m / 12) - 1}` : letter, x + ww / 2, labelY, {
      fill,
      stroke: lit ? 'rgba(20,16,12,0.7)' : 'transparent',
      width: lit ? 2.2 : 0,
    });
  }

  // Black keys on top
  for (let m = lo; m <= hi; m += 1) {
    if (!midiIsBlack(m)) continue;
    const i = whiteIndex(m, lo);
    const offset = (nudge[m % 12] || 0) * ww;
    const x = i * ww - blackW / 2 + offset;
    const pitch = spellingForMidi(m, song);
    const color = noteColor(pitch);
    const lit = melody.has(m);
    const harm = !lit && harmony.has(m);
    const press = lit ? 4 : 0;
    const keyY = y + press;
    const keyH = blackH - press;
    ctx.fillStyle = lit ? color : harm ? darken(color, 0.05) : '#1C1C22';
    roundRect(ctx, x, keyY, blackW, keyH, 4 * L.s);
    ctx.fill();
    if (lit || harm) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = Math.max(1.8, 2.2 * L.s);
      ctx.stroke();
      ctx.beginPath();
      roundRect(ctx, x - 2 * L.s, keyY - 2 * L.s, blackW + 4 * L.s, keyH + 2 * L.s, 5 * L.s);
      ctx.setLineDash([3.2 * L.s, 2.2 * L.s]);
      ctx.lineWidth = Math.max(1.2, 1.5 * L.s);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const letter = displayLetter(pitch);
    setCrispFont(ctx, '800', 13 * L.s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    strokeFillText(ctx, letter, x + blackW / 2, keyY + keyH - 14 * L.s, {
      fill: '#FFFFFF',
      stroke: 'rgba(0,0,0,0.85)',
      width: 2.2,
    });
  }
  ctx.restore();
}

function drawPageBadge(ctx, L) {
  const label = viewOptions.pageLabel;
  if (!label) return;
  const s = L.s;
  setCrispFont(ctx, '700', 22 * s);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(label).width;
  const padX = 16 * s;
  const h = 36 * s;
  const w = tw + padX * 2;
  const x = 64 * s;
  const y = L.titleY + 36 * s;
  ctx.save();
  ctx.fillStyle = 'rgba(20, 28, 32, 0.48)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = NEON_SOFT;
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();
  ctx.fillStyle = '#F4FFFD';
  ctx.fillText(label, x + padX, snap(y + h / 2 + 0.5 * s));
  ctx.restore();
}

function drawChordLane(ctx, L, song, songTime, secPerBeat) {
  const chords = song.chords || [];
  if (!chords.length) return;
  const pps = L.pixelsPerBeat / secPerBeat;
  const y = L.chordRailY;
  const h = L.chordRailH;
  const railX = L.panelX;
  const railW = L.panelW;

  ctx.save();
  ctx.shadowColor = 'rgba(20, 28, 32, 0.16)';
  ctx.shadowBlur = 16 * L.s;
  ctx.shadowOffsetY = 4 * L.s;
  ctx.fillStyle = 'rgba(252, 248, 240, 0.88)';
  roundRect(ctx, railX, y, railW, h, h / 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
  ctx.lineWidth = 2 * L.s;
  roundRect(ctx, railX, y, railW, h, h / 2);
  ctx.stroke();

  ctx.save();
  roundRect(ctx, railX, y, railW, h, h / 2);
  ctx.clip();

  for (const ch of chords) {
    if (ch.silent) continue;
    if (!pageContains(ch.startBeat)) continue;
    const start = ch.startBeat * secPerBeat;
    const dur = ch.beats * secPerBeat;
    const end = start + dur;
    let alpha = 1;
    if (songTime > end) alpha = 1 - (songTime - end) / 0.4;
    if (alpha <= 0) continue;

    const remaining = Math.max(0, end - Math.max(songTime, start));
    const active = songTime >= start && songTime < end;
    let x;
    let w;
    if (active) {
      x = L.hitX;
      w = Math.max(remaining * pps, 10 * L.s);
    } else if (songTime < start) {
      x = L.hitX + (start - songTime) * pps;
      w = Math.max(ch.beats * L.pixelsPerBeat, 10 * L.s);
    } else {
      x = L.hitX;
      w = 10 * L.s;
    }
    if (x + w < railX || x > railX + railW) continue;

    const color = colorForChord(ch);
    const fill = active ? darken(color, 0.12) : lighten(color, 0.62);
    ctx.save();
    ctx.globalAlpha = alpha;
    const inset = 7 * L.s;
    roundRect(ctx, x, y + inset, w, h - inset * 2, (h - inset * 2) / 2);
    ctx.fillStyle = rgba(fill, active ? 1 : 0.95);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2.4 * L.s;
      ctx.stroke();
    } else {
      ctx.strokeStyle = rgba(darken(color, 0.05), 0.28);
      ctx.lineWidth = 1.2 * L.s;
      ctx.stroke();
    }

    const label = prettyAccidental(ch.name);
    ctx.font = `700 ${Math.round(24 * L.s)}px Fredoka, Nunito, sans-serif`;
    const tw = ctx.measureText(label).width;
    if (w > tw + 22 * L.s) {
      ctx.fillStyle = active ? '#FFFFFF' : darken(color, 0.25);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = active ? 'rgba(0,0,0,0.35)' : 'transparent';
      ctx.shadowBlur = active ? 3 * L.s : 0;
      ctx.fillText(label, x + 14 * L.s, y + h / 2 + 0.5 * L.s);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawTitle(ctx, L, song) {
  const { w, s } = L;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(46 * s)}px Fredoka, Nunito, sans-serif`;
  ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
  ctx.shadowBlur = 10 * s;
  ctx.fillStyle = '#2A221C';
  ctx.fillText(song.meta.title || 'Untitled', 64 * s, L.titleY);

  ctx.textAlign = 'right';
  ctx.font = `600 ${Math.round(28 * s)}px Nunito, sans-serif`;
  ctx.fillStyle = '#3A322C';
  const right = `${keyLabel(song.meta.key)}  ·  ${song.meta.tempo} BPM`;
  ctx.fillText(right, w - 64 * s, L.titleY);
  ctx.restore();
}

function drawSpeedBadge(ctx, L) {
  if (viewOptions.showSpeedBadge === false) return;
  const label = viewOptions.speedLabel;
  const speed = viewOptions.speed ?? 1;
  if (!label && speed === 1) return;
  const s = L.s;
  const text = label ? `${label}  ·  ${formatSpeed(speed)}` : formatSpeed(speed);
  ctx.save();
  ctx.font = `700 ${Math.round(22 * s)}px Fredoka, Nunito, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const padX = 16 * s;
  const h = 36 * s;
  const w = tw + padX * 2;
  const x = L.w - 64 * s - w;
  const y = L.titleY + 36 * s;
  ctx.fillStyle = 'rgba(20, 28, 32, 0.48)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = NEON_SOFT;
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();
  ctx.fillStyle = '#F4FFFD';
  ctx.fillText(text, x + w - padX, y + h / 2 + 0.5 * s);
  ctx.restore();
}

function formatSpeed(speed) {
  const n = Number(speed);
  const body = Number.isInteger(n) ? String(n) : String(n);
  return `${body}×`;
}

function drawReady(ctx, L, timeSec, secPerBeat, ci) {
  if (viewOptions.showReady === false) return;
  const origin = viewOptions.countInAt || 0;
  const local = timeSec - origin;
  const countInSec = ci * secPerBeat;
  if (local < -0.05 || local > countInSec + 0.2) return;
  let fade = 1;
  if (local < 0.18) fade = local / 0.18;
  if (local > countInSec - 0.32) {
    fade = Math.max(0, 1 - (local - (countInSec - 0.32)) / 0.5);
  }
  if (fade <= 0) return;

  const beatPhase = (local / secPerBeat) % 1;
  const pop = 1 + 0.07 * Math.exp(-beatPhase * 7);
  const x = L.hitX + 280 * L.s;
  const y = L.staffTop + 2 * L.lineGap;

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(x, y);
  ctx.scale(pop, pop);
  ctx.font = `700 ${Math.round(132 * L.s)}px Fredoka, Nunito, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 16 * L.s;
  ctx.strokeStyle = '#4A2E18';
  ctx.strokeText('READY', 0, 0);
  ctx.fillStyle = '#F3D78A';
  ctx.fillText('READY', 0, 0);
  ctx.restore();
}


function slideFade(timeSec, duration) {
  const fadeIn = 0.4;
  const fadeOut = 0.35;
  let a = 1;
  if (timeSec < fadeIn) a = Math.max(0, timeSec / fadeIn);
  if (timeSec > duration - fadeOut) a = Math.max(0, (duration - timeSec) / fadeOut);
  return a;
}

function drawSlideCard(ctx, L, { yRatio = 0.12, heightRatio = 0.76 } = {}) {
  const x = L.w * 0.09;
  const y = L.h * yRatio;
  const w = L.w * 0.82;
  const h = L.h * heightRatio;
  ctx.save();
  ctx.shadowColor = 'rgba(20, 28, 32, 0.22)';
  ctx.shadowBlur = 36 * L.s;
  ctx.shadowOffsetY = 10 * L.s;
  ctx.fillStyle = 'rgba(252, 248, 240, 0.92)';
  roundRect(ctx, x, y, w, h, 32 * L.s);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 2.2 * L.s;
  roundRect(ctx, x, y, w, h, 32 * L.s);
  ctx.stroke();
  return { x, y, w, h };
}

function drawChip(ctx, x, y, label, color, s, { sub = '', dark = true, width, accidental = false } = {}) {
  const padX = 18 * s;
  setCrispFont(ctx, '800', 28 * s);
  const tw = ctx.measureText(label).width;
  const w = width || Math.max(64 * s, tw + padX * 2);
  const h = sub ? 70 * s : 48 * s;
  ctx.save();
  ctx.fillStyle = dark ? color : lighten(color, 0.15);
  roundRect(ctx, x, y, w, h, 16 * s);
  ctx.fill();
  if (accidental) {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.4 * s;
    ctx.stroke();
    ctx.beginPath();
    roundRect(ctx, x - 3 * s, y - 3 * s, w + 6 * s, h + 6 * s, 18 * s);
    ctx.setLineDash([4 * s, 2.8 * s]);
    ctx.lineWidth = 1.6 * s;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setCrispFont(ctx, '800', 28 * s);
  const textY = sub ? y + 24 * s : y + h / 2 + 0.5 * s;
  strokeFillText(ctx, label, x + w / 2, textY, {
    fill: '#FFFFFF',
    stroke: 'rgba(20,16,12,0.55)',
    width: 2.4 * s,
  });
  if (sub) {
    setCrispFont(ctx, '700', 16 * s);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(sub, snap(x + w / 2), snap(y + h - 16 * s));
  }
  ctx.restore();
  return { w, h };
}

export function drawTitleSlide(ctx, w, h, song, timeSec, duration = 5.5) {
  const L = computeLayout(w, h, song);
  ctx.clearRect(0, 0, w, h);
  drawBackground(ctx, L, timeSec);
  const fade = slideFade(timeSec, duration);
  ctx.save();
  ctx.globalAlpha = fade;
  if (viewOptions.showKeyboard !== false) {
    drawKeyboard(ctx, L, song, -1, 60 / (song.meta.tempo || 100));
  }
  const card = drawSlideCard(ctx, L, { yRatio: 0.07, heightRatio: 0.52 });
  const cx = card.x + card.w / 2;
  let y = card.y + 64 * L.s;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(56 * L.s)}px Fredoka, Nunito, sans-serif`;
  ctx.fillStyle = '#2A221C';
  ctx.fillText(song.meta.title || 'Untitled', cx, y);
  y += 48 * L.s;
  ctx.font = `600 ${Math.round(24 * L.s)}px Nunito, sans-serif`;
  ctx.fillStyle = '#5A4A40';
  ctx.fillText(`${keyLabel(song.meta.key)}  ·  ${song.meta.tempo} BPM`, cx, y);

  const chords = uniqueChords(song);
  y += 70 * L.s;
  ctx.font = `700 ${Math.round(22 * L.s)}px Nunito, sans-serif`;
  ctx.fillStyle = '#6A574B';
  ctx.textAlign = 'left';
  const left = card.x + 56 * L.s;
  ctx.fillText(song.meta.chordsGuessed ? 'Chords (best guess)' : 'Chords', left, y);
  y += 28 * L.s;
  let x = left;
  const gap = 12 * L.s;
  const rowRight = card.x + card.w - 56 * L.s;
  for (const ch of chords) {
    const label = prettyAccidental(ch.name);
    ctx.font = `700 ${Math.round(28 * L.s)}px Fredoka, Nunito, sans-serif`;
    const chipW = Math.max(64 * L.s, ctx.measureText(label).width + 36 * L.s);
    if (x + chipW > rowRight) {
      x = left;
      y += 60 * L.s;
    }
    drawChip(ctx, x, y, label, colorForChord(ch), L.s);
    x += chipW + gap;
  }

  const notes = uniqueNotes(song);
  y += 88 * L.s;
  ctx.font = `700 ${Math.round(22 * L.s)}px Nunito, sans-serif`;
  ctx.fillStyle = '#6A574B';
  ctx.textAlign = 'left';
  ctx.fillText('Notes', left, y);
  y += 28 * L.s;
  x = left;
  for (const ev of notes) {
    const label = displayLetter(ev.pitch);
    const sub = solfegeFor(ev.pitch, song.meta.key);
    ctx.font = `700 ${Math.round(28 * L.s)}px Fredoka, Nunito, sans-serif`;
    const chipW = Math.max(72 * L.s, ctx.measureText(label).width + 36 * L.s);
    if (x + chipW > rowRight) {
      x = left;
      y += 86 * L.s;
    }
    drawChip(ctx, x, y, label, noteColor(ev.pitch), L.s, { sub, accidental: isAccidental(ev.pitch) });
    x += chipW + gap;
  }
  ctx.restore();
}

export function drawSpeedCard(ctx, w, h, song, info, timeSec, duration = 2.2) {
  const L = computeLayout(w, h, song);
  ctx.clearRect(0, 0, w, h);
  drawBackground(ctx, L, timeSec);
  const fade = slideFade(timeSec, duration);
  ctx.save();
  ctx.globalAlpha = fade;
  const card = drawSlideCard(ctx, L, { yRatio: 0.24, heightRatio: 0.52 });
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  const label = info.label || speedLabelFor(info.speed) || '';
  const speedText = formatSpeed(info.speed);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2A221C';
  if (label) {
    ctx.font = `700 ${Math.round(72 * L.s)}px Fredoka, Nunito, sans-serif`;
    ctx.fillText(label, cx, cy - 36 * L.s);
    ctx.font = `700 ${Math.round(44 * L.s)}px Nunito, sans-serif`;
    ctx.fillStyle = '#1FB3A8';
    ctx.fillText(speedText, cx, cy + 44 * L.s);
  } else {
    ctx.font = `700 ${Math.round(72 * L.s)}px Fredoka, Nunito, sans-serif`;
    ctx.fillText(speedText, cx, cy);
  }
  ctx.restore();
}
