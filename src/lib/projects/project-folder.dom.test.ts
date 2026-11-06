import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DirectoryPickOutcome,
  ProjectResolveResult,
} from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

const { rebindProjectPath, reportFolderFailure } = vi.hoisted(() => ({
  rebindProjectPath: vi.fn(async () => undefined),
  reportFolderFailure: vi.fn(),
}));
vi.mock('./registry', () => ({ rebindProjectPath }));
vi.mock('@/lib/native-dialog/native-dialog', async importActual => ({
  ...(await importActual<typeof import('@/lib/native-dialog/native-dialog')>()),
  reportFolderFailure,
}));

import { projectFolderOnThisMachine } from './project-folder';

function bridge({
  exists,
  pick,
  resolved,
}: {
  exists: boolean;
  pick?: DirectoryPickOutcome;
  resolved?: ProjectResolveResult;
}) {
  const double = {
    pathExists: vi.fn(async () => exists),
    openDirectory: vi.fn(
      async (): Promise<DirectoryPickOutcome> => pick ?? { status: 'cancelled' }
    ),
    resolve: vi.fn(
      async (): Promise<ProjectResolveResult> =>
        resolved ?? { ok: false, error: 'unset' }
    ),
  };
  installBridgeDouble({
    dialog: {
      pathExists: double.pathExists,
      openDirectory: double.openDirectory,
    },
    projects: { resolve: double.resolve },
  });
  return double;
}

const moved = { registryId: 'p1', name: 'Moved', rootPath: '/old' };

beforeEach(() => {
  rebindProjectPath.mockClear();
  reportFolderFailure.mockClear();
});
afterEach(() => removeBridgeDouble());

describe('projectFolderOnThisMachine (the one Locate)', () => {
  it('opens a folder that is here without asking', async () => {
    const double = bridge({ exists: true });
    await expect(projectFolderOnThisMachine(moved)).resolves.toBe('/old');
    expect(double.openDirectory).not.toHaveBeenCalled();
  });

  it('resolves the located folder to its Project root and rebinds the registry there', async () => {
    const double = bridge({
      exists: false,
      pick: { status: 'picked', path: '/new/src' },
      resolved: { ok: true, projectDir: '/new', projectName: 'Moved' },
    });
    await expect(projectFolderOnThisMachine(moved)).resolves.toBe('/new');
    expect(double.openDirectory).toHaveBeenCalledWith('Locate Moved');
    expect(double.resolve).toHaveBeenCalledWith('/new/src');
    expect(rebindProjectPath).toHaveBeenCalledWith('p1', '/new');
  });

  it('says why in the folder notice when the pick is not a Project', async () => {
    bridge({
      exists: false,
      pick: { status: 'picked', path: '/tmp' },
      resolved: { ok: false, error: 'Not a Project' },
    });
    await expect(projectFolderOnThisMachine(moved)).resolves.toBeNull();
    expect(reportFolderFailure).toHaveBeenCalledWith('Not a Project');
    expect(rebindProjectPath).not.toHaveBeenCalled();
  });

  it('leaves the Project unbound when the operator cancels', async () => {
    const double = bridge({ exists: false });
    await expect(projectFolderOnThisMachine(moved)).resolves.toBeNull();
    expect(double.resolve).not.toHaveBeenCalled();
    expect(rebindProjectPath).not.toHaveBeenCalled();
  });
});
