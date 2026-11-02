import { Composition, staticFile } from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';
import { DeckVideo, DeckVideoProps } from './DeckVideo';
import { slideRegistry } from '../src/slideRegistry';
import { calculateSlideTimings } from './timing';

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="DeckVideo"
        component={DeckVideo}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          slideTimings: [],
          crossfadeFrames: 12,
        }}
        calculateMetadata={async ({ fps }) => {
          const paddingSeconds = 0.5;
          const crossfadeSeconds = 0.4;
          const crossfadeFrames = Math.floor(crossfadeSeconds * fps);

          // Read actual audio durations from WAV files
          const slideInputs = await Promise.all(
            slideRegistry.map(async (entry) => {
              const audioFilename = `${entry.id}-${entry.slug}.wav`;
              const audioPath = staticFile(audioFilename);
              const audioDurationSeconds = await getAudioDurationInSeconds(audioPath);

              return {
                audioDurationSeconds,
                paddingSeconds,
              };
            })
          );

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

          return {
            durationInFrames: totalDurationFrames,
            fps,
            props,
          };
        }}
      />
    </>
  );
};
