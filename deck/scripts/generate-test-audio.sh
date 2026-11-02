#!/bin/bash
# Generate placeholder WAV files with different durations and frequencies for testing

set -e

AUDIO_DIR="audio"
mkdir -p "$AUDIO_DIR"

# Different durations (seconds) for each slide
DURATIONS=(2.0 7.0 4.3 3.5 5.2 2.8 6.1 4.0 3.3 5.5 2.5)
# Different frequencies (Hz) for each slide to make them distinguishable
FREQS=(440 523 587 659 698 784 880 987 1047 1175 1319)

SLIDES=(
  "01-the-problem"
  "02-who-benefits"
  "03-simple-setup"
  "04-privacy-automatic"
  "05-ask-in-plain-language"
  "06-safe-defaults"
  "07-built-for-trust"
  "08-whats-next"
  "09-current-limits"
  "10-risks-and-mitigations"
  "11-asks"
)

echo "=== Generating placeholder audio files ==="

for i in "${!SLIDES[@]}"; do
  idx=$(printf "%02d" $((i + 1)))
  slug="${SLIDES[$i]}"
  duration="${DURATIONS[$i]}"
  freq="${FREQS[$i]}"
  outfile="$AUDIO_DIR/${idx}-${slug}.wav"
  
  echo "Generating ${idx}-${slug}.wav: ${duration}s @ ${freq}Hz"
  
  # Generate sine wave tone with ffmpeg
  ffmpeg -f lavfi -i "sine=frequency=${freq}:duration=${duration}" \
    -ar 24000 -ac 1 -y "$outfile" \
    -hide_banner -loglevel error
  
  # Verify the duration
  actual_duration=$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$outfile")
  echo "  Created: ${outfile} (actual: ${actual_duration}s)"
done

echo ""
echo "=== Audio files generated ==="
ls -lh "$AUDIO_DIR"/*.wav
