# Third-party notices

| Component | Where | License | Notes |
|---|---|---|---|
| Tone.js 15.1.22 | `js/vendor/tone.js` | MIT | https://github.com/Tonejs/Tone.js. License text in `js/vendor/tone.LICENSE.md`. |
| JSZip 3.10.2 | `js/vendor/jszip.min.js` | MIT (dual MIT / GPL-3.0; used under MIT) | https://github.com/Stuk/jszip. License text in `js/vendor/jszip.LICENSE.md`. |
| Salamander Grand Piano | `assets/piano/*.mp3` | CC-BY 3.0 | By Alexander Holm. Copies from https://tonejs.github.io/audio/salamander/ (Tone.js audio repo), trimmed to 10 s with a fade-out and re-encoded to 96 kbps MP3. Credit is shown in the player. |
| Fredoka, Nunito, Noto Music | `fonts/` | SIL Open Font License 1.1 | See `fonts/README.txt`. |
| @xmldom/xmldom | dev only (tests) | MIT | Not shipped to the browser. |
| Playwright | dev only (video export, tests) | Apache-2.0 | Not shipped to the browser. |

Demo songs (`songs/*.txt`, `songs/demo/*`): public-domain melodies (traditional, or Beethoven), encoded by this project and released under CC0 1.0.

CC-BY 3.0 attribution: "Salamander Grand Piano" by Alexander Holm, https://creativecommons.org/licenses/by/3.0/. Changes: trimmed, faded and re-encoded.

## Scan backend (`server/`, runs as its own program, not part of the web app)

| Component | License | Notes |
|---|---|---|
| Audiveris 5.11 | AGPL-3.0 | Downloaded by `server/install.sh` / the Dockerfile and run as a separate process. Not bundled in the repo or the web app. See `server/README.md` for why it stays separate from any paid app. |
| Tesseract `eng.traineddata` | Apache-2.0 | OCR data so Audiveris reads chord names and lyrics. Downloaded at install. |
| FastAPI, uvicorn, python-multipart | MIT / BSD-3-Clause / Apache-2.0 | |
| OpenCV (opencv-python-headless), NumPy, Pillow | Apache-2.0 / BSD-3-Clause / MIT-CMU | |
| cloudflared | Apache-2.0 | Free quick tunnel to reach the backend from a phone. |

## Scanning tools (local only)

| Tool | License | Notes for a paid app |
|---|---|---|
| oemer 0.1.8 | MIT | OK to bundle in a closed-source paid app (keep the notice). Its ONNX models come with the package. |
| Audiveris 5.x | AGPL-3.0 | Bundling or linking it in a closed-source app (or running it as a network service for users) would require releasing your app's source under the AGPL. Only an arm's-length setup, or a commercial license from the authors, avoids that. |
| Verovio | LGPL-3.0 | Used only to draw clean test images of the demo songs. |
