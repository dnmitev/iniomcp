import { slideRegistry } from '../src/slideRegistry';
import { slideComponents } from './slideComponents';

export type SlideId = (typeof slideRegistry)[number]['id'];

export function isSlideId(id: string): id is SlideId {
  return slideRegistry.some((entry) => entry.id === id);
}

export function getSlideComponent(id: string) {
  if (!isSlideId(id)) {
    const validIds = slideRegistry.map((e) => e.id);
    const validIdsStr = validIds.join(', ');
    throw new Error('Unknown slide ID: "' + id + '". Valid IDs are: ' + validIdsStr);
  }

  // At this point, TypeScript knows id is SlideId
  const component = slideComponents[id];
  if (!component) {
    throw new Error(
      'No component found for slide "' +
        id +
        '". Component may be missing from slideComponents map.',
    );
  }

  return component;
}
