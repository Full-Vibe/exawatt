// @vitest-environment jsdom

/**
 * The Project registry in an account build, in each position its session
 * can be in. The seam is the client factory: the build declares an account
 * (a client exists), and its auth answers the way auth-js 2.86 does.
 *
 * - Signed out (no session, no error) serves the LOCAL registry, so Connect's
 *   mapping step has a Project to write to (BUG-150).
 * - A session auth-js could not refresh (`{ session: null, error }`) is not
 *   signed out: nothing is written anywhere and every read refuses (BUG-190).
 * - Signed in lists the account's Projects and keeps the local ones made
 *   while signed out, which stay local (BUG-191).
 */
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from './contract';

const hosted = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  rows: [] as unknown[],
}));

vi.mock('@/lib/supabase/client', () => ({
  createOptionalClient: () => ({
    auth: { getSession: hosted.getSession, getUser: hosted.getUser },
    from: hosted.from,
  }),
}));

import {
  archiveProject,
  listProjects,
  openManualProject,
  openRepositoryProject,
  ProjectRegistryUnavailableError,
  projectRegistryScope,
  renameProject,
  reorderProjects,
} from './registry';

const SIGNED_OUT = { data: { session: null }, error: null };
const SIGNED_IN = {
  data: { session: { user: { id: 'user-1' } } },
  error: null,
};
/** What `getSession` answers for an expired access token it could not
 *  refresh because the machine is offline (GoTrueClient `__loadSession`). */
const REFRESH_FAILED = {
  data: { session: null },
  error: new AuthRetryableFetchError('Failed to fetch', 0),
};

/** The one hosted read these tests exercise: the listing, a thenable
 *  PostgREST builder the way supabase-js returns one. */
function hostedListing() {
  const query = {
    select: () => query,
    is: () => query,
    order: () => query,
    then: <T>(
      resolve: (value: { data: unknown[]; error: null }) => T
    ): Promise<T> =>
      Promise.resolve({ data: hosted.rows, error: null }).then(resolve),
  };
  return query;
}

function hostedProject(overrides: Partial<Project>): Project {
  return {
    id: 'hosted-1',
    user_id: 'user-1',
    name: 'Hosted',
    color: null,
    kind: 'repository',
    root_path: null,
    git_remote: null,
    last_opened_at: '2026-09-20T00:00:00.000Z',
    archived_at: null,
    sort_order: 0,
    created_at: '2026-09-20T00:00:00.000Z',
    updated_at: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  hosted.rows = [];
  hosted.from.mockReset().mockImplementation(() => hostedListing());
  hosted.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  hosted.getSession.mockReset().mockResolvedValue(SIGNED_OUT);
});

afterEach(() => {
  window.localStorage.clear();
});

describe('Project registry in an account build, signed out', () => {
  it('names its scope so the chooser can say the Projects are local', async () => {
    await expect(projectRegistryScope()).resolves.toBe('signed-out');
  });

  it('persists the manual Project Connect maps an Agent into, and lists it', async () => {
    const created = await openManualProject({
      id: 'manual-1',
      name: 'Remote operations',
    });
    expect(created).toMatchObject({
      id: 'manual-1',
      kind: 'manual',
      root_path: null,
    });
    await expect(listProjects()).resolves.toEqual([created]);
  });

  it('keeps every verb on the same local registry', async () => {
    const project = await openRepositoryProject({
      rootPath: '/Users/tester/Code/nebula',
      name: 'nebula',
    });
    await renameProject(project.id, 'Nebula console');
    const [listed] = await listProjects();
    expect(listed?.name).toBe('Nebula console');
  });

  it('serves the hosted registry once a session exists', async () => {
    hosted.getSession.mockResolvedValue(SIGNED_IN);
    await expect(projectRegistryScope()).resolves.toBe('hosted');
  });
});

describe('Project registry whose session could not be refreshed (BUG-190)', () => {
  beforeEach(() => {
    hosted.getSession.mockResolvedValue(REFRESH_FAILED);
  });

  it('does not call the position signed out', async () => {
    await expect(projectRegistryScope()).rejects.toBeInstanceOf(
      ProjectRegistryUnavailableError
    );
  });

  it('refuses to list rather than answering with the local registry', async () => {
    await openLocalProjectWhileSignedOut('manual-signed-out');
    hosted.getSession.mockResolvedValue(REFRESH_FAILED);
    await expect(listProjects()).rejects.toBeInstanceOf(
      ProjectRegistryUnavailableError
    );
  });

  it('writes no Project anywhere when a folder is opened or Connect saves', async () => {
    await expect(
      openRepositoryProject({
        rootPath: '/Users/tester/Code/nebula',
        name: 'n',
      })
    ).rejects.toBeInstanceOf(ProjectRegistryUnavailableError);
    await expect(
      openManualProject({ id: 'manual-1', name: 'Remote operations' })
    ).rejects.toBeInstanceOf(ProjectRegistryUnavailableError);
    expect(window.localStorage.length).toBe(0);
    expect(hosted.from).not.toHaveBeenCalled();
  });

  it('treats a session read that throws the same way', async () => {
    hosted.getSession.mockRejectedValue(new Error('lock timed out'));
    await expect(
      openManualProject({ id: 'manual-1', name: 'Remote operations' })
    ).rejects.toBeInstanceOf(ProjectRegistryUnavailableError);
    expect(window.localStorage.length).toBe(0);
  });
});

async function openLocalProjectWhileSignedOut(id: string): Promise<Project> {
  hosted.getSession.mockResolvedValue(SIGNED_OUT);
  return openManualProject({ id, name: `Agent ${id}` });
}

describe('Project registry after signing in, with Projects made signed out (BUG-191)', () => {
  it('keeps each Connect-minted Project in the list, marked local', async () => {
    const first = await openLocalProjectWhileSignedOut('manual-a');
    const second = await openLocalProjectWhileSignedOut('manual-b');
    hosted.getSession.mockResolvedValue(SIGNED_IN);
    hosted.rows = [hostedProject({ id: 'hosted-1', sort_order: 0 })];

    const listed = await listProjects();

    expect(listed.map(project => project.id).sort()).toEqual(
      ['hosted-1', first.id, second.id].sort()
    );
    expect(listed.filter(project => project.user_id === 'local')).toHaveLength(
      2
    );
  });

  it('gives way to the account Project for a folder the account already has', async () => {
    await openLocalProjectWhileSignedOut('manual-a');
    hosted.getSession.mockResolvedValue(SIGNED_OUT);
    await openRepositoryProject({
      rootPath: '/Users/tester/Code/nebula',
      name: 'n',
    });
    hosted.getSession.mockResolvedValue(SIGNED_IN);
    hosted.rows = [
      hostedProject({
        id: 'hosted-nebula',
        root_path: '/Users/tester/Code/nebula',
      }),
    ];

    const listed = await listProjects();

    expect(listed.map(project => project.id).sort()).toEqual([
      'hosted-nebula',
      'manual-a',
    ]);
  });

  it('writes a local Project locally, never to the account', async () => {
    await openLocalProjectWhileSignedOut('manual-a');
    hosted.getSession.mockResolvedValue(SIGNED_IN);

    await renameProject('manual-a', 'Remote operations');
    await openManualProject({ id: 'manual-a', name: 'Remote operations' });
    await archiveProject('manual-a');

    expect(hosted.from).not.toHaveBeenCalled();
    hosted.getSession.mockResolvedValue(SIGNED_OUT);
    const archived = await listProjects();
    expect(archived).toEqual([]);
  });

  it('orders local Projects in the combined list without touching the account', async () => {
    await openLocalProjectWhileSignedOut('manual-a');
    await openLocalProjectWhileSignedOut('manual-b');
    hosted.getSession.mockResolvedValue(SIGNED_IN);

    await reorderProjects(['manual-b', 'manual-a']);

    expect(hosted.from).not.toHaveBeenCalled();
    const listed = await listProjects();
    expect(listed.map(project => project.id)).toEqual(['manual-b', 'manual-a']);
  });
});
