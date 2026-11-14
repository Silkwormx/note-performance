# Scanning sheet music: feasibility test (Nov 2026)

`tools/scan.sh [--engine audiveris|oemer] page.png` turns an image into MusicXML and then into the song format. Open the `.mxl` or `.musicxml` result in the player with **Open song…**. The same engine now powers `scan.html` through the backend in `server/` (see the phone-photo results below).

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

## Phone photos, before and after cleanup (scan backend, Nov 2026)

`server/testing/make_test_photos.py` takes the first 12 bars of 8 public-domain scores: our 4 demos plus Beethoven, Bach, Clementi and Schumann from the OpenSheetMusicDisplay test files. It renders each one with Verovio and fakes 3 phone photos of the page lying on a table:

- **mild:** slight tilt, soft light, 12 MP.
- **medium:** perspective, a shadow, a slight page curl, 8 MP.
- **hard:** strong perspective, a dark shadow, page curl, blur, heavy noise, 4.5 MP, and part of the page cut off.

`server/testing/eval_scans.py` reads every photo through Audiveris twice, first as taken and then after `server/preprocess.py` cleans it up. It scores each reading against the true score.

- "notes" counts the right notes minus any extra or missing ones.
- "pitch" counts the right notes in the right order.
- "pitch+rhythm" also needs the right length.

| Photo type | As taken (notes, avg) | After cleanup (notes, avg) |
|---|---|---|
| mild | 87.0% | 86.4% |
| medium | 33.6% | 86.2% |
| hard | 0% (Audiveris gave up on all 8) | 51.6% |
| all 24 | 40.2% | **74.7%** |

The cleanup:

- finds the page and undoes the perspective
- flattens shadows and whitens the table
- straightens the staff lines and unbends a strong curl
- rescales to a 20 px staff space, denoises and converts to black and white

When a page still reads badly (most bars don't add up), it is tried again from the gray cleanup and then from the raw photo, and the best reading is kept. Speed on the box (8 CPU cores) is 10–25 s per page, or up to about 40 s when a page is retried. A clean digital page is the ceiling: 74–100%.

Full results:

| Score | Picture | Raw photo: notes / pitch / pitch+rhythm (%) | After cleanup (%) |
|---|---|---|---|
| Beethoven_OdeToJoy | clean render (ceiling) | 90.0 / 90 / 90 | – |
| Beethoven_OdeToJoy | mild photo | 76.7 / 76.7 / 73.3 | 43.3 / 56.7 / 56.7 |
| Beethoven_OdeToJoy | medium photo | 0.0 / 0 / 0 | 90.0 / 90 / 90 |
| Beethoven_OdeToJoy | hard photo | failed | 80.0 / 80 / 33.3 |
| JohannSebastianBach_Air | clean render (ceiling) | 74.5 / 74.5 / 68.1 | – |
| JohannSebastianBach_Air | mild photo | 74.5 / 74.5 / 67 | 73.4 / 74.5 / 68.1 |
| JohannSebastianBach_Air | medium photo | 10.6 / 10.6 / 1.1 | 74.5 / 74.5 / 67 |
| JohannSebastianBach_Air | hard photo | failed | 5.3 / 5.3 / 1.1 |
| MuzioClementi_SonatinaOpus36No1_Part1 | clean render (ceiling) | 100.0 / 100 / 100 | – |
| MuzioClementi_SonatinaOpus36No1_Part1 | mild photo | 74.3 / 74.3 / 43.2 | 100.0 / 100 / 100 |
| MuzioClementi_SonatinaOpus36No1_Part1 | medium photo | 100.0 / 100 / 100 | 62.2 / 62.2 / 59.5 |
| MuzioClementi_SonatinaOpus36No1_Part1 | hard photo | failed | 90.5 / 90.5 / 87.8 |
| Schumann_The_Wild_Horseman_Op._68_No._8 | clean render (ceiling) | 88.2 / 88.2 / 86.3 | – |
| Schumann_The_Wild_Horseman_Op._68_No._8 | mild photo | 94.1 / 94.1 / 92.2 | 88.2 / 88.2 / 86.3 |
| Schumann_The_Wild_Horseman_Op._68_No._8 | medium photo | failed | 80.4 / 80.4 / 78.4 |
| Schumann_The_Wild_Horseman_Op._68_No._8 | hard photo | failed | 33.3 / 33.3 / 25.5 |
| frere-jacques | clean render (ceiling) | 100.0 / 100 / 96.9 | – |
| frere-jacques | mild photo | 100.0 / 100 / 100 | 100.0 / 100 / 100 |
| frere-jacques | medium photo | 3.1 / 3.1 / 3.1 | 100.0 / 100 / 100 |
| frere-jacques | hard photo | failed | 53.1 / 53.1 / 28.1 |
| mary | clean render (ceiling) | 100.0 / 100 / 100 | – |
| mary | mild photo | 92.3 / 92.3 / 88.5 | 100.0 / 100 / 100 |
| mary | medium photo | 34.6 / 34.6 / 30.8 | 96.2 / 96.2 / 96.2 |
| mary | hard photo | failed | 53.8 / 53.8 / 38.5 |
| ode-to-joy | clean render (ceiling) | 93.6 / 93.6 / 93.6 | – |
| ode-to-joy | mild photo | 93.6 / 93.6 / 93.6 | 93.6 / 93.6 / 93.6 |
| ode-to-joy | medium photo | 70.2 / 70.2 / 66 | 93.6 / 93.6 / 89.4 |
| ode-to-joy | hard photo | failed | 48.9 / 48.9 / 31.9 |
| twinkle | clean render (ceiling) | 92.9 / 92.9 / 92.9 | – |
| twinkle | mild photo | 90.5 / 90.5 / 90.5 | 92.9 / 92.9 / 92.9 |
| twinkle | medium photo | 50.0 / 50 / 50 | 92.9 / 92.9 / 92.9 |
| twinkle | hard photo | failed | 47.6 / 47.6 / 40.5 |
| **average of all photos** | | **40.2** | **74.7** |


What goes wrong:

- **Dark, blurry, low-resolution photos** (the "hard" set). Notes are lost or misread. Take photos in good light, close enough that the page fills the frame.
- **Multi-staff pages.** Audiveris sometimes splits the parts differently from one line to the next. The melody line then picks up empty bars (Beethoven mild photo: 43%).
- **The retry rule is a guess.** It once kept a worse reading (Twinkle hard photo: the black-and-white version scored 93% alone, but the gray retry was kept, at 48%).
- **Wrong reads look plausible.** Audiveris still drops a bar at the end of a line sometimes. Tempo marks are often misread, so the default of 100 BPM is used. With OCR installed, chord names and lyrics are read, but the title can come out as junk; the scan page replaces a junk title with "Scanned song".

## Licenses (important for a paid app)

| Engine | License | Can it ship inside a closed-source paid app? |
|---|---|---|
| oemer | MIT | Yes, with the copyright notice. Its accuracy is the problem. |
| Audiveris | AGPL-3.0 | Not without releasing your whole app's source under the AGPL, or getting a commercial license from its authors. The AGPL also covers running it on a server for users. Fine as a personal or local tool. |

Options for a product: (1) license Audiveris commercially, (2) use a commercial OMR engine or API (check each one's terms), or (3) start from oemer or another MIT/Apache model and improve it. MusicXML import already works with files that people export from MuseScore or from any scanning app, so scanning can stay optional at first.

## Setup used

- **oemer:** Python 3.12 venv (made with uv), `oemer`, `onnxruntime==1.19.2`, and `opencv-python==4.10.0.84`. Newer onnxruntime refuses oemer's models, and OpenCV 5 breaks its line finder. About 1.5 GB with models. `tools/scan.sh` sets this up on first use.
- **Audiveris:** the official Ubuntu 24.04 `.deb` (5.11.0) unpacked with `dpkg-deb -x`, no install needed. It bundles its own Java runtime. Run with `-batch -export`.
