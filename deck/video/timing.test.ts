import { describe, it, expect } from 'vitest';
import { calculateSlideTimings, calculateOpacity } from './timing';

describe('calculateSlideTimings', () => {
  it('calculates timings for single slide with no crossfade', () => {
    const slides = [{ audioDurationSeconds: 5.0, paddingSeconds: 0.5 }];
    const result = calculateSlideTimings(slides, 30, 12);

    expect(result.slideTimings).toHaveLength(1);
    expect(result.slideTimings[0]).toEqual({
      startFrame: 0,
      durationFrames: 165, // Math.ceil(5.5 * 30)
    });
    expect(result.totalDurationFrames).toBe(165);
  });

  it('calculates timings for multiple slides with crossfade overlap', () => {
    const slides = [
      { audioDurationSeconds: 3.0, paddingSeconds: 0.5 },
      { audioDurationSeconds: 4.0, paddingSeconds: 0.5 },
      { audioDurationSeconds: 2.5, paddingSeconds: 0.5 },
    ];
    const crossfadeFrames = 12; // 0.4s at 30fps
    const result = calculateSlideTimings(slides, 30, crossfadeFrames);

    expect(result.slideTimings).toHaveLength(3);

    // Slide 0: starts at 0, duration = ceil(3.5 * 30) = 105
    expect(result.slideTimings[0]).toEqual({
      startFrame: 0,
      durationFrames: 105,
    });

    // Slide 1: starts at 105 - 12 = 93, duration = ceil(4.5 * 30) = 135
    expect(result.slideTimings[1]).toEqual({
      startFrame: 93,
      durationFrames: 135,
    });

    // Slide 2: starts at 93 + 135 - 12 = 216, duration = ceil(3.0 * 30) = 90
    expect(result.slideTimings[2]).toEqual({
      startFrame: 216,
      durationFrames: 90,
    });

    // Total: 216 + 90 = 306 frames (no overlap after last slide)
    expect(result.totalDurationFrames).toBe(306);
  });

  it('handles varying durations correctly', () => {
    const slides = [
      { audioDurationSeconds: 2.0, paddingSeconds: 0.5 },
      { audioDurationSeconds: 7.0, paddingSeconds: 0.5 },
      { audioDurationSeconds: 4.3, paddingSeconds: 0.5 },
    ];
    const result = calculateSlideTimings(slides, 30, 12);

    // Slide 0: ceil(2.5 * 30) = 75
    expect(result.slideTimings[0].durationFrames).toBe(75);
    // Slide 1: ceil(7.5 * 30) = 225
    expect(result.slideTimings[1].durationFrames).toBe(225);
    // Slide 2: ceil(4.8 * 30) = 144
    expect(result.slideTimings[2].durationFrames).toBe(144);

    // Total: 75 + 225 + 144 - 2*12 = 420
    expect(result.totalDurationFrames).toBe(420);
  });
});

describe('calculateOpacity', () => {
  it('returns 1.0 for first slide', () => {
    expect(calculateOpacity(0, 100, 12, true)).toBe(1.0);
    expect(calculateOpacity(50, 100, 12, true)).toBe(1.0);
  });

  it('fades in during crossfade period', () => {
    const crossfadeFrames = 12;
    expect(calculateOpacity(0, 100, crossfadeFrames, false)).toBe(0);
    expect(calculateOpacity(6, 100, crossfadeFrames, false)).toBe(0.5);
    expect(calculateOpacity(12, 100, crossfadeFrames, false)).toBe(1.0);
  });

  it('stays at full opacity after fade-in', () => {
    expect(calculateOpacity(15, 100, 12, false)).toBe(1.0);
    expect(calculateOpacity(99, 100, 12, false)).toBe(1.0);
  });
});
