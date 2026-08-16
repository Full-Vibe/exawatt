import { describe, it, expect } from 'vitest';
import { buildRepositoryInsert } from './registry';

describe('buildRepositoryInsert', () => {
  const NOW = '2026-07-10T23:00:00.000Z';

  it('builds a repository-kind insert with root_path and recency', () => {
    expect(
      buildRepositoryInsert(
        'user-1',
        { rootPath: '/Users/example/Code/exawatt', name: 'exawatt' },
        NOW
      )
    ).toEqual({
      user_id: 'user-1',
      name: 'exawatt',
      kind: 'repository',
      root_path: '/Users/example/Code/exawatt',
      git_remote: null,
      last_opened_at: NOW,
    });
  });

  it('carries a git remote when present', () => {
    const row = buildRepositoryInsert(
      'u',
      { rootPath: '/p', name: 'p', gitRemote: 'git@github.com:o/p.git' },
      NOW
    );
    expect(row.git_remote).toBe('git@github.com:o/p.git');
  });
});
