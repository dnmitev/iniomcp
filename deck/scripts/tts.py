#!/usr/bin/env python3
"""
Generate speech audio from markdown narration files using Kokoro TTS.
Strips markdown formatting and non-spoken content before synthesis.
"""

import re
import sys
from pathlib import Path
import mlx_audio


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


def generate_audio(text: str, output_path: Path, model: str = "mlx-community/Kokoro-82M-bf16", 
                   voice: str = "af_heart", speed: float = 1.0) -> None:
    """Generate audio from text using Kokoro TTS model."""
    
    audio_data = mlx_audio.generate(
        text=text,
        model=model,
        voice=voice,
        lang='a',
        speed=speed
    )
    
    mlx_audio.save(str(output_path), audio_data)


def main():
    if len(sys.argv) != 3:
        print("Usage: tts.py <input.md> <output.wav>", file=sys.stderr)
        sys.exit(1)
    
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    
    if not input_path.exists():
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)
    
    text = input_path.read_text(encoding='utf-8')
    spoken_text = strip_markdown_and_non_spoken(text)
    
    if not spoken_text:
        print(f"Warning: No spoken content in {input_path}", file=sys.stderr)
        sys.exit(1)
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    generate_audio(spoken_text, output_path)
    print(f"Generated: {output_path}")


if __name__ == '__main__':
    main()
