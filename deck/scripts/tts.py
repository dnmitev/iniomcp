#!/usr/bin/env python3
"""
Generate speech audio from markdown narration files using Kokoro TTS.
Strips markdown formatting and non-spoken content before synthesis.
"""

import re
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model


def strip_markdown_and_non_spoken(text: str) -> str:
    """
    Remove markdown formatting and non-spoken content.
    
    Non-spoken patterns:
    - HTML comments (<!-- ... -->)
    - YAML front matter (--- ... ---)
    - Stage direction lines (e.g., "Slide:", "Notes:", "[pause]")
    - Markdown formatting: headings (#), emphasis (*, _), code ticks (`), list bullets (-, *)
    - Links: convert [text](url) to just text
    """
    lines = text.split('\n')
    spoken_lines = []
    in_frontmatter = False
    
    for line in lines:
        stripped = line.strip()
        
        if stripped == '---':
            in_frontmatter = not in_frontmatter
            continue
        
        if in_frontmatter:
            continue
        
        if not stripped:
            continue
        
        if '<!--' in stripped or '-->' in stripped:
            continue
        
        if re.match(r'^(Slide|Notes|Stage|Action|Visual):', stripped, re.IGNORECASE):
            continue
        
        if re.match(r'^\[.*\]$', stripped):
            continue
        
        cleaned = stripped
        cleaned = re.sub(r'^#+\s*', '', cleaned)
        cleaned = re.sub(r'\*\*([^*]+)\*\*', r'\1', cleaned)
        cleaned = re.sub(r'\*([^*]+)\*', r'\1', cleaned)
        cleaned = re.sub(r'__([^_]+)__', r'\1', cleaned)
        cleaned = re.sub(r'_([^_]+)_', r'\1', cleaned)
        cleaned = re.sub(r'`([^`]+)`', r'\1', cleaned)
        cleaned = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', cleaned)
        cleaned = re.sub(r'^[-*]\s+', '', cleaned)
        
        cleaned = cleaned.strip()
        if cleaned:
            spoken_lines.append(cleaned)
    
    return ' '.join(spoken_lines)


def generate_audio_with_model(text: str, output_path: Path, model, 
                               voice: str = "af_heart", speed: float = 1.0) -> None:
    """Generate audio from text using a loaded Kokoro model."""
    
    audio_chunks = []
    for result in model.generate(text=text, voice=voice, speed=speed, lang_code='a'):
        if result.audio is not None:
            audio_chunks.append(np.array(result.audio))
    
    if not audio_chunks:
        raise ValueError(f"No audio generated for text: {text[:50]}...")
    
    audio = np.concatenate(audio_chunks, axis=0) if len(audio_chunks) > 1 else audio_chunks[0]
    
    sf.write(str(output_path), audio, model.sample_rate)


def main():
    if len(sys.argv) < 3 or len(sys.argv) % 2 != 1:
        print("Usage: tts.py <input1.md> <output1.wav> [<input2.md> <output2.wav> ...]", file=sys.stderr)
        sys.exit(1)
    
    # Parse input/output pairs
    file_pairs = []
    for i in range(1, len(sys.argv), 2):
        input_path = Path(sys.argv[i])
        output_path = Path(sys.argv[i + 1])
        
        if not input_path.exists():
            print(f"Error: {input_path} not found", file=sys.stderr)
            sys.exit(1)
        
        file_pairs.append((input_path, output_path))
    
    # Load model once for all files
    model = load_model("mlx-community/Kokoro-82M-bf16")
    
    # Process each file
    for input_path, output_path in file_pairs:
        text = input_path.read_text(encoding='utf-8')
        spoken_text = strip_markdown_and_non_spoken(text)
        
        if not spoken_text:
            print(f"Warning: No spoken content in {input_path}", file=sys.stderr)
            continue
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        generate_audio_with_model(spoken_text, output_path, model, voice="af_heart", speed=1.0)
        print(f"Generated: {output_path}")


if __name__ == '__main__':
    main()
