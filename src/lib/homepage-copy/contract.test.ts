import { describe, expect, it } from 'vitest';
import { STAGES } from '@/components/site/fleet-story/stages';
import {
  HOMEPAGE_COPY_BASELINE,
  HOMEPAGE_SCENE_IDS,
  parseHomepageCopyDocument,
} from './contract';

describe('homepage copy document', () => {
  it('seeds a complete, valid document in stage order', () => {
    expect(HOMEPAGE_SCENE_IDS).toEqual(STAGES.map(stage => stage.id));
    expect(parseHomepageCopyDocument(HOMEPAGE_COPY_BASELINE)).toEqual(
      HOMEPAGE_COPY_BASELINE
    );
  });

  it('rejects partial publications and fields outside the copy boundary', () => {
    const { fleet: _fleet, ...partial } = HOMEPAGE_COPY_BASELINE.scenes;
    expect(() =>
      parseHomepageCopyDocument({
        ...HOMEPAGE_COPY_BASELINE,
        scenes: partial,
      })
    ).toThrow();
    expect(() =>
      parseHomepageCopyDocument({
        ...HOMEPAGE_COPY_BASELINE,
        scenes: {
          ...HOMEPAGE_COPY_BASELINE.scenes,
          landing: {
            ...HOMEPAGE_COPY_BASELINE.scenes.landing,
            count: 500,
          },
        },
      })
    ).toThrow();
  });

  it('keeps one intentional text line per field', () => {
    expect(() =>
      parseHomepageCopyDocument({
        ...HOMEPAGE_COPY_BASELINE,
        scenes: {
          ...HOMEPAGE_COPY_BASELINE.scenes,
          landing: {
            ...HOMEPAGE_COPY_BASELINE.scenes.landing,
            headline: ['First\nsecond'],
          },
        },
      })
    ).toThrow();
  });
});
