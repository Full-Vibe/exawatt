// @vitest-environment jsdom

/**
 * BUG-150: an account build whose operator has not signed in serves the
 * LOCAL registry, so Connect's mapping step has a Project to write to.
 * The seam is the client factory: the build declares an account (a client
 * exists) and its auth has no session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  createOptionalClient: () => ({ auth: { getSession } }),
}));

import {
  listProjects,
  openManualProject,
  openRepositoryProject,
  projectRegistryScope,
  renameProject,
} from './registry';

describe('Project registry in an account build, signed out', () => {
  beforeEach(() => {
    window.localStorage.clear();
    getSession.mockResolvedValue({ data: { session: null } });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

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
    getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });
    await expect(projectRegistryScope()).resolves.toBe('hosted');
  });
});
