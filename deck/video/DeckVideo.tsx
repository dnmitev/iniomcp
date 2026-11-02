import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
} from 'remotion';
import { slideRegistry } from '../src/slideRegistry';
import { slides } from '../src/content';
import { slideComponents } from './slideComponents';

export const DeckVideo: React.FC = () => {
  const fps = 30;
  const paddingSeconds = 0.5;
  const crossfadeSeconds = 0.4;
  const crossfadeDuration = Math.floor(crossfadeSeconds * fps);
  const estimatedSlideDurationSeconds = 3.0;
  
  const slideTimings = [];
  let currentFrame = 0;
  
  for (const registryEntry of slideRegistry) {
    const content = slides.find((s) => s.id === registryEntry.id);
    if (!content) {
      throw new Error(`No content found for slide ${registryEntry.id}`);
    }
    const component = slideComponents[registryEntry.id as keyof typeof slideComponents];
    if (!component) {
      throw new Error(`No component found for slide ${registryEntry.id}`);
    }
    const audioFilename = `${registryEntry.id}-${registryEntry.slug}.wav`;
    const audioPath = staticFile(audioFilename);
    const durationFrames = Math.floor((estimatedSlideDurationSeconds + paddingSeconds) * fps);
    
    slideTimings.push({
      component,
      content,
      audioPath,
      startFrame: currentFrame,
      durationFrames,
    });
    
    const overlapFrames = slideTimings.length > 1 ? crossfadeDuration : 0;
    currentFrame += durationFrames - overlapFrames;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: 'white' }}>
      {slideTimings.map((slide, index) => {
        const SlideComponent = slide.component;
        const actualStart = index > 0 
          ? slide.startFrame - crossfadeDuration 
          : slide.startFrame;
        const actualDuration = index > 0 
          ? slide.durationFrames + crossfadeDuration 
          : slide.durationFrames;

        return (
          <Sequence
            key={index}
            from={actualStart}
            durationInFrames={actualDuration}
          >
            <AbsoluteFill>
              <SlideComponent content={slide.content} />
            </AbsoluteFill>
            <Audio src={slide.audioPath} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
