import { ComponentType } from 'react';
import { SlideContent } from './content';
import Slide01 from './slides/01-the-problem';
import Slide02 from './slides/02-who-benefits';
import Slide03 from './slides/03-simple-setup';
import Slide04 from './slides/04-privacy-automatic';
import Slide05 from './slides/05-ask-in-plain-language';
import Slide06 from './slides/06-safe-defaults';
import Slide07 from './slides/07-built-for-trust';
import Slide08 from './slides/08-whats-next';
import Slide09 from './slides/09-current-limits';
import Slide10 from './slides/10-risks-and-mitigations';
import Slide11 from './slides/11-asks';

export interface SlideRegistryEntry {
  id: string;
  slug: string;
  component: ComponentType<{ content: SlideContent }>;
  narrationPath: string;
}

export const slideRegistry: SlideRegistryEntry[] = [
  {
    id: '01',
    slug: 'the-problem',
    component: Slide01,
    narrationPath: 'deck/narration/01-the-problem.md',
  },
  {
    id: '02',
    slug: 'who-benefits',
    component: Slide02,
    narrationPath: 'deck/narration/02-who-benefits.md',
  },
  {
    id: '03',
    slug: 'simple-setup',
    component: Slide03,
    narrationPath: 'deck/narration/03-simple-setup.md',
  },
  {
    id: '04',
    slug: 'privacy-automatic',
    component: Slide04,
    narrationPath: 'deck/narration/04-privacy-automatic.md',
  },
  {
    id: '05',
    slug: 'ask-in-plain-language',
    component: Slide05,
    narrationPath: 'deck/narration/05-ask-in-plain-language.md',
  },
  {
    id: '06',
    slug: 'safe-defaults',
    component: Slide06,
    narrationPath: 'deck/narration/06-safe-defaults.md',
  },
  {
    id: '07',
    slug: 'built-for-trust',
    component: Slide07,
    narrationPath: 'deck/narration/07-built-for-trust.md',
  },
  {
    id: '08',
    slug: 'whats-next',
    component: Slide08,
    narrationPath: 'deck/narration/08-whats-next.md',
  },
  {
    id: '09',
    slug: 'current-limits',
    component: Slide09,
    narrationPath: 'deck/narration/09-current-limits.md',
  },
  {
    id: '10',
    slug: 'risks-and-mitigations',
    component: Slide10,
    narrationPath: 'deck/narration/10-risks-and-mitigations.md',
  },
  { id: '11', slug: 'asks', component: Slide11, narrationPath: 'deck/narration/11-asks.md' },
];
