"""Score the scan pipeline on fake phone photos, with and without cleanup.

usage: (server venv) python eval_scans.py PHOTODIR [OUTDIR]
       python eval_scans.py PHOTODIR OUTDIR --rescore RAWJOB CLEANJOB PERFECTJOB
PHOTODIR comes from make_test_photos.py (name-mild.jpg, name-truth.musicxml, ...).
Prints a Markdown table and writes OUTDIR/results.json.
"""
import json
import subprocess
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import app  # noqa: E402

REPO = HERE.parent.parent


def compare(truth: Path, scanned: Path | None) -> dict:
    if not scanned or not scanned.exists():
        return {"pitchAccuracy": 0.0, "pitchAndRhythm": 0.0, "noteAccuracy": 0.0, "failed": True}
    p = subprocess.run(["node", "tools/compare-songs.mjs", str(truth), str(scanned)], cwd=REPO, capture_output=True, text=True)
    try:
        r = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        return {"pitchAccuracy": 0.0, "pitchAndRhythm": 0.0, "noteAccuracy": 0.0, "failed": True, "err": p.stderr[-300:]}
    # notes right minus extra/missing ones, as a share of the true notes (can't go below 0)
    r["noteAccuracy"] = round(max(0.0, (r["trueNotes"] - r["editDistance"]) / r["trueNotes"] * 100), 1)
    return r


def score_job(job: Path, src: Path, mode: str, results: dict) -> None:
    res = json.loads((job / "result.json").read_text())
    for e in res["pages"]:
        name = e["name"].rsplit(".", 1)[0]
        base, level = name.rsplit("-", 1)
        mxl = app._score_file(job / ("omr"), e["stem"])
        r = compare(src / f"{base}-truth.musicxml", mxl)
        r["usedRawPhoto"] = e.get("usedRawPhoto", False)
        r["cleanup"] = e.get("cleanup")
        results.setdefault(base, {}).setdefault(level, {})[mode] = r
    results.setdefault("_timings", {})[mode] = res.get("timings")


def table(results: dict) -> str:
    fmt = lambda r: "failed" if r.get("failed") else f"{r['noteAccuracy']} / {r['pitchAccuracy']} / {r['pitchAndRhythm']}"
    out = ["| Score | Picture | Raw photo: notes / pitch / pitch+rhythm (%) | After cleanup (%) |", "|---|---|---|---|"]
    sums = {"raw": [], "cleaned": []}
    for base, lv in results.items():
        if base.startswith("_"):
            continue
        if "page" in lv:
            out.append(f"| {base} | clean render (ceiling) | {fmt(lv['page']['perfect'])} | – |")
        for level in ("mild", "medium", "hard"):
            if level not in lv:
                continue
            a, b = lv[level].get("raw", {}), lv[level].get("cleaned", {})
            sums["raw"].append(a.get("noteAccuracy", 0))
            sums["cleaned"].append(b.get("noteAccuracy", 0))
            out.append(f"| {base} | {level} photo | {fmt(a)} | {fmt(b)}{' (fell back to raw)' if b.get('usedRawPhoto') else ''} |")
    if sums["raw"]:
        avg = lambda xs: round(sum(xs) / len(xs), 1)
        out.append(f"| **average of all photos** | | **{avg(sums['raw'])}** | **{avg(sums['cleaned'])}** |")
    return "\n".join(out)


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src / "eval"
    out.mkdir(parents=True, exist_ok=True)
    results: dict = {}
    if "--rescore" in sys.argv:
        jobs = sys.argv[sys.argv.index("--rescore") + 1:]
        for mode, j in zip(("raw", "cleaned", "perfect"), jobs):
            score_job(app.JOBS / j, src, mode, results)
    else:
        photos = sorted(src.glob("*.jpg"))
        renders = sorted(src.glob("*-page.png"))
        for mode, files, clean in (("raw", photos, False), ("cleaned", photos, True), ("perfect", renders, False)):
            job = app.JOBS / ("eval" + mode + uuid.uuid4().hex[:6])
            job.mkdir(parents=True)
            res = app.scan_pages(job, [(p.name, p.read_bytes()) for p in files], do_clean=clean)
            print(mode, res["timings"], file=sys.stderr)
            score_job(job, src, mode, results)
    (out / "results.json").write_text(json.dumps(results, indent=1))
    t = table(results)
    (out / "results.md").write_text(t + "\n")
    print(t)


if __name__ == "__main__":
    main()
