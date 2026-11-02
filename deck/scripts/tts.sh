#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DECK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$DECK_DIR/.venv"
NARRATION_DIR="$DECK_DIR/narration"
AUDIO_DIR="$DECK_DIR/audio"
TTS_SCRIPT="$SCRIPT_DIR/tts.py"

echo "==> Setting up Python virtual environment..."
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
    echo "Created virtual environment at $VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

echo "==> Installing dependencies..."
pip install --quiet --upgrade pip
pip install --quiet mlx-audio soundfile

echo "==> Generating audio files..."
mkdir -p "$AUDIO_DIR"

generated_count=0
skipped_count=0

for narration_file in "$NARRATION_DIR"/*.md; do
    basename=$(basename "$narration_file" .md)
    audio_file="$AUDIO_DIR/${basename}.wav"
    
    if [ -f "$audio_file" ] && [ "$audio_file" -nt "$narration_file" ]; then
        skipped_count=$((skipped_count + 1))
        continue
    fi
    
    python3 "$TTS_SCRIPT" "$narration_file" "$audio_file"
    generated_count=$((generated_count + 1))
done

echo "==> Complete: generated $generated_count, skipped $skipped_count (already up-to-date)"
