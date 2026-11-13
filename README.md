# Note Performance

A small teacher tool that turns a typed song into a kid-friendly **performance video**: colored notes scroll right-to-left across a treble staff toward a neon-blue hit line, with optional chord-duration bars in a lane below the staff, a "READY" count-in, and bell-like tones over a soft chord pad. A dimmed, softly blurred background image can sit behind a translucent staff panel so the notes stay easy to read.

The scrolling colored-notes idea is inspired by classroom performance videos. The layout is original. The default background is a misty floating-island scene (kept quiet behind the staff); a painted meadow at sundown remains as a fallback.

## Preview in the browser

From this folder:

```bash
./serve.sh
```

The site root (`index.html`) opens the **Mario practice player**. The song editor is at [editor.html](editor.html). All asset paths are relative, so the same files work on GitHub Pages.

Or run `python3 -m http.server 8765` and open [http://localhost:8765](http://localhost:8765). The page must be served over `http` (not opened as a file), because it uses JavaScript modules.

## Mario practice player

This is a phone- and browser-friendly player for the Super Mario Bros. Main Theme arrangement. Open the site root, or [mario_player.html](mario_player.html).

- Plays the song once at 1× by default, with 0.25× / 0.5× / 0.75× / 1× buttons in the bottom bar. Changing speed keeps the audio in sync with the notes.
- A piano keyboard along the bottom lights each key in that note's pitch color when it sounds. Sharps and flats use a deeper shade of the same color, a double or dashed white outline, and a ♯ or ♭ in the label (on the staff and on the black keys).
- Practice page by page (about four measures per page) with Prev, Next, Loop this page, and Play page. The label shows "Page X of N".
- The title slide, sky background, neon hit line, and chord lane (dark while a chord is held, pale otherwise) match the exported video.

The Mario arrangement is for **home or personal practice only**.

To export a single-pass 1× MP4 with the title slide, keyboard, and crisp letters (rendered at 2× and scaled down):

```bash
./render.sh songs/mario.txt mario.mp4 --title-slide --scale 2
```


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

That writes a 1280×720, 30 fps MP4 with the bell audio mixed in. You can also set size and frame rate:

```bash
./render.sh songs/mary.txt mary.mp4 --width 1920 --height 1080 --fps 30
./render.sh songs/mario.txt mario.mp4 --title-slide --scale 2
```

`--speed` slows both the picture and the audio (0.25, 0.5, 0.75, and 1 are typical). `--title-slide` adds a 5.5-second opening card with the song title, the chords, and the notes. `--speeds 0.5,0.75,1` plays the whole song at each speed, with a short card before Medium and Full Speed. A label such as Slow, Medium, or Full Speed is drawn in the corner; `--label` overrides the default name for a single-speed render.

`render.sh` uses Playwright (system Chrome) to draw each frame and ffmpeg to mux them with a generated WAV. The first run will `npm install` Playwright if needed (it does not download a second browser).

A demo render lives at `demo.mp4`. `demo_poster.png` is a still from that video, and `demo_strip.jpg` is a contact sheet of key frames.

## Project layout

```
index.html          Mario practice player (site root)
mario_player.html   same player (alias)
editor.html         song editor / video preview
css/  js/           page styles and engine
songs/              public-domain demo songs
fonts/              Fredoka, Nunito, and Noto Music (SIL Open Font License)
assets/             background image (island-bg.jpg) and the style reference
render.sh           export entry point
render.mjs          Playwright + ffmpeg renderer
```

## What's still rough

- No ties, and lyrics cannot yet span a tied note. Chords are a separate track (or inline markers), not stacked melody notes.
- Eighth-note flags are simple; notes are not beamed.
- Only a treble staff, and no key signature is drawn on the staff (the key still drives solfège).
- The in-page player does not export a video by itself; use `render.sh`.
- Count-in length follows the top number of the time signature (4 beats in 4/4). Pickup measures are just leading rests.

The demo tunes are public domain. Fredoka and Nunito are licensed under the SIL Open Font License.
