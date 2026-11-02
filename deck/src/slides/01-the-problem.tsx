import { SlideContent } from '../content';
import SlideLayout from './SlideLayout';

interface SlideProps {
  content: SlideContent;
}

export default function Slide01({ content }: SlideProps) {
  return (
    <SlideLayout title={content.title} slideNumber="1 / 11">
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          fontSize: '42px',
          lineHeight: '1.6',
        }}
      >
        {content.bullets?.map((bullet, i) => (
          <li
            key={i}
            style={{
              marginBottom: '30px',
              paddingLeft: '60px',
              position: 'relative',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: '0',
                color: '#0066cc',
                fontWeight: '700',
              }}
            >
              •
            </span>
            {bullet}
          </li>
        ))}
      </ul>
    </SlideLayout>
  );
}
