import { describe, expect, it } from 'vitest';
import { mergeProjectLibrary } from './project-library';

describe('Project library', () => {
  it('preserves synced order and fills local gaps without duplicates', () => {
    const entries = mergeProjectLibrary(
      [
        {
          id: 'one',
          user_id: 'u',
          name: 'Synced name',
          kind: 'repository',
          root_path: '/one',
          git_remote: null,
          color: '#fff',
          sort_order: 0,
          last_opened_at: '1970-01-01T00:00:00.100Z',
          archived_at: null,
          created_at: '',
          updated_at: '',
        },
      ],
      [
        { dir: '/one', name: 'Stale local name' },
        { dir: '/two', name: 'Local', color: '#222' },
      ],
      [
        { dir: '/two', name: 'Duplicate recent' },
        { dir: '/three', name: 'Recent' },
      ]
    );
    expect(entries.map(entry => entry.dir)).toEqual(['/one', '/two', '/three']);
    expect(entries[0]).toMatchObject({
      name: 'Synced name',
      registryId: 'one',
    });
    expect(entries[1]).toMatchObject({ name: 'Local', lastOpenedAt: 0 });
  });
});
