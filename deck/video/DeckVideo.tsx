import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
} from 'remotion';
import { slideRegistry } from '../src/slideRegistry';
import { slides } from '../src/content';
import { slideComponents } from './slideComponents';
import { calculateOpacity } from './timing';

export interface SlideTimingProps {
  startFrame: number;
  durationFrames: number;
}

export interface DeckVideoProps {
  slideTimings: SlideTimingProps[];
  crossfadeFrames: number;
}

export const DeckVideo: React.FC<DeckVideoProps> = ({ slideTimings, crossfadeFrames }) => {
  if (slideTimings.length !== slideRegistry.length) {
    throw new Error(
      `Mismatch: ${slideTimings.length} timings for ${slideRegistry.length} slides`
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: 'white' }}>
      {slideRegistry.map((registryEntry, index) => {
        const timing = slideTimings[index];
        const content = slides.find((s) => s.id === registryEntry.id);
        if (!content) {
          throw new Error(`No content found for slide ${registryEntry.id}`);
        }

        const component = slideComponents[registryEntry.id as keyof typeof slideComponents];
        if (!component) {
          throw new Error(`No component found for slide ${registryEntry.id}`);
        }

        const SlideComponent = component;
        const audioFilename = `${registryEntry.id}-${registryEntry.slug}.wav`;
        const audioPath = staticFile(audioFilename);

        return (
          <Sequence
            key={registryEntry.id}
            from={timing.startFrame}
            durationInFrames={timing.durationFrames}
          >
            <SlideWithFade
              isFirstSlide={index === 0}
              crossfadeFrames={crossfadeFrames}
              durationFrames={timing.durationFrames}
            >
              <SlideComponent content={content} />
            </SlideWithFade>
            <Audio src={audioPath} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

interface SlideWithFadeProps {
  isFirstSlide: boolean;
  crossfadeFrames: number;
  durationFrames: number;
  children: React.ReactNode;
}

const SlideWithFade: React.FC<SlideWithFadeProps> = ({
  isFirstSlide,
  crossfadeFrames,
  durationFrames,
  children,
}) => {
  const frame = useCurrentFrame();
  const opacity = calculateOpacity(frame, durationFrames, crossfadeFrames, isFirstSlide);

  return (
    <AbsoluteFill style={{ opacity }}>
      {children}
    </AbsoluteFill>
  );
};
