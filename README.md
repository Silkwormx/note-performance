# Note Performance

A small teacher tool that turns a typed song into a kid-friendly **performance video**: colored notes scroll right-to-left across a treble staff toward a neon-blue hit line, with optional chord-duration bars in a lane below the staff, a "READY" count-in, and a real piano sound (melody plus soft chords). A dimmed, softly blurred background image can sit behind a translucent staff panel so the notes stay easy to read.

The scrolling colored-notes idea is inspired by classroom performance videos. The layout is original. The default background is a misty floating-island scene (kept quiet behind the staff); a painted meadow at sundown remains as a fallback.

## Practice player (site root)

Live at **https://silkwormx.github.io/note-performance/**. It works on a phone, a tablet or a computer, and it keeps working offline once it has loaded.

- **Real piano sound.** Notes and chords play through Tone.js with the Salamander Grand Piano samples, which are bundled in `assets/piano/`. Melody notes get a soft 0.9-second release and a little room reverb. Chords are struck softly with a tiny roll and held only for their own length.
- **Tight timing at every speed.** The song clock follows the audio clock, and each note is scheduled about 0.1 s ahead at an exact time, so the notes, the lit piano keys and the sound stay together at 0.25×, 0.5×, 0.75× and 1×.
- **Open song…** loads a MusicXML file (`.musicxml`, `.xml`, or compressed `.mxl`) from MuseScore, Finale, Sibelius, Dorico, Noteflight or a scanning app. You can also drag a file onto the page. `.txt` songs in the format below work too. See [MusicXML import](#musicxml-import).
- **Song picker** with public-domain demos: Twinkle Twinkle, Mary Had a Little Lamb (a compressed `.mxl`), Ode to Joy, and Frère Jacques (which has no chord symbols, so its chords are guessed).
- **Kept from before:** pitch-colored notes on a treble staff, sharps and flats in a deeper shade with a white outline, the neon-blue hit line, the chord lane at the bottom (dark while held, pale otherwise), the C3–C7 piano that lights up, the title slide, and 4-measure practice pages with Prev, Next, Loop this page and Play page.
- **Add to Home Screen.** On iPhone or iPad, open the site in Safari, tap Share, then Add to Home Screen. It opens full screen like an app. A service worker (`sw.js`) caches the app, fonts, piano samples and demo songs.

Run it locally with `./serve.sh` (or `python3 -m http.server 8765`) and open http://localhost:8765. It has to be served over http, not opened as a file, because it uses JavaScript modules and a service worker.

`?song=ode` (or `twinkle`, `mary`, `frere`) opens a specific demo. `songs/index.json` lists the demos. An optional, git-ignored `songs/local.json` adds songs that stay on your own computer.

## MusicXML import

`js/musicxml.js` turns a MusicXML score into the song format:

| MusicXML | What the player does |
|---|---|
| Parts and staves | Uses the first part with notes, the top staff, and the top voice. Stacked chord notes keep the highest note (the melody). |
| Key signature | Sets the key (major or minor, guessed from the last bass note if `<mode>` is missing). Each note's real sharp or flat is kept. |
| Accidentals | Come from each note's `<alter>`. Double sharps and flats are respelled to the nearest simple name. |
| Ties | Tied notes are merged into one longer note. |
| Dots, tuplets | Exact lengths come from `<duration>`, so dotted notes and triplets are exact. |
| Rests, pickup bars | Gaps become rests. A pickup (anacrusis) is padded with a rest so bars and practice pages line up. |
| Tempo | From `<sound tempo>` or a metronome mark (default 100 BPM). |
| Time signature | From the first `<time>`. |
| Chord symbols | From `<harmony>` (C, Dm, G7, Cmaj7, Bdim, Fsus4, N.C. and so on), in any part. |
| No chord symbols | One simple chord per measure is guessed from all the notes (every part and both hands), using the key's common chords (I, IV, V, V7, ii, vi…). The title slide says "Chords (best guess)". |
| Lyrics | The first verse is kept. |
| Transposing instruments | Shown at concert pitch. |

Not yet supported: repeats and endings are played straight through once; tempo, key and time changes use the first value; grace notes are skipped; only the melody is shown (no left hand yet).

The song editor (`editor.html`) can open MusicXML too and shows the converted text. **Download MusicXML** saves any song as MusicXML (`js/musicxml-export.js`), which MuseScore can open.

Tests: `npm test` runs the import tests (round trips of the demo songs, plus ties, dots, triplets, pickups, voices and chords). `tests/fetch-external.sh` downloads nine real-world files from OpenSheetMusicDisplay's test set (Clementi, Joplin, Schumann, Bach, Beethoven and others) for the same tests. `npm run test:browser` runs the Playwright checks for audio, timing, file opening, pages and offline use.

## Scanning sheet music (experiment, local only)

`tools/scan.sh page.png` reads a photo or scan of sheet music into MusicXML. Open the result in the player with **Open song…**. It can use either of two open-source engines, and both run offline:

- **Audiveris** (AGPL-3.0) read 88–100% of the notes correctly on our test pages, in 4–10 seconds per page.
- **oemer** (MIT) was erratic: 3–100% correct, and about 2 minutes per page.

It isn't on the website. Audiveris's license doesn't fit a closed-source paid app, and oemer isn't reliable enough yet. See `tools/SCANNING.md` for the full results and license notes.

## Song format

A song is a plain text file. Header lines come first (all optional), then the notes.

```
title: Twinkle Twinkle Little Star
tempo: 100
key: C
time: 4/4

chords: C:4 | F:2 C:2

C4 q "Twin-" | C4 q "kle," | G4 q "twin-" | G4 q "kle,"
A4 q "lit-"  | A4 q "tle"  | G4 h "star,"
```

Each note is:

```
PITCH   DURATION   "lyric"
```

The lyric is optional. `|` bars are only for readability and do not affect timing. Lines starting with `#` are comments. An optional `lookahead: 5.5` header sets how many beats are visible ahead of the hit line (handy for fast tempos so sixteenth notes don’t bunch up).

### Pitches

Write a letter, an optional sharp or flat, and an octave: `C4`, `G4`, `F#4`, `Bb3`, `C5`. The staff is treble clef; `C4` (middle C) sits on a ledger line below the staff, `E4` is the bottom line, `F5` is the top line.

Notehead colors (and the matching solfège circles) follow the letter name:

| Letter | Color       |
|--------|-------------|
| C      | red         |
| D      | orange      |
| E      | yellow      |
| F      | light green |
| G      | teal        |
| A      | purple      |
| B      | pink        |

Solfège is movable *do* in the key you set (`C` makes `C` = do, `G` makes `G` = do, and so on). Minor keys also treat the tonic as *do*.

### Durations

| Token | Meaning        | Beats in 4/4 |
|-------|----------------|--------------|
| `e`   | eighth         | ½            |
| `q`   | quarter        | 1            |
| `h`   | half           | 2            |
| `w`   | whole          | 4            |
| `s`   | sixteenth      | ¼            |
| `tq`  | triplet quarter | ⅔           |
| `te`  | triplet eighth | ⅓            |
| `th`  | triplet half   | 4/3          |

Add a dot to lengthen by half: `q.` is a dotted quarter (1½ beats), `h.` is a dotted half (3 beats). You can also write a number of beats directly, like `1.5`, or a fraction such as `2/3`. Three `tq` notes fill two beats (a quarter-note triplet).

Sharps and flats (`F#4`, `Bb3`, `Eb5`) take the color of their base letter, and the note label uses ♯ or ♭ (so F♯ stays F-colored, B♭ stays B-colored).

### Rests

Use `r` (or `R` or `rest`) with a duration and no lyric:

```
C4 h. "snow." | r q
E4 e "its" | r e | D4 q "fleece"
```


### Chords

Chords are optional. Add one or more `chords:` lines with a symbol and a length in beats. Multiple `chords:` lines are joined in order. `|` bars are only for readability.

```
chords: C:4 | F:2 C:2
chords: C:4 | G7:2 C:2
```

`C:4` means a C major chord for 4 beats, `G7:2` a G7 for 2 beats. You can also write the length as a duration token (`C:h`, `G7:q`). Common symbols include `C`, `F`, `G7`, `Dm`, `Am`, `Cmaj7`. Color follows the chord root, using the same pitch colors as the notes (C red, F light green, G teal, and so on).

A colored bar for each chord sits in a single horizontal lane below the staff. The bar’s length shows how long that chord is held, and it shrinks toward the neon-blue hit line while the chord is sounding. The sounding chord is darker and more saturated; upcoming chords stay pale. Each chord name keeps its own color. Only the current chord’s pad plays — it starts with that chord and stops when the chord ends, with no leftover ring into the next one. Soft triad (or seventh) tones stay quieter than the melody bells.

You can also drop an inline marker in the note line, which starts a chord at that moment and holds it until the next marker or the end of the song:

```
[C] C4 q "Twin-" | C4 q "kle," | [F] A4 q "lit-" | A4 q "tle" | [C] G4 h "star,"
```

`songs/twinkle.txt` and `songs/mary.txt` both include a `chords:` track.

### A slightly richer example

`songs/mary.txt` uses eighths, a dotted half, a rest, and a chord track:

```
title: Mary Had a Little Lamb
tempo: 110
key: C
time: 4/4

chords: C:8 | G7:4 | C:4
chords: C:8 | G7:4 | C:4

E4 q "Ma-" | D4 q "ry" | C4 q "had" | D4 q "a"
E4 q "lit-" | E4 q "tle" | E4 h "lamb,"
D4 q "lit-" | D4 q "tle" | D4 h "lamb,"
E4 q "lit-" | G4 q "tle" | G4 h "lamb."
E4 q "Ma-" | D4 q "ry" | C4 q "had" | D4 q "a"
E4 q "lit-" | E4 q "tle" | E4 q "lamb," | E4 e "its" | r e
D4 q "fleece" | D4 q "was" | E4 q "white" | D4 q "as"
C4 h. "snow." | r q
```

Type the same format into the text box on the page, or save a `.txt` file and pass it to the renderer.

## Export a video

```bash
./render.sh songs/twinkle.txt demo.mp4
```

That writes a 1280×720, 30 fps MP4 with the real piano sound (the same samples and rules as the live player, rendered offline in `js/pianowav.js`). `--sound bell` brings back the old synthesized bells. You can also set size and frame rate:

```bash
./render.sh songs/mary.txt mary.mp4 --width 1920 --height 1080 --fps 30
./render.sh songs/ode.txt ode.mp4 --title-slide --scale 2
```

`--speed` slows both the picture and the audio (0.25, 0.5, 0.75, and 1 are typical). `--title-slide` adds a 5.5-second opening card with the song title, the chords, and the notes. `--speeds 0.5,0.75,1` plays the whole song at each speed, with a short card before Medium and Full Speed. A label such as Slow, Medium, or Full Speed is drawn in the corner; `--label` overrides the default name for a single-speed render.

`render.sh` uses Playwright (system Chrome) to draw each frame and ffmpeg to mux them with a generated WAV. The first run will `npm install` Playwright if needed (it does not download a second browser).

A demo render lives at `demo.mp4`. `demo_poster.png` is a still from that video, and `demo_strip.jpg` is a contact sheet of key frames.

## Project layout

```
index.html            practice player (site root)
editor.html           song editor / video preview
manifest.webmanifest  home-screen app settings
sw.js                 offline cache (regenerate with: node tools/build-sw.mjs)
css/  js/             styles and engine
js/piano.js           live piano (Tone.js Sampler + Salamander samples)
js/pianowav.js        the same piano, rendered offline for MP4 export
js/musicxml.js        MusicXML / .mxl import
js/musicxml-export.js MusicXML export
js/vendor/            Tone.js and JSZip (MIT), bundled for offline use
assets/piano/         Salamander Grand Piano samples, A1–C8 (CC-BY 3.0)
songs/                public-domain demo songs (.txt) and songs/demo/ (MusicXML)
fonts/                Fredoka, Nunito, and Noto Music (SIL Open Font License)
tools/                scan.sh (OMR experiment), build-sw.mjs, compare-songs.mjs, demo builders
tests/                import tests and Playwright browser checks
render.sh, render.mjs Playwright + ffmpeg video export
```

## What's still rough

- Melody only. Imported scores show the top line of the right hand. Two-hand (grand staff) display is the next step.
- Repeats are not expanded, and tempo, key and time changes use the first value.
- Eighth-note flags are simple; notes are not beamed. No key signature is drawn on the staff.
- The in-page player does not export a video by itself; use `render.sh`.

## Credits and licenses

See `THIRD_PARTY_NOTICES.md`. In short: Tone.js (MIT), JSZip (MIT, chosen from its MIT/GPLv3 dual license), Salamander Grand Piano samples by Alexander Holm (CC-BY 3.0, credit shown in the player), and the fonts (SIL OFL). The demo melodies are public domain, and our encodings of them are CC0. The repo contains only public-domain or original songs.
