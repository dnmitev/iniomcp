#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DECK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$DECK_DIR/.venv"
NARRATION_DIR="$DECK_DIR/narration"
AUDIO_DIR="$DECK_DIR/audio"
TTS_SCRIPT="$SCRIPT_DIR/tts.py"
REQUIREMENTS="$SCRIPT_DIR/requirements-tts.txt"

# Check for uv
if ! command -v uv &> /dev/null; then
    echo "Error: uv is not installed. Install it with:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo "Then restart your shell or run: source ~/.local/bin/env"
    exit 1
fi

echo "==> Setting up Python 3.12 virtual environment with uv..."

# Check if existing venv is Python 3.12
if [ -d "$VENV_DIR" ]; then
    VENV_PYTHON_VERSION=$("$VENV_DIR/bin/python" --version 2>&1 | awk '{print $2}' | cut -d. -f1,2)
    if [ "$VENV_PYTHON_VERSION" != "3.12" ]; then
        echo "Existing venv is Python $VENV_PYTHON_VERSION, recreating with Python 3.12..."
        rm -rf "$VENV_DIR"
    fi
fi

# Create venv with Python 3.12 if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    uv venv --python 3.12 "$VENV_DIR"
    echo "Created Python 3.12 virtual environment at $VENV_DIR"
fi

echo "==> Installing dependencies with uv..."
LOCK_FILE="$SCRIPT_DIR/requirements-tts.lock"
uv pip install --python "$VENV_DIR" -r "$LOCK_FILE"

echo "==> Checking for stale audio files..."
mkdir -p "$AUDIO_DIR"

# Collect all stale (narration, audio) pairs
stale_pairs=()
skipped_count=0

for narration_file in "$NARRATION_DIR"/*.md; do
    basename=$(basename "$narration_file" .md)
    audio_file="$AUDIO_DIR/${basename}.wav"
    
    if [ -f "$audio_file" ] && [ "$audio_file" -nt "$narration_file" ]; then
        skipped_count=$((skipped_count + 1))
    else
        stale_pairs+=("$narration_file" "$audio_file")
    fi
done

# Generate audio for all stale files in one model load
if [ ${#stale_pairs[@]} -gt 0 ]; then
    echo "==> Generating ${#stale_pairs[@]} audio files (model loads once)..."
    "$VENV_DIR/bin/python" "$TTS_SCRIPT" "${stale_pairs[@]}"
    generated_count=$((${#stale_pairs[@]} / 2))
else
    generated_count=0
fi

echo "==> Complete: generated $generated_count, skipped $skipped_count (already up-to-date)"
