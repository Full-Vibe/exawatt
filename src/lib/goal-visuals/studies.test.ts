import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GOAL_VISUAL_IDENTITY_KEY_PATTERN } from './contract';
import {
  GOAL_VISUAL_STUDY_IDENTITIES,
  type GoalVisualStudyId,
} from './studies';

/**
 * BUG-091 moved identity derivation to the client, which means the gallery
 * bench can no longer name a study in its request. Its keys are constants now,
 * and a constant is only trustworthy while its provenance is checkable.
 *
 * This reproduces the derivation the hosted route performed until 2026-08-19 —
 * `sha256("goal-visual:v2\0<project key>\0<label>")` over NFKC-normalized,
 * whitespace-collapsed, lowercased parts — from the retired study inputs. Equal
 * keys mean every study image already cached under them is still addressed.
 */
const RETIRED_STUDY_PROJECT_PREFIX = 'hud-gallery:goal-visual-languages:v1:';
const RETIRED_STUDY_GOALS = [
  'Reduce context switching across active agent work',
  'Prepare the Exawatt agent launch configuration',
  'Unify consumption visibility across AI platforms',
];

function retiredServerIdentity(projectKey: string, label: string): string {
  const part = (value: string) =>
    value
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('en-US');
  return createHash('sha256')
    .update(`goal-visual:v2\0${part(projectKey)}\0${part(label)}`, 'utf8')
    .digest('hex');
}

describe('gallery study identities', () => {
  it('are the keys the hosted route used to derive, so cached studies survive', () => {
    for (const [id, identityKey] of Object.entries(
      GOAL_VISUAL_STUDY_IDENTITIES
    ) as Array<[GoalVisualStudyId, string]>) {
      const variant = Number(id.slice(id.lastIndexOf(':') + 1));
      expect(
        identityKey,
        `${id}: this table was edited, or the study's retired inputs changed`
      ).toBe(
        retiredServerIdentity(
          `${RETIRED_STUDY_PROJECT_PREFIX}${id}`,
          RETIRED_STUDY_GOALS[variant]
        )
      );
      expect(identityKey).toMatch(GOAL_VISUAL_IDENTITY_KEY_PATTERN);
    }
  });

  it('are distinct, so no two studies collide on one cached image', () => {
    const keys = Object.values(GOAL_VISUAL_STUDY_IDENTITIES);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(21);
  });
});
