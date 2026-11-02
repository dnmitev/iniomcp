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

Each slide has corresponding narration text in `deck/narration/NN-slug.md`. These files are:
- **Not used** by the current slide deck app
- **Reserved** for future text-to-speech and video generation
- **Not editable** as part of this deliverable (source of truth)

The narration files are referenced in the slide registry for easy pairing during video composition with tools like Remotion.

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
