#!/usr/bin/env bash
# Downloads a few real-world MusicXML files from OpenSheetMusicDisplay's test data
# (public-domain pieces; kept out of the repo) to tests/external/ for the import tests.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p external
for f in Beethoven_OdeToJoy.musicxml MuzioClementi_SonatinaOpus36No1_Part1.xml OSMD_function_test_chord_symbols.musicxml \
  Schumann_The_Wild_Horseman_Op._68_No._8.mxl Saltarello.mxl OSMD_function_test_accidentals.musicxml \
  ScottJoplin_The_Entertainer.xml HelloWorld.xml JohannSebastianBach_Air.xml; do
  curl -sfL -o "external/$f" "https://raw.githubusercontent.com/opensheetmusicdisplay/opensheetmusicdisplay/develop/test/data/$f"
done
ls external
