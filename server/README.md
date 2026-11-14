# Scan backend (photo → MusicXML)

This is the small server behind **Scan sheet music** (`scan.html`). It takes a phone
photo, several photos, or a PDF and:

1. **Cleans up the picture** (`preprocess.py`, OpenCV). It finds the page and undoes
   the camera angle, removes shadows and uneven light, paints the table white,
   straightens the staff lines, gently unbends a curled page, and scales the
   page so staff lines are about 20 px apart.
2. **Reads the music with [Audiveris](https://github.com/Audiveris/audiveris) 5.11**,
   which runs as a separate program, together with English OCR data so chord names
   and lyrics are read too.
3. **Returns** the MusicXML, the cleaned picture, Audiveris's own view of the page,
   and how sure Audiveris was about each bar (`omrinfo.py` reads its `.omr` file).
   The scan page uses those to show orange flags in **Fix the notes**.

GitHub Pages only hosts static files, so this part has to run on a computer
(or a small server) that you control.

## Start it

```bash
server/start.sh          # first run installs everything into ~/.cache/note-performance
server/start.sh status   # show the current link
server/start.sh stop
```

`install.sh` (run by `start.sh`) sets up a Python venv (FastAPI, OpenCV), Audiveris
(the Ubuntu .deb, unpacked; it brings its own Java), the Tesseract `eng.traineddata`
file, and `cloudflared`. It needs Linux x86-64. On a Mac or Windows PC, use Docker
(below).

The first start writes an access key into `server/.env`. That file is git-ignored;
never commit it. Every request needs the key: open the printed link once (it ends
in `?key=…`). The server then remembers it with a cookie, and the scan page
remembers it in local storage.

### Getting to it from a phone

`start.sh` opens a free **Cloudflare quick tunnel**. That needs no account and gives a
`https://<random>.trycloudflare.com` address, printed as the phone link. The address
changes every time it starts, so open the new link after each restart. Quick tunnels
need outgoing port 7844 (QUIC or HTTP/2). Some networks block that, including the
sandbox this was built in. When that happens, the script keeps the backend running
on `http://127.0.0.1:8840` and says so.

Set `SCAN_TUNNEL=none` to skip the tunnel. To use it on home Wi-Fi without a
tunnel, run `SCAN_HOST=0.0.0.0 SCAN_TUNNEL=none server/start.sh` and open
`http://<computer-ip>:8840/scan.html?key=…` on the phone. Without https, the
offline cache stays off for that address, but scanning still works. Set
`SCAN_PORT` to use a different port.

The scan page on GitHub Pages can also talk to a backend somewhere else. Open
`https://silkwormx.github.io/note-performance/scan.html?api=https://YOUR-BACKEND&key=YOUR-KEY`
once, or type both under **Scanner connection**. CORS allows `silkwormx.github.io`.

## Docker

```bash
docker build -f server/Dockerfile -t note-scan .
docker run --rm -p 8840:8840 -e SCAN_KEY=pick-a-long-key note-scan
# then: http://localhost:8840/scan.html?key=pick-a-long-key
```

Use `--platform linux/amd64` on Apple Silicon, because the Audiveris .deb is x86-64.
Reading one page needs about 1–1.5 GB of RAM, so give the container 2 GB.

## Accuracy

`testing/make_test_photos.py` renders public-domain scores and fakes phone photos of
them: tilt, perspective, shadows, page curl, blur, noise and JPEG. `testing/eval_scans.py`
scores the photos with and without cleanup. See `tools/SCANNING.md` for the numbers.
The test photos aren't in the repo; the scripts regenerate them.

## License: keep this separate

Audiveris is **AGPL-3.0**. Running it for yourself is fine. Anyone who offers it
to other people as a network service has to offer them the source of that
service, too. So:

- Keep this backend a **separate program**, talking to the app only over HTTP with
  MusicXML. It's in its own folder with its own process and no shared code.
- A future **paid or closed-source app** should not bundle it or run it for
  customers unless it's released under the AGPL (or under a commercial license
  from the Audiveris authors). Use a differently licensed engine instead (for
  example, oemer is MIT) or have users run their own scanner.
- The practice player, the scan page and the editor don't contain Audiveris code.

Other parts: FastAPI and uvicorn (MIT/BSD), OpenCV (Apache-2.0), NumPy (BSD),
Pillow (MIT-CMU), Tesseract `eng.traineddata` (Apache-2.0), cloudflared (Apache-2.0).
