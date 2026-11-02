#!/usr/bin/env python3
"""
Unit tests for tts.py markdown stripping logic.
Full integration tests require Apple Silicon with mlx-audio installed.
"""

import re


def strip_markdown_and_non_spoken(text: str) -> str:
    """Copy of the function from tts.py for testing."""
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


def test_strip_markdown():
    """Test markdown and non-spoken content removal."""
    
    # Test YAML front matter removal
    text = """---
title: Test
---
Hello world"""
    assert strip_markdown_and_non_spoken(text) == "Hello world"
    
    # Test HTML comments (full line removal)
    text = """<!-- comment -->
Real text
<!-- more -->"""
    assert strip_markdown_and_non_spoken(text) == "Real text"
    
    # Test stage directions
    text = """Slide: 1
Notes: internal
Real spoken text
Action: pause"""
    assert strip_markdown_and_non_spoken(text) == "Real spoken text"
    
    # Test markdown formatting
    text = "## Heading\nThis is **bold** and *italic* text with `code`."
    assert strip_markdown_and_non_spoken(text) == "Heading This is bold and italic text with code."
    
    # Test links
    text = "Click [here](http://example.com) for more."
    assert strip_markdown_and_non_spoken(text) == "Click here for more."
    
    # Test list bullets
    text = "- Item one\n* Item two"
    assert strip_markdown_and_non_spoken(text) == "Item one Item two"
    
    # Test bracketed stage directions (entire line removed)
    text = """Hello world
[pause]
More text"""
    result = strip_markdown_and_non_spoken(text)
    assert result == "Hello world More text"
    
    print("✓ All markdown stripping tests passed")


if __name__ == '__main__':
    test_strip_markdown()
    print("\n✓ All tests passed!")
    print("Note: Full integration tests require Apple Silicon with mlx-audio==0.6.3, soundfile, and misaki[en]")
