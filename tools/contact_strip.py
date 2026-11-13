#!/usr/bin/env python3
"""Build a contact strip and poster from an MP4."""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def ffprobe_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
    ).strip()
    return float(out)


def extract(path: Path, t: float, dest: Path) -> None:
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{t:.3f}",
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(dest),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in (
        "/workspace/projects/note-performance/fonts/Nunito.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(p).exists():
            return ImageFont.truetype(p, size=size)
    return ImageFont.load_default()


def main() -> None:
    if len(sys.argv) < 4:
        print("usage: contact_strip.py video.mp4 strip.jpg poster.png [t1 t2 ...]")
        sys.exit(2)
    video = Path(sys.argv[1])
    strip_path = Path(sys.argv[2])
    poster_path = Path(sys.argv[3])
    duration = ffprobe_duration(video)
    if len(sys.argv) > 4:
        times = [float(x) for x in sys.argv[4:]]
    else:
        times = [0.3, 1.5, 2.55, 6.2, 8.0, 12.4, 20.6, min(duration - 0.4, 30.1)]

    tmp = Path(tempfile.mkdtemp(prefix="np-strip-"))
    try:
        thumbs: list[tuple[float, Image.Image]] = []
        for i, t in enumerate(times):
            t = min(max(0.0, t), max(0.0, duration - 0.05))
            frame = tmp / f"f{i:02d}.jpg"
            extract(video, t, frame)
            thumbs.append((t, Image.open(frame).convert("RGB")))

        poster_src = thumbs[min(3, len(thumbs) - 1)][1]
        poster_src.save(poster_path, quality=92)

        # Two-row contact sheet
        cols = 4
        rows = (len(thumbs) + cols - 1) // cols
        tw, th = thumbs[0][1].size
        scale = 480 / tw
        tws, ths = int(tw * scale), int(th * scale)
        pad = 12
        label_h = 28
        sheet_w = cols * tws + (cols + 1) * pad
        sheet_h = rows * (ths + label_h) + (rows + 1) * pad
        sheet = Image.new("RGB", (sheet_w, sheet_h), (38, 28, 22))
        draw = ImageDraw.Draw(sheet)
        fnt = font(18)
        for i, (t, im) in enumerate(thumbs):
            r, c = divmod(i, cols)
            x = pad + c * (tws + pad)
            y = pad + r * (ths + label_h + pad)
            sheet.paste(im.resize((tws, ths), Image.Resampling.LANCZOS), (x, y))
            label = f"{int(t // 60)}:{t % 60:05.2f}"
            draw.text((x + 6, y + ths + 4), label, fill=(245, 232, 214), font=fnt)
        sheet.save(strip_path, quality=90)
        print(f"wrote {strip_path} and {poster_path}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
