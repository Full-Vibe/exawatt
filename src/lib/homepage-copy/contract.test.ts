import { describe, expect, it } from 'vitest';
import { STAGES } from '@/components/site/fleet-story/stages';
import {
  HOMEPAGE_COPY_BASELINE,
  HOMEPAGE_SCENE_IDS,
  parseHomepageCopyDocument,
  validateHomepageCopyDocument,
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

  it('ignores blank pasted rows while preserving intentional lines', () => {
    const document = structuredClone(HOMEPAGE_COPY_BASELINE);
    document.scenes.landing.headline = ['  First  ', '', '  ', 'Second', ''];
    document.scenes.landing.body = ['', 'Body', ''];
    const parsed = parseHomepageCopyDocument(document);
    expect(parsed.scenes.landing.headline).toEqual(['First', 'Second']);
    expect(parsed.scenes.landing.body).toEqual(['Body']);
  });

  it('names the exact field and limit when a line is too long', () => {
    const document = structuredClone(HOMEPAGE_COPY_BASELINE);
    document.scenes.working.body = ['x'.repeat(321)];
    const result = validateHomepageCopyDocument(document);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual({
      fieldId: 'working-body',
      message: 'Line 1 must be 320 characters or fewer.',
    });
  });

  it('addresses button labels and line-count limits separately', () => {
    const document = structuredClone(HOMEPAGE_COPY_BASELINE);
    document.actions.downloadLabel = 'x'.repeat(81);
    document.scenes.fleet.headline = Array.from({ length: 6 }, (_, index) =>
      `Line ${index + 1}`
    );
    const result = validateHomepageCopyDocument(document);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        {
          fieldId: 'download-label',
          message: 'Use 80 characters or fewer.',
        },
        {
          fieldId: 'fleet-headline',
          message: 'Use 5 lines or fewer.',
        },
      ])
    );
  });
});
