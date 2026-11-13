# Scanning sheet music: feasibility test (Nov 2026)

`tools/scan.sh [--engine audiveris|oemer] page.png` turns an image into MusicXML and then into the song format. Open the `.mxl` or `.musicxml` result in the player with **Open song…**. This is a local tool only and is not wired into the website.

## How we tested

We drew test pages from our own demo files with Verovio (LGPL), so the right answer is known. There were two kinds:

- **Clean digital pages:** crisp engraving, some with lyrics and chord names.
- **Simulated scans:** the same pages rotated 1.3°, shrunk, blurred, with uneven lighting, noise, and JPEG compression.

`tools/compare-songs.mjs` lines up the scanned notes with the true notes and scores them. "Pitch" means the right note in the right order. "Pitch + rhythm" also needs the right length. All runs were on the box CPU (8 cores, no GPU).

| Page | Audiveris 5.11: pitch / pitch+rhythm | oemer 0.1.8: pitch / pitch+rhythm |
|---|---|---|
| Twinkle, with lyrics and chord names | 92.9% / 92.9% | 40.5% / 33.3% |
| Ode to Joy, with chord names | 100% / 100% | 45.2% / 29.0% |
| Frère Jacques, with lyrics, key of F | 100% / 100% | 3.1% / 0% |
| Twinkle, melody only | 92.9% / 92.9% | 59.5% / 7.1% |
| Ode to Joy, melody only | 95.2% / 95.2% | 66.1% / 58.1% |
| Mary, melody only | 88.5% / 88.5% | 76.9% / 0% |
| Frère Jacques, melody only | 90.6% / 87.5% | not run |
| Twinkle, simulated scan | 92.9% / 92.9% | 92.9% / 92.9% |
| Ode to Joy, simulated scan | 95.2% / 95.2% | 100% / 93.5% |
| Mary, slightly blurred | not run | 11.5% / 0% |
| **Time per page** | **4–10 s** | **120–160 s** |

Notes:
- **Audiveris** was consistent. Its usual mistake was dropping a bar at the end of a line, about 3 notes per page. It ignored the chord names and tempo marks, so the player guessed the chords from the notes.
- **oemer** was erratic. It did well on scan-like images and badly on crisp digital pages. It often read quarter notes as whole notes, and it lost notes near lyrics and chord names.
- These pages were simple single-line melodies. Real phone photos of printed books, two-hand piano music, and handwritten music will score lower. The app will always need a "fix the notes" screen.

## Licenses (important for a paid app)

| Engine | License | Can it ship inside a closed-source paid app? |
|---|---|---|
| oemer | MIT | Yes, with the copyright notice. Its accuracy is the problem. |
| Audiveris | AGPL-3.0 | Not without releasing your whole app's source under the AGPL, or getting a commercial license from its authors. The AGPL also covers running it on a server for users. Fine as a personal or local tool. |

Options for a product: (1) license Audiveris commercially, (2) use a commercial OMR engine or API (check each one's terms), or (3) start from oemer or another MIT/Apache model and improve it. MusicXML import already works with files that people export from MuseScore or from any scanning app, so scanning can stay optional at first.

## Setup used

- **oemer:** Python 3.12 venv (made with uv), `oemer`, `onnxruntime==1.19.2`, and `opencv-python==4.10.0.84`. Newer onnxruntime refuses oemer's models, and OpenCV 5 breaks its line finder. About 1.5 GB with models. `tools/scan.sh` sets this up on first use.
- **Audiveris:** the official Ubuntu 24.04 `.deb` (5.11.0) unpacked with `dpkg-deb -x`, no install needed. It bundles its own Java runtime. Run with `-batch -export`.
