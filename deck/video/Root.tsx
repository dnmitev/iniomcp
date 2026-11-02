import { Composition, staticFile } from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';
import { DeckVideo, DeckVideoProps } from './DeckVideo';
import { slideRegistry } from '../src/slideRegistry';

interface SlideTimingInput {
  audioDurationSeconds: number;
  paddingSeconds: number;
}

interface SlideTiming {
  startFrame: number;
  durationFrames: number;
}

function calculateSlideTimings(
  slides: SlideTimingInput[],
  fps: number,
  crossfadeFrames: number
): { slideTimings: SlideTiming[]; totalDurationFrames: number } {
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

    const overlap = i < slides.length - 1 ? crossfadeFrames : 0;
    currentFrame += durationFrames - overlap;
  }

  return {
    slideTimings,
    totalDurationFrames: currentFrame,
  };
}

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
          console.log('calculateMetadata params:', params);
          
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
                
                console.log(`[${audioFilename}] duration: ${audioDurationSeconds}s`);
                
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
                  }`
                );
              }
            })
          );

          console.log('slideInputs:', slideInputs);
          console.log('fps:', fps, 'crossfadeFrames:', crossfadeFrames);

          // Calculate timings with crossfade
          const result = calculateSlideTimings(
            slideInputs,
            fps,
            crossfadeFrames
          );

          console.log('result:', result);
          
          const { slideTimings, totalDurationFrames } = result;
          
          console.log('totalDurationFrames:', totalDurationFrames);
          console.log('slideTimings:', slideTimings);

          if (!Number.isFinite(totalDurationFrames) || totalDurationFrames <= 0) {
            throw new Error(`Invalid totalDurationFrames: ${totalDurationFrames}, slideInputs: ${JSON.stringify(slideInputs)}`);
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
