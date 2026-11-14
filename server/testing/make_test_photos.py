"""Make realistic "phone photo" test images from public-domain MusicXML.

usage: python make_test_photos.py OUTDIR score.musicxml [score2 ...]
Needs: verovio, cairosvg, opencv-python, numpy (not part of the server venv).

For each score: keep the first 12 measures, render one clean A4 page with
Verovio, then fake three photos of it lying on a table:
  mild   - small tilt, soft light
  medium - perspective, shadow across the page, slight curl
  hard   - strong perspective, dark corner shadow, page curl, blur, noise, low-res
Also writes <name>-truth.musicxml (the truncated score) for scoring.
"""
import random
import re
import sys
import zipfile
from pathlib import Path

import cairosvg
import cv2
import numpy as np
import verovio


def read_xml(path: Path) -> str:
    if path.suffix == ".mxl":
        with zipfile.ZipFile(path) as z:
            c = z.read("META-INF/container.xml").decode()
            m = re.search(r'full-path="([^"]+)"', c)
            return z.read(m.group(1)).decode("utf-8")
    return path.read_text(encoding="utf-8")


def truncate(xml: str, n: int = 12) -> str:
    # drop <measure> elements after the n-th in every part (partwise only)
    def cut(part_m):
        body = part_m.group(0)
        ms = list(re.finditer(r"<measure\b.*?</measure>", body, re.S))
        if len(ms) <= n:
            return body
        return body[: ms[n - 1].end()] + body[ms[-1].end():]
    xml = re.sub(r"<part\s+id=.*?</part>", cut, xml, flags=re.S)
    # no "new page" breaks
    xml = re.sub(r'new-page="yes"', 'new-page="no"', xml)
    return xml


def render(xml: str, out_png: Path) -> np.ndarray:
    tk = verovio.toolkit()
    tk.setOptions({"pageWidth": 2100, "pageHeight": 2970, "scale": 72, "adjustPageHeight": False,
                   "footer": "none", "header": "auto", "breaks": "auto",
                   "pageMarginLeft": 140, "pageMarginRight": 140, "pageMarginTop": 140, "pageMarginBottom": 140})
    tk.loadData(xml)
    svg = tk.renderToSVG(1)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=str(out_png), background_color="white", output_width=2480)
    img = cv2.imread(str(out_png), cv2.IMREAD_COLOR)
    return img


def table_texture(h, w, rng):
    base = np.array(rng.choice([(70, 100, 140), (40, 60, 90), (120, 120, 125), (35, 35, 40)]), np.float32)  # BGR wood/grey
    noise = cv2.GaussianBlur(rng.standard_normal((h, w)).astype(np.float32), (0, 0), 25) * 60
    streak = cv2.GaussianBlur(rng.standard_normal((h, 1)).astype(np.float32), (0, 0), 3) * 25
    tex = base[None, None, :] + (noise + streak)[:, :, None]
    return np.clip(tex, 0, 255)


def curl(page: np.ndarray, amount: float) -> np.ndarray:
    """Bend the page: rows sag toward one side like a book near its spine."""
    h, w = page.shape[:2]
    xs = np.arange(w, dtype=np.float32)
    ys = np.arange(h, dtype=np.float32)
    X, Y = np.meshgrid(xs, ys)
    t = X / w
    dy = amount * (np.clip(t - 0.55, 0, None) / 0.45) ** 2 * h * 0.02 * (0.5 + Y / h)
    dy += amount * np.sin(np.pi * t) * h * 0.004
    dx = -amount * (np.clip(t - 0.75, 0, None) / 0.25) ** 2 * w * 0.01
    return cv2.remap(page, X + dx, Y - dy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))


def photo(page: np.ndarray, level: str, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    P = {
        "mild": dict(persp=0.025, rot=2.0, curl=0.0, shadow=0.15, blur=0.6, noise=3, out=(3024, 4032), q=88),
        "medium": dict(persp=0.06, rot=4.0, curl=0.6, shadow=0.35, blur=1.0, noise=6, out=(2448, 3264), q=80),
        "hard": dict(persp=0.10, rot=7.0, curl=1.0, shadow=0.55, blur=1.6, noise=9, out=(1836, 2448), q=70),
    }[level]
    h, w = page.shape[:2]
    page = page.astype(np.float32)
    # paper colour (slightly warm)
    page = page * np.array([0.93, 0.97, 1.0], np.float32)
    if P["curl"]:
        page = curl(page, P["curl"])
    W, H = P["out"]
    canvas = table_texture(H, W, rng)
    # where the page lands: ~85% of the frame, then jitter the corners
    pw = W * 0.86
    ph = pw * h / w
    if ph > H * 0.92:
        ph = H * 0.92
        pw = ph * w / h
    cx, cy = W / 2 + rng.uniform(-0.03, 0.03) * W, H / 2 + rng.uniform(-0.03, 0.03) * H
    ang = np.radians(rng.uniform(-P["rot"], P["rot"]))
    base = np.array([[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]])
    R = np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    dst = base @ R.T + [cx, cy]
    dst += rng.uniform(-P["persp"], P["persp"], (4, 2)) * [pw, ph]
    # keystone: top narrower (camera tilted)
    k = P["persp"] * pw * 0.8
    dst[0, 0] += k; dst[1, 0] -= k
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    M = cv2.getPerspectiveTransform(src, dst.astype(np.float32))
    warped = cv2.warpPerspective(page, M, (W, H), flags=cv2.INTER_AREA, borderValue=(0, 0, 0))
    mask = cv2.warpPerspective(np.ones((h, w), np.float32), M, (W, H), flags=cv2.INTER_LINEAR)
    img = canvas * (1 - mask[:, :, None]) + warped * mask[:, :, None]
    # lighting: overall gradient + a soft shadow blob (phone/hand)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    grad = 1 - 0.25 * P["shadow"] * (xx / W) - 0.2 * P["shadow"] * (yy / H)
    bx, by = rng.uniform(0.2, 0.8) * W, rng.uniform(0.15, 0.6) * H
    blob = np.exp(-(((xx - bx) / (0.35 * W)) ** 2 + ((yy - by) / (0.25 * H)) ** 2))
    light = grad * (1 - P["shadow"] * blob)
    img = img * light[:, :, None]
    if P["blur"]:
        img = cv2.GaussianBlur(img, (0, 0), P["blur"])
    img += rng.normal(0, P["noise"], img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, P["q"]])
    return buf.tobytes()


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for i, src in enumerate(map(Path, sys.argv[2:])):
        name = re.sub(r"\.(musicxml|xml|mxl)$", "", src.name)
        xml = truncate(read_xml(src))
        (out / f"{name}-truth.musicxml").write_text(xml, encoding="utf-8")
        page = render(xml, out / f"{name}-page.png")
        for j, level in enumerate(("mild", "medium", "hard")):
            (out / f"{name}-{level}.jpg").write_bytes(photo(page, level, seed=1000 * i + j))
        print("made", name)


if __name__ == "__main__":
    main()
