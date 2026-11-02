/**
 * Pure timing calculation functions for video composition
 */

export interface SlideTimingInput {
  audioDurationSeconds: number;
  paddingSeconds: number;
}

export interface SlideTiming {
  startFrame: number;
  durationFrames: number;
}

export interface TimingCalculation {
  slideTimings: SlideTiming[];
  totalDurationFrames: number;
}

/**
 * Calculate slide timings with crossfade overlap
 *
 * @param slides - Array of slide audio durations with padding
 * @param fps - Frames per second
 * @param crossfadeFrames - Number of frames for crossfade overlap
 * @returns Timing calculation with per-slide timings and total duration
 */
export function calculateSlideTimings(
  slides: SlideTimingInput[],
  fps: number,
  crossfadeFrames: number,
): TimingCalculation {
  const slideTimings: SlideTiming[] = [];
  let currentFrame = 0;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const totalSeconds = slide.audioDurationSeconds + slide.paddingSeconds;
    const durationFrames = Math.ceil(totalSeconds * fps);

    slideTimings.push({
      startFrame: currentFrame,
      durationFrames,
    });

    // Subsequent slides overlap by crossfadeFrames
    const overlap = i < slides.length - 1 ? crossfadeFrames : 0;
    currentFrame += durationFrames - overlap;
  }

  return {
    slideTimings,
    totalDurationFrames: currentFrame,
  };
}

/**
 * Calculate opacity for crossfade effect
 *
 * @param frame - Current frame within the sequence
 * @param durationFrames - Total duration of the sequence
 * @param crossfadeFrames - Number of frames for crossfade
 * @param isFirstSlide - Whether this is the first slide (no fade-in)
 * @returns Opacity value between 0 and 1
 */
export function calculateOpacity(
  frame: number,
  durationFrames: number,
  crossfadeFrames: number,
  isFirstSlide: boolean,
): number {
  if (isFirstSlide) {
    return 1.0;
  }

  // Fade in during first crossfadeFrames
  if (frame < crossfadeFrames) {
    return frame / crossfadeFrames;
  }

  return 1.0;
}
