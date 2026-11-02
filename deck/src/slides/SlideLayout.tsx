import { ReactNode } from 'react';

interface SlideLayoutProps {
  title: string;
  children: ReactNode;
  slideNumber: string;
}

export default function SlideLayout({ title, children, slideNumber }: SlideLayoutProps) {
  return (
    <div style={{
      width: '1920px',
      height: '1080px',
      display: 'flex',
      flexDirection: 'column',
      padding: '80px',
      boxSizing: 'border-box',
      backgroundColor: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      color: '#1a1a1a',
      position: 'relative',
    }}>
      <div style={{
        fontSize: '64px',
        fontWeight: '700',
        marginBottom: '60px',
        lineHeight: '1.2',
        color: '#0066cc',
      }}>
        {title}
      </div>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}>
        {children}
      </div>
      <div style={{
        position: 'absolute',
        bottom: '40px',
        right: '80px',
        fontSize: '32px',
        color: '#666666',
        fontWeight: '500',
      }}>
        {slideNumber}
      </div>
    </div>
  );
}
