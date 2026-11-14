"""Clean up a phone photo of sheet music before optical music recognition.

Steps (each one is skipped when it doesn't apply):
  1. EXIF orientation, shrink huge photos.
  2. Find the page outline and undo the camera perspective (4-corner warp).
  3. Flatten uneven lighting / shadows (divide by a blurred background).
  4. Straighten: measure the staff-line angle and rotate it level.
  5. Gentle dewarp for page curl: follow the staff lines across the page and
     bend each column back so the lines are straight.
  6. Scale so staff spacing is ~20 px (what Audiveris likes), remove phone noise,
     stretch the contrast, and turn it into clean black and white (adaptive
     threshold). On our test photos black-and-white beat handing Audiveris the
     gray picture, especially for dim, noisy shots.
Returns the image plus a report of what was done.
"""
from __future__ import annotations

import io
import math

import cv2
import numpy as np
from PIL import Image, ImageOps


def load_image(data: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    img = img.convert("L")
    return np.array(img)


def _order_corners(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype(np.float32)
    s = pts.sum(1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], np.float32)


def paper_mask(gray: np.ndarray, size: int = 600):
    """Mask of the sheet of paper at low resolution, or None.

    Flood-fills from a bright, smooth spot near the middle, comparing each pixel
    with its neighbour, so slow shadows across the page are followed but the step
    from paper to table stops the fill. Holes (the printed music) are filled.
    """
    h, w = gray.shape
    s = size / max(h, w)
    small = cv2.resize(gray, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA)
    sm = cv2.medianBlur(small, 5)
    sm = cv2.GaussianBlur(sm, (3, 3), 0)
    H, W = sm.shape
    # seed: brightest smooth spot in the central area
    var = cv2.blur((sm.astype(np.float32) - cv2.blur(sm.astype(np.float32), (9, 9))) ** 2, (9, 9))
    cy0, cy1, cx0, cx1 = H // 4, 3 * H // 4, W // 4, 3 * W // 4
    region = sm[cy0:cy1, cx0:cx1].astype(np.float32) - 0.5 * np.sqrt(var[cy0:cy1, cx0:cx1])
    yy, xx = np.unravel_index(int(np.argmax(region)), region.shape)
    seed = (int(xx + cx0), int(yy + cy0))
    best = None
    for tol in (2, 3, 4, 6):
        mask = np.zeros((H + 2, W + 2), np.uint8)
        cv2.floodFill(sm.copy(), mask, seed, 255, loDiff=tol, upDiff=tol, flags=4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8))
        m = mask[1:-1, 1:-1]
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        c = max(cnts, key=cv2.contourArea)
        frac = cv2.contourArea(c) / (H * W)
        if frac > 0.97:  # leaked into the background
            break
        best = (c, frac)
        if frac > 0.35:
            break
    if not best or best[1] < 0.2:
        return None, s
    filled = np.zeros((H, W), np.uint8)
    cv2.drawContours(filled, [best[0]], -1, 255, -1)
    return filled, s


def find_page(gray: np.ndarray):
    """Return the 4 page corners (in gray coords) or None if the page fills the frame."""
    h, w = gray.shape
    mask, scale = paper_mask(gray)
    if mask is None:
        return None
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) > 0.95 * mask.size:
        return None
    # Hull first: a page cut off by the frame edge gives 5-6 corners; keep the best 4.
    hull = cv2.convexHull(c)
    peri = cv2.arcLength(hull, True)
    approx = None
    for eps in (0.01, 0.02, 0.03, 0.05, 0.08, 0.12):
        a = cv2.approxPolyDP(hull, eps * peri, True)
        if len(a) == 4:
            approx = a
            break
        if len(a) < 4:
            break
    if approx is None:
        approx = cv2.boxPoints(cv2.minAreaRect(hull))
    corners = _order_corners(np.array(approx, np.float32)) / scale
    # If the "page" touches the frame on all sides it is not a real outline.
    margin = 0.01 * max(h, w)
    touches = sum([
        corners[:, 0].min() < margin, corners[:, 1].min() < margin,
        corners[:, 0].max() > w - margin, corners[:, 1].max() > h - margin,
    ])
    if touches >= 4:
        return None
    return corners


def warp_page(gray: np.ndarray, corners: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = corners
    wa = np.linalg.norm(br - bl)
    wb = np.linalg.norm(tr - tl)
    ha = np.linalg.norm(tr - br)
    hb = np.linalg.norm(tl - bl)
    W = int(max(wa, wb))
    H = int(max(ha, hb))
    dst = np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], np.float32)
    M = cv2.getPerspectiveTransform(corners, dst)
    return cv2.warpPerspective(gray, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def whiten_outside_paper(gray: np.ndarray) -> np.ndarray:
    """Paint anything that isn't the sheet of paper (table, fingers, a dark border) white,
    so it can't be mistaken for staff lines or notes."""
    h, w = gray.shape
    mask, _ = paper_mask(gray)
    if mask is None:
        return gray
    mask = cv2.erode(mask, np.ones((3, 3), np.uint8))
    if mask.mean() > 254:
        return gray
    big = cv2.resize(mask, (w, h), interpolation=cv2.INTER_LINEAR) > 127
    out = gray.copy()
    out[~big] = int(np.percentile(gray[big], 90)) if big.any() else 255
    return out


def flatten_light(gray: np.ndarray) -> np.ndarray:
    """Divide by the paper's brightness so shadows and gradients go away."""
    h, w = gray.shape
    k = max(15, int(min(h, w) / 25) | 1)
    # closing removes the (dark) ink, leaving the paper brightness
    small = cv2.resize(gray, (w // 4 or 1, h // 4 or 1), interpolation=cv2.INTER_AREA)
    ks = max(5, (k // 4) | 1)
    bg = cv2.morphologyEx(small, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ks, ks)))
    bg = cv2.GaussianBlur(bg, (ks, ks), 0)
    bg = cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR)
    out = gray.astype(np.float32) / np.maximum(bg.astype(np.float32), 1.0) * 255.0
    return np.clip(out, 0, 255).astype(np.uint8)


def ink_mask(gray: np.ndarray) -> np.ndarray:
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 15)


def staff_angle(gray: np.ndarray) -> float:
    """Median angle (degrees) of long, nearly horizontal lines (staff lines)."""
    h, w = gray.shape
    mask = ink_mask(gray)
    lines = cv2.HoughLinesP(mask, 1, np.pi / 1800, threshold=200, minLineLength=int(w * 0.25), maxLineGap=int(w * 0.02))
    if lines is None:
        return 0.0
    angs = []
    for x1, y1, x2, y2 in lines[:, 0]:
        a = math.degrees(math.atan2(y2 - y1, x2 - x1))
        if abs(a) < 15:
            angs.append(a)
    return float(np.median(angs)) if angs else 0.0


def rotate(gray: np.ndarray, deg: float) -> np.ndarray:
    h, w = gray.shape
    M = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
    return cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def interline(gray: np.ndarray) -> float | None:
    """Estimate staff spacing (pixels) from the vertical run-lengths of white between black."""
    mask = ink_mask(gray) > 0
    h, w = mask.shape
    cols = mask[:, :: max(1, w // 200)]
    hist = np.zeros(200, np.int64)
    for c in cols.T:
        idx = np.flatnonzero(np.diff(c.astype(np.int8)) == 1)  # white->black
        if len(idx) > 1:
            d = np.diff(idx)
            d = d[(d > 4) & (d < 200)]
            np.add.at(hist, d, 1)
    if hist.sum() < 50:
        return None
    return float(np.argmax(hist))


def dewarp_curl(gray: np.ndarray, il: float) -> tuple[np.ndarray, float]:
    """Straighten curved staff lines (page curl near the spine).

    Split the page into vertical strips, find how far each strip's staff-line pattern
    is shifted up/down compared with the centre strip (cross-correlation of row
    profiles), smooth that into a per-column vertical offset and remap.
    Returns the image and the largest correction in pixels.
    """
    h, w = gray.shape
    mask = (ink_mask(gray) > 0).astype(np.float32)
    nstrips = 16
    sw = w // nstrips
    if sw < 20:
        return gray, 0.0
    profiles = [mask[:, i * sw:(i + 1) * sw].mean(1) for i in range(nstrips)]
    max_shift = int(il * 1.5)
    ref_i = nstrips // 2
    # Only use rows where staff lines are (the strong peaks), split into horizontal bands
    nbands = max(1, int(h / (il * 12)))
    band_h = h // nbands
    offsets = np.zeros((nbands, nstrips), np.float32)
    weights = np.zeros((nbands, nstrips), np.float32)
    for b in range(nbands):
        y0, y1 = b * band_h, min(h, (b + 1) * band_h)
        ref = profiles[ref_i][y0:y1]
        if ref.std() < 0.02:
            continue
        # walk outwards from the centre so each strip is compared with its neighbour
        for direction in (1, -1):
            prev_off = 0
            prev = ref
            i = ref_i + direction
            while 0 <= i < nstrips:
                cur = profiles[i][y0:y1]
                best, best_s = prev_off, -1.0
                for s in range(prev_off - max(2, int(il * 0.4)), prev_off + max(2, int(il * 0.4)) + 1):
                    if abs(s) > max_shift:
                        continue
                    a = np.roll(cur, -s)
                    sc = float(np.dot(a - a.mean(), ref - ref.mean()))
                    if sc > best_s:
                        best_s, best = sc, s
                offsets[b, i] = best
                weights[b, i] = max(0.0, best_s)
                prev_off = best
                i += direction
        weights[b, ref_i] = 1
    if weights.sum() == 0:
        return gray, 0.0
    # Bands must agree: a real curl bends every system the same way. Outliers
    # (lyrics, a busy bar) are replaced by the median of the bands.
    valid = weights[:, ref_i] > 0
    if valid.sum() == 0:
        return gray, 0.0
    med = np.median(offsets[valid], axis=0)
    spread = np.median(np.abs(offsets[valid] - med), axis=0)
    if np.abs(med).max() < max(2.0, 0.35 * il) or spread.max() > 0.4 * il:
        return gray, 0.0
    bad = np.abs(offsets - med) > 0.5 * il
    offsets = np.where(bad | ~valid[:, None], med, offsets)
    # per-band column offsets -> smooth dense map
    xs = (np.arange(nstrips) + 0.5) * sw
    ys = (np.arange(nbands) + 0.5) * band_h
    grid = np.zeros((nbands, w), np.float32)
    for b in range(nbands):
        grid[b] = np.interp(np.arange(w), xs, offsets[b])
    grid = cv2.GaussianBlur(grid, (0, 0), sigmaX=sw / 2, sigmaY=0.0) if w > 1 else grid
    # Small wobbles are noise (and Audiveris copes with them); only fix a real curl.
    if np.abs(grid).max() < max(2.0, 0.35 * il):
        return gray, 0.0
    dense = np.zeros((h, w), np.float32)
    for x in range(w):
        dense[:, x] = np.interp(np.arange(h), ys, grid[:, x])
    mapx = np.tile(np.arange(w, dtype=np.float32), (h, 1))
    mapy = (np.arange(h, dtype=np.float32)[:, None] + dense).astype(np.float32)
    out = cv2.remap(gray, mapx, mapy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return out, float(np.abs(grid).max())


def clean(data: bytes, *, target_interline: float = 20.0, denoise: bool = True, binarize: bool = True) -> tuple[np.ndarray, dict]:
    report: dict = {}
    gray = load_image(data)
    h, w = gray.shape
    report["input_size"] = [w, h]
    if max(h, w) > 4000:
        s = 4000 / max(h, w)
        gray = cv2.resize(gray, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    corners = find_page(gray)
    if corners is not None:
        gray = warp_page(gray, corners)
        report["page_found"] = True
    else:
        report["page_found"] = False
    gray = whiten_outside_paper(gray)
    gray = flatten_light(gray)
    ang = staff_angle(gray)
    if abs(ang) > 0.1:
        gray = rotate(gray, ang)
    report["rotated_deg"] = round(ang, 2)
    il = interline(gray)
    report["interline_px"] = il
    if il:
        try:
            gray, curl = dewarp_curl(gray, il)
            report["curl_fix_px"] = round(curl, 1)
        except Exception as e:  # never fail the scan because of the dewarp
            report["curl_fix_error"] = str(e)
        s = target_interline / il
        if s > 1.15 or s < 0.75:
            s = min(max(s, 0.5), 3.0)
            gray = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC if s > 1 else cv2.INTER_AREA)
            report["scaled"] = round(s, 2)
    if denoise:
        # phone noise turns into speckles once contrast is stretched; strength follows the noise level
        noise = float(np.median(np.abs(gray.astype(np.int16)[:, 1:] - gray.astype(np.int16)[:, :-1])))
        report["noise"] = round(noise, 1)
        if noise >= 2:
            gray = cv2.fastNlMeansDenoising(gray, None, h=min(18.0, 3.0 + 2.5 * noise), templateWindowSize=7, searchWindowSize=21)
    # contrast stretch: paper -> white, ink -> black, keep anti-aliasing
    lo, hi = np.percentile(gray, [1, 60])
    if hi - lo > 10:
        gray = np.clip((gray.astype(np.float32) - lo) * 255.0 / (hi - lo), 0, 255).astype(np.uint8)
    if binarize:
        block = int(max(15, (report.get("interline_px") or 20) * 2)) | 1
        gray = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 12)
    report["output_size"] = [gray.shape[1], gray.shape[0]]
    return gray, report


def to_png(gray: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", gray)
    if not ok:
        raise RuntimeError("PNG encode failed")
    return buf.tobytes()
