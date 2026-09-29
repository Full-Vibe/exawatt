import { describe, expect, it } from 'vitest';
import { GET as distributionIcon } from '../exawatt-distribution/icon.png/route';
import { GET } from './route';

describe('favicon route', () => {
  it('serves the distribution icon the metadata declares', () => {
    expect(GET).toBe(distributionIcon);
  });
});
