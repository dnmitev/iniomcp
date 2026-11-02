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
        calculateMetadata={async (params) => {
          const fps = params.fps || 30;
          const paddingSeconds = 0.5;
          const crossfadeSeconds = 0.4;
          const crossfadeFrames = Math.floor(crossfadeSeconds * fps);

          // Read actual audio durations from WAV files
          const slideInputs = await Promise.all(
            slideRegistry.map(async (entry) => {
              const audioFilename = `${entry.id}-${entry.slug}.wav`;
              const audioPath = staticFile(audioFilename);
              
              try {
                const audioDurationSeconds = await getAudioDurationInSeconds(audioPath);
                
                if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) {
                  throw new Error(`Invalid duration: ${audioDurationSeconds}`);
                }

                return {
                  audioDurationSeconds,
                  paddingSeconds,
                };
              } catch (error) {
                throw new Error(
                  `Failed to get duration for ${audioFilename}: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                  { cause: error }
                );
              }
            })
          );

          // Calculate timings with crossfade
          const { slideTimings, totalDurationFrames } = calculateSlideTimings(
            slideInputs,
            fps,
            crossfadeFrames
          );

          if (!Number.isFinite(totalDurationFrames) || totalDurationFrames <= 0) {
            throw new Error(
              `Invalid totalDurationFrames: ${totalDurationFrames}, slideInputs: ${JSON.stringify(slideInputs)}`
            );
          }

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
