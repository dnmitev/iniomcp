import { useEffect, useState } from 'react';
import { slides } from './content';
import { slideRegistry } from './slideRegistry';

export default function App() {
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const index = slideRegistry.findIndex((s) => s.id === hash);
      if (index !== -1) {
        setCurrentSlide(index);
      }
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          navigateSlide(-1);
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          navigateSlide(1);
          break;
        case 'Home':
          e.preventDefault();
          goToSlide(0);
          break;
        case 'End':
          e.preventDefault();
          goToSlide(slideRegistry.length - 1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentSlide]);

  const navigateSlide = (delta: number) => {
    const newIndex = Math.max(0, Math.min(slideRegistry.length - 1, currentSlide + delta));
    goToSlide(newIndex);
  };

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
    window.location.hash = slideRegistry[index].id;
  };

  const slide = slideRegistry[currentSlide];
  const content = slides[currentSlide];
  const SlideComponent = slide.component;

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f0f0f0',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '1920px',
            height: '1080px',
            transform: 'scale(var(--slide-scale))',
            transformOrigin: 'center center',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
          }}
        >
          <SlideComponent content={content} />
        </div>
      </div>
      <style>{`
        :root {
          --slide-scale: min(calc(100vw / 1920), calc(100vh / 1080));
        }
        body {
          margin: 0;
          padding: 0;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
