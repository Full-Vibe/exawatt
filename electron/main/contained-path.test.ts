import { describe, it, expect } from 'vitest';
import { resolveContainedPath, isRepoRelativePath } from './contained-path';

describe('isRepoRelativePath', () => {
  it('accepts plain repo-relative paths', () => {
    expect(isRepoRelativePath('docs/engineering/roadmap.md')).toBe(true);
    expect(isRepoRelativePath('README.md')).toBe(true);
  });
  it('rejects absolute, home, null, and oversized paths', () => {
    expect(isRepoRelativePath('/etc/passwd')).toBe(false);
    expect(isRepoRelativePath('~/Library/x.command')).toBe(false);
    expect(isRepoRelativePath('a\0b')).toBe(false);
    expect(isRepoRelativePath('a'.repeat(5000))).toBe(false);
    expect(isRepoRelativePath('')).toBe(false);
  });
  it('accepts .. syntactically (containment catches escapes)', () => {
    expect(isRepoRelativePath('../secrets.md')).toBe(true);
  });
});

describe('resolveContainedPath', () => {
  const root = '/Users/example/repo';
  it('allows the root and its descendants', () => {
    expect(resolveContainedPath(root, root)).toBe(root);
    expect(resolveContainedPath(root, `${root}/docs/a.md`)).toBe(
      `${root}/docs/a.md`
    );
  });
  it('rejects .. escapes and sibling-prefix tricks', () => {
    expect(
      resolveContainedPath(root, '/Users/example/repo/../secret')
    ).toBeNull();
    expect(resolveContainedPath(root, '/Users/example/repo-evil/x')).toBeNull();
    expect(resolveContainedPath(root, '/etc/passwd')).toBeNull();
  });
});
