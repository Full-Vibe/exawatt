import { describe, expect, it } from 'vitest';
import { middleTruncatePath } from './path-label';

describe('middleTruncatePath', () => {
  it('leaves a short path intact', () => {
    expect(middleTruncatePath('/Users/example/code')).toBe(
      '/Users/example/code'
    );
  });

  it('keeps the path root and identifying tail', () => {
    const path = '/Users/example/Code/Projects/sample-app/src/app';
    const label = middleTruncatePath(path, 38);
    expect(label.startsWith('/Users/example')).toBe(true);
    expect(label).toContain('…');
    expect(label).toMatch(/src\/app$/);
    expect(label.length).toBeLessThanOrEqual(38);
  });
});
