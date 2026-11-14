"""Read Audiveris' own project file (.omr) for per-measure confidence.

The .omr is a zip with sheet#N/sheet#N.xml. Each <system> has <stack> elements
(one per measure column, with left/right x and the expected vs found duration)
and the recognised symbols ("inters") with a contextual grade 0..1.
We report, per measure (in score order): the lowest note-head grade, whether
the found duration matches the time signature, and the measure's box on the
page image (sheet#N/BINARY.png, same pixel grid).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
import zipfile
from fractions import Fraction

LOW_GRADE = 0.6  # below this a note head is "not sure"


def _frac(s: str | None) -> Fraction | None:
    if not s:
        return None
    try:
        return Fraction(s)
    except (ValueError, ZeroDivisionError):
        return None


def read_omr(path: str) -> dict:
    out = {"sheets": []}
    with zipfile.ZipFile(path) as z:
        names = sorted(n for n in z.namelist() if re.match(r"sheet#\d+/sheet#\d+\.xml$", n))
        for n in names:
            sheet_dir = n.split("/")[0]
            root = ET.fromstring(z.read(n))
            pic = root.find("picture")
            sheet = {
                "name": sheet_dir,
                "width": round(float(pic.get("width"))) if pic is not None else None,
                "height": round(float(pic.get("height"))) if pic is not None else None,
                "binary": f"{sheet_dir}/BINARY.png" if f"{sheet_dir}/BINARY.png" in z.namelist() else None,
                "measures": [],
            }
            for system in root.iter("system"):
                # vertical extent from staff lines
                ys = [round(float(p.get("y"))) for p in system.iter("point")]
                heads = []
                for el in system.iter():
                    if el.tag not in ("head", "rest", "augmentation-dot", "flag", "beam", "alter"):
                        continue
                    b = el.find("bounds")
                    g = el.get("ctx-grade") or el.get("grade")
                    if b is None or g is None:
                        continue
                    x, y, w, h = (round(float(b.get(k))) for k in ("x", "y", "w", "h"))
                    heads.append({"tag": el.tag, "x": x, "y": y, "w": w, "h": h, "grade": float(g)})
                y0 = min(ys + [h["y"] for h in heads]) if (ys or heads) else 0
                y1 = max(ys + [h["y"] + h["h"] for h in heads]) if (ys or heads) else 0
                for st in system.findall("stack"):
                    left, right = round(float(st.get("left"))), round(float(st.get("right")))
                    exp, dur = _frac(st.get("expected")), _frac(st.get("duration"))
                    inside = [h for h in heads if left <= h["x"] + h["w"] / 2 < right]
                    note_heads = [h for h in inside if h["tag"] in ("head", "rest")]
                    low = [h for h in inside if h["grade"] < LOW_GRADE]
                    sheet["measures"].append({
                        "box": [left, max(0, y0 - 40), right - left, (y1 - y0) + 80],
                        "expected": str(exp) if exp is not None else None,
                        "found": str(dur) if dur is not None else None,
                        "durationOk": (exp is None or dur is None or exp == dur),
                        "minGrade": round(min((h["grade"] for h in note_heads), default=1.0), 3),
                        "lowSpots": [[h["x"], h["y"], h["w"], h["h"], round(h["grade"], 2)] for h in low][:20],
                        "symbols": len(note_heads),
                    })
            out["sheets"].append(sheet)
    return out


def binary_png(path: str, member: str) -> bytes | None:
    with zipfile.ZipFile(path) as z:
        try:
            return z.read(member)
        except KeyError:
            return None
