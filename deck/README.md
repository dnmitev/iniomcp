# Inio MCP Business Deck

A React + TypeScript slide deck presenting the inio-mcp business story.

## Overview

This is a self-contained presentation app built with Vite, React, and TypeScript. The deck consists of 11 slides covering the problem, benefits, setup, privacy, functionality, trust, roadmap, limitations, risks, and asks related to the inio-mcp project.

## Installation

```bash
npm ci
```

## Development

Run the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

## Build

Build the production version:

```bash
npm run build
```

The built app will be in the `dist/` directory.

Preview the built app:

```bash
npm run preview
```

## Screenshots

Generate screenshots of all slides:

```bash
npm run screenshots
```

This runs Playwright tests that verify each slide renders correctly and saves PNG screenshots to the `artifacts/` directory.

## Keyboard Controls

- **Left Arrow / Page Up**: Previous slide
- **Right Arrow / Page Down / Space**: Next slide
- **Home**: Go to first slide
- **End**: Go to last slide

## URL Navigation

Each slide can be accessed directly via URL hash:
- `#01` - The Problem
- `#02` - Who Benefits
- `#03` - Simple Setup
- `#04` - Privacy Automatic
- `#05` - Ask in Plain Language
- `#06` - Safe Defaults
- `#07` - Built for Trust
- `#08` - What's Next
- `#09` - Current Limits
- `#10` - Risks and Mitigations
- `#11` - Asks

## Architecture

### Slide Components

Each slide is a pure React component located in `src/slides/NN-slug.tsx`:
- Receives content via props
- No global state or side effects
- Uses shared `SlideLayout` component for consistent styling

### Content Data

All slide content lives in `src/content.ts` as structured data, separate from the layout components. This makes it easy to:
- Update content without touching components
- Reuse content in other contexts (e.g., video generation)
- Validate content against source material

### Slide Registry

The `src/slideRegistry.ts` file maintains a mapping of:
- Slide ID and slug
- Component reference
- Narration file path (for future TTS/video work)

This registry makes it easy to pair slides with their narration for video composition.

## Narration

Each slide has corresponding narration text in `deck/narration/NN-slug.md`. These are the per-slide narration scripts that `deck/scripts/tts.sh` turns into `deck/audio/*.wav` for the video composition. The narration files are referenced in the slide registry for pairing with slide components during video rendering.

## Video Generation

Generate a narrated video of the slide deck with synchronized audio and crossfade transitions.

### Prerequisites

- **Apple Silicon Mac** (required for mlx-audio TTS)
- **Python 3.10+** with venv support
- **Node.js** with npm
- **ffmpeg** (for video verification)

### Generate Audio

Run the TTS script to create audio files from narration:

```bash
deck/scripts/tts.sh
```

This creates `deck/audio/NN-slug.wav` for each narration file in `deck/narration/`. The script:
- Sets up a Python virtual environment at `deck/.venv`
- Installs `mlx-audio` and dependencies
- Uses the Kokoro TTS model (mlx-community/Kokoro-82M-bf16)
- Strips markdown formatting and non-spoken content
- Skips audio files that are already up-to-date

The script is idempotent: re-running it only regenerates audio for changed narration files.

### Preview Video

Open the Remotion studio to preview the video composition:

```bash
npm --prefix deck run video:studio
```

### Render Video

Render the final video:

```bash
npm --prefix deck run video:render
```

Output: `deck/out/inio-mcp-deck.mp4`

The video composition:
- **Resolution**: 1920x1080
- **Frame rate**: 30 fps
- **Duration**: Calculated from audio files (each slide = audio duration + 0.5s padding)
- **Transitions**: 0.4s crossfades between slides
- **Audio**: Synchronized per-slide narration

### Video Architecture

- `deck/video/Root.tsx`: Remotion composition with dynamic metadata calculation
- `deck/video/DeckVideo.tsx`: Main video component rendering slides with audio
- `deck/video/calculateMetadata.ts`: Calculates video duration from audio files at render time
- `deck/remotion.config.ts`: Remotion configuration
- `deck/scripts/tts.sh`: TTS generation script
- `deck/scripts/tts.py`: Python TTS implementation

Audio files are not committed to the repository. Generated video output is also excluded.

## Technical Details

- **Canvas**: Fixed 1920x1080 slide dimensions
- **Scaling**: Automatically scaled to fit viewport at 16:9 aspect ratio (letterboxed)
- **Fonts**: System fonts only, no external CDN dependencies
- **Runtime**: No network calls, analytics, or trackers
- **Source of Truth**: All content extracted from `deck/story.md` (verified against commit ff4aee7)

## Content Rules

- All text is extracted from the approved `deck/story.md`
- No numbers, claims, or facts were invented or added
- English only
- Content is prop-driven and pure (no side effects in components)
