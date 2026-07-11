import { describe, expect, it } from 'vitest';
import { middleTruncatePath } from './path-label';

describe('middleTruncatePath', () => {
  it('leaves a short path intact', () => {
    expect(middleTruncatePath('/Users/jake/code')).toBe('/Users/jake/code');
  });

  it('keeps the path root and identifying tail', () => {
    const path = '/Users/jake/Code/Personal/FullVibeAI/exawatt-eng-016/src/app';
    const label = middleTruncatePath(path, 38);
    expect(label).toMatch(/^\/Users/);
    expect(label).toContain('…');
    expect(label).toMatch(/src\/app$/);
    expect(label.length).toBeLessThanOrEqual(38);
  });
});
