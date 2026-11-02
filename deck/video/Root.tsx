import { Composition } from 'remotion';
import { DeckVideo } from './DeckVideo';

export const Root: React.FC = () => {
  const fps = 30;
  const paddingSeconds = 0.5;
  const crossfadeSeconds = 0.4;
  const estimatedSlideDurationSeconds = 3.0;
  const numSlides = 11;
  
  const slideDurationFrames = Math.floor((estimatedSlideDurationSeconds + paddingSeconds) * fps);
  const crossfadeDuration = Math.floor(crossfadeSeconds * fps);
  const totalDuration = numSlides * slideDurationFrames - (numSlides - 1) * crossfadeDuration;

  return (
    <Composition
      id="DeckVideo"
      component={DeckVideo}
      durationInFrames={totalDuration}
      fps={fps}
      width={1920}
      height={1080}
    />
  );
};
