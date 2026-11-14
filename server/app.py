"""Scan backend: photo/PDF of sheet music -> cleaned image -> Audiveris -> MusicXML.

Run with ./start.sh (it also opens a free Cloudflare quick tunnel for the phone).
Every request needs the access key (from server/.env, never committed): visit
any page once with ?key=..., which sets a cookie, or send header X-Scan-Key.

This backend calls Audiveris (AGPL-3.0) as a separate program. It is kept as
its own service on purpose; see server/README.md.
"""
from __future__ import annotations

import io
import json
import os
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import omrinfo
import preprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CACHE = Path(os.environ.get("NP_CACHE", Path.home() / ".cache" / "note-performance"))
JOBS = CACHE / "scan-jobs"
JOBS.mkdir(parents=True, exist_ok=True)


def _load_env() -> dict:
    env = {}
    p = HERE / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


ENV = _load_env()
KEY = os.environ.get("SCAN_KEY") or ENV.get("SCAN_KEY") or ""
AUDIVERIS = os.environ.get("AUDIVERIS") or str(CACHE / "audiveris" / "opt" / "audiveris" / "bin" / "Audiveris")
TESSDATA = os.environ.get("TESSDATA_PREFIX") or str(CACHE / "tessdata")
MAX_UPLOAD = 40 * 1024 * 1024
MAX_PAGES = 12
LOCK = threading.Lock()
OPEN_PATHS = {"/manifest.webmanifest", "/api/health", "/favicon.ico"}

app = FastAPI(title="note-performance scan backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://silkwormx.github.io", "http://localhost:8000", "http://127.0.0.1:8000"],
    allow_methods=["GET", "POST"],
    allow_headers=["X-Scan-Key", "Content-Type"],
)


def _key_ok(request: Request) -> bool:
    if not KEY:
        return True
    for k in (request.headers.get("x-scan-key"), request.cookies.get("scan_key"), request.query_params.get("key")):
        if k and secrets.compare_digest(k, KEY):
            return True
    return False


@app.middleware("http")
async def require_key(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS" or path in OPEN_PATHS or path.startswith("/assets/icons/"):
        return await call_next(request)
    if not _key_ok(request):
        if path.startswith("/api/"):
            return JSONResponse({"error": "Missing or wrong access key."}, status_code=401)
        return HTMLResponse(
            "<!doctype html><meta name=viewport content='width=device-width'>"
            "<body style='font-family:sans-serif;padding:2em'><h2>Locked</h2>"
            "<p>Open the full link (the one that ends in <code>?key=…</code>) once on this device.</p>",
            status_code=401,
        )
    resp = await call_next(request)
    qk = request.query_params.get("key")
    if KEY and qk and secrets.compare_digest(qk, KEY):
        resp.set_cookie("scan_key", KEY, max_age=60 * 60 * 24 * 365, httponly=True, samesite="lax", secure=request.url.scheme == "https")
    return resp


def _cleanup_old_jobs(max_age_s: int = 24 * 3600) -> None:
    now = time.time()
    for d in JOBS.iterdir():
        try:
            if d.is_dir() and now - d.stat().st_mtime > max_age_s:
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass


def _pdf_to_pngs(pdf: Path, outdir: Path) -> list[Path]:
    subprocess.run(["pdftoppm", "-r", "300", "-gray", "-png", str(pdf), str(outdir / (pdf.stem + "-p"))], check=True, timeout=180)
    return sorted(outdir.glob(pdf.stem + "-p*.png"))[:MAX_PAGES]


def _preview_jpg(data: bytes, out: Path, max_side: int = 1600) -> None:
    from PIL import Image, ImageOps

    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    im.thumbnail((max_side, max_side))
    im.save(out, "JPEG", quality=82)


def _run_audiveris(inputs: list[Path], outdir: Path) -> tuple[int, str, float]:
    env = dict(os.environ, TESSDATA_PREFIX=TESSDATA, JAVA_TOOL_OPTIONS="-Djava.awt.headless=true")
    t0 = time.time()
    cmd = [AUDIVERIS, "-batch", "-export", "-output", str(outdir), "--", *map(str, inputs)]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=600, env=env)
    log = (p.stdout or "") + (p.stderr or "")
    (outdir / "audiveris.log").write_text(log)
    return p.returncode, log, time.time() - t0


def _read_mxl(path: Path) -> bytes:
    import re
    import zipfile

    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode("utf-8", "replace")
        m = re.search(r'full-path="([^"]+)"', c)
        name = m.group(1) if m else next(n for n in z.namelist() if not n.startswith("META-INF"))
        return z.read(name)


def merge_movements(files: list[Path], out: Path) -> Path:
    """Audiveris starts a new "movement" at every indented system. Join them back
    into one MusicXML (measures appended part by part, renumbered)."""
    import xml.etree.ElementTree as ET

    if len(files) == 1:
        return files[0]
    base = ET.fromstring(_read_mxl(files[0]))
    parts = base.findall("part")
    for f in files[1:]:
        other = ET.fromstring(_read_mxl(f))
        for i, op in enumerate(other.findall("part")):
            if i < len(parts):
                for m in op.findall("measure"):
                    parts[i].append(m)
    for p in parts:
        for n, m in enumerate(p.findall("measure"), start=1):
            if m.get("implicit") != "yes":
                m.set("number", str(n))
    out.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(base, encoding="unicode"), encoding="utf-8")
    return out


def _score_file(outdir: Path, stem: str) -> Path | None:
    exact = outdir / f"{stem}.mxl"
    if exact.exists():
        return exact
    mv = sorted(outdir.glob(f"{stem}.mvt*.mxl"), key=lambda p: int(p.name.split(".mvt")[1].split(".")[0]))
    if not mv:
        return None
    return merge_movements(mv, outdir / f"{stem}.musicxml")


def _weak(outdir: Path, stem: str) -> bool:
    """True when most bars Audiveris found don't add up (a sign the page was misread)."""
    omr = _find_output(outdir, stem, "omr")
    if not omr:
        return True
    try:
        ms = omrinfo.read_omr(str(omr))["sheets"][0]["measures"]
    except Exception:
        return True
    if not ms:
        return True
    return sum(1 for m in ms if not m["durationOk"]) > 0.4 * len(ms)


def _find_output(outdir: Path, stem: str, ext: str) -> Path | None:
    exact = outdir / f"{stem}.{ext}"
    if exact.exists():
        return exact
    c = sorted(outdir.glob(f"{stem}*.{ext}"))
    return c[0] if c else None


def scan_pages(job: Path, pages: list[tuple[str, bytes]], do_clean: bool = True) -> dict:
    """pages: (name, image bytes). Writes into job dir, returns the JSON result."""
    result = {"job": job.name, "pages": [], "timings": {}}
    t0 = time.time()
    inputs = []
    for i, (name, data) in enumerate(pages):
        stem = f"page{i + 1:02d}"
        _preview_jpg(data, job / f"{stem}-orig.jpg")
        entry = {"index": i, "name": name, "stem": stem, "original": f"{stem}-orig.jpg"}
        if do_clean:
            try:
                gray, report = preprocess.clean(data)
                (job / f"{stem}.png").write_bytes(preprocess.to_png(gray))
                entry["cleanup"] = report
            except Exception as e:  # fall back to the raw image
                entry["cleanup"] = {"error": str(e)}
                (job / f"{stem}.png").write_bytes(preprocess.to_png(preprocess.load_image(data)))
        else:
            (job / f"{stem}.png").write_bytes(preprocess.to_png(preprocess.load_image(data)))
            entry["cleanup"] = {"skipped": True}
        entry["cleaned"] = f"{stem}.png"
        inputs.append(job / f"{stem}.png")
        result["pages"].append(entry)
    result["timings"]["cleanup_s"] = round(time.time() - t0, 2)

    outdir = job / "omr"
    outdir.mkdir(exist_ok=True)
    with LOCK:
        code, log, secs = _run_audiveris(inputs, outdir)
    result["timings"]["audiveris_s"] = round(secs, 2)

    # Black-and-white cleanup reads dim, noisy photos best, but now and then it
    # loses a page. Those pages get a second try with the gray cleanup, then
    # with the untouched photo, and the best reading is kept.
    def quality(d: Path, stem: str) -> float:
        if not _score_file(d, stem):
            return -1.0
        omr = _find_output(d, stem, "omr")
        try:
            ms = omrinfo.read_omr(str(omr))["sheets"][0]["measures"] if omr else []
        except Exception:
            ms = []
        return float(sum(1 for m in ms if m["durationOk"]) + 0.5 * sum(1 for m in ms if m["minGrade"] >= omrinfo.LOW_GRADE))

    if do_clean:
        scores = {e["stem"]: quality(outdir, e["stem"]) for e in result["pages"]}
        weak = [e for e in result["pages"] if scores[e["stem"]] <= 0 or _weak(outdir, e["stem"])]
        for label, make in (("gray", lambda data: preprocess.clean(data, binarize=False)[0]), ("raw", preprocess.load_image)):
            if not weak:
                break
            rdir = job / f"omr-{label}"
            rdir.mkdir(exist_ok=True)
            ins = []
            for e in weak:
                p = rdir / f"{e['stem']}.png"
                try:
                    p.write_bytes(preprocess.to_png(make(pages[e["index"]][1])))
                except Exception:
                    continue
                ins.append(p)
            with LOCK:
                _run_audiveris(ins, rdir)
            still = []
            for e in weak:
                q = quality(rdir, e["stem"])
                if q > scores[e["stem"]]:
                    for old in outdir.glob(f"{e['stem']}.*"):
                        if old.suffix in (".mxl", ".omr", ".musicxml"):
                            old.unlink()
                    for f in rdir.glob(f"{e['stem']}.*"):
                        if f.suffix in (".mxl", ".omr"):
                            shutil.copy(f, outdir / f.name)
                    scores[e["stem"]] = q
                    e["usedFallback"] = label
                    if label == "raw":
                        e["usedRawPhoto"] = True
                    if label == "gray":
                        shutil.copy(rdir / f"{e['stem']}.png", job / f"{e['stem']}.png")
                if scores[e["stem"]] <= 0 or _weak(outdir, e["stem"]):
                    still.append(e)
            weak = still
        result["timings"]["retries_s"] = round(time.time() - t0 - result["timings"]["cleanup_s"] - result["timings"]["audiveris_s"], 2)

    for entry in result["pages"]:
        stem = entry["stem"]
        mxl = _score_file(outdir, stem)
        omr = _find_output(outdir, stem, "omr")
        entry["mxl"] = f"omr/{mxl.name}" if mxl else None
        if not mxl:
            entry["error"] = "No music was recognized on this page. Try a straighter, brighter photo that shows the whole page."
        if omr:
            try:
                info = omrinfo.read_omr(str(omr))
                if info["sheets"]:
                    sh = info["sheets"][0]
                    entry["sheet"] = {"width": sh["width"], "height": sh["height"], "measures": sh["measures"]}
                    if sh["binary"]:
                        png = omrinfo.binary_png(str(omr), sh["binary"])
                        if png:
                            # store a lighter preview (1-bit PNG is small anyway)
                            (job / f"{stem}-sheet.png").write_bytes(png)
                            entry["sheetImage"] = f"{stem}-sheet.png"
            except Exception as e:
                entry["sheetError"] = str(e)
    tail = [ln for ln in log.splitlines() if " WARN " in ln or "ERROR" in ln][-15:]
    result["log"] = tail
    result["timings"]["total_s"] = round(time.time() - t0, 2)
    (job / "result.json").write_text(json.dumps(result, indent=1))
    return result


@app.get("/api/health")
def health():
    return {"ok": True, "audiveris": Path(AUDIVERIS).exists(), "ocr": (Path(TESSDATA) / "eng.traineddata").exists()}


@app.post("/api/scan")
async def scan(request: Request, files: list[UploadFile] = File(...)):
    _cleanup_old_jobs()
    do_clean = request.query_params.get("clean", "1") != "0"
    job = JOBS / uuid.uuid4().hex[:12]
    job.mkdir(parents=True)
    pages: list[tuple[str, bytes]] = []
    total = 0
    for f in files:
        data = await f.read()
        total += len(data)
        if total > MAX_UPLOAD:
            raise HTTPException(413, "Files are too big (40 MB max).")
        name = f.filename or "page"
        if name.lower().endswith(".pdf") or data[:4] == b"%PDF":
            pdf = job / f"upload{len(pages)}.pdf"
            pdf.write_bytes(data)
            for p in _pdf_to_pngs(pdf, job):
                pages.append((f"{name} p{len(pages) + 1}", p.read_bytes()))
        else:
            try:
                preprocess.load_image(data)
            except Exception:
                raise HTTPException(400, f"{name} is not a picture or PDF I can read.")
            pages.append((name, data))
    if not pages:
        raise HTTPException(400, "No pages uploaded.")
    if len(pages) > MAX_PAGES:
        raise HTTPException(400, f"Up to {MAX_PAGES} pages at a time, please.")
    import anyio

    result = await anyio.to_thread.run_sync(scan_pages, job, pages, do_clean)
    return result


@app.get("/api/job/{job}/{path:path}")
def job_file(job: str, path: str):
    if not job.isalnum():
        raise HTTPException(404)
    base = (JOBS / job).resolve()
    f = (base / path).resolve()
    if base not in f.parents or not f.is_file():
        raise HTTPException(404)
    return FileResponse(f, headers={"Cache-Control": "private, max-age=86400"})


# Keep repo internals off the tunnel.
class GuardedStatic(StaticFiles):
    HIDDEN = (".git", "server", "node_modules", "tests", "verify", "tools", ".env")

    async def get_response(self, path, scope):
        first = path.split("/")[0]
        if first in self.HIDDEN or path.endswith(".env"):
            return Response(status_code=404)
        return await super().get_response(path, scope)


app.mount("/", GuardedStatic(directory=str(REPO), html=True), name="app")
