import { Composition } from 'remotion';
import { DeckVideo, DeckVideoProps } from './DeckVideo';
import { slideRegistry } from '../src/slideRegistry';
import { calculateSlideTimings } from './timing';
import { audioDurations } from './audioDurations';

export const Root: React.FC = () => {
  const fps = 30;
  const paddingSeconds = 0.5;
  const crossfadeSeconds = 0.4;
  const crossfadeFrames = Math.floor(crossfadeSeconds * fps);

  // Build slide inputs from audio durations
  const slideInputs = slideRegistry.map((entry) => {
    const slug = entry.slug;
    const audioDurationSeconds = audioDurations[`${entry.id}-${slug}`];
    
    if (!audioDurationSeconds) {
      throw new Error(`No audio duration found for ${entry.id}-${slug}`);
    }

    return {
      audioDurationSeconds,
      paddingSeconds,
    };
  });

  // Calculate timings with crossfade
  const { slideTimings, totalDurationFrames } = calculateSlideTimings(
    slideInputs,
    fps,
    crossfadeFrames
  );

  const props: DeckVideoProps = {
    slideTimings: slideTimings.map((timing) => ({
      startFrame: timing.startFrame,
      durationFrames: timing.durationFrames,
    })),
    crossfadeFrames,
  };

  return (
    <>
      <Composition
        id="DeckVideo"
        component={DeckVideo}
        durationInFrames={totalDurationFrames}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={props}
      />
    </>
  );
};
