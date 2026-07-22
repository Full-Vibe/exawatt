import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectOpener } from './project-opener';

const { listProjects, rebindProjectPath } = vi.hoisted(() => ({
  listProjects: vi.fn(),
  rebindProjectPath: vi.fn(),
}));

vi.mock('@/lib/projects/registry', () => ({
  listProjects,
  rebindProjectPath,
}));

describe('Project opener', () => {
  beforeEach(() => {
    listProjects.mockReset().mockResolvedValue([]);
    rebindProjectPath.mockReset().mockResolvedValue(undefined);
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      workspace: {
        load: vi.fn().mockResolvedValue(null),
      },
      dialog: {
        openDirectory: vi.fn().mockResolvedValue(null),
        pathExists: vi.fn().mockResolvedValue(true),
      },
      projects: {
        resolve: vi.fn(async path => ({
          ok: true as const,
          projectDir: path,
          projectName: path.split('/').at(-1) ?? path,
        })),
        scanDirectory: vi.fn(),
      },
    } as unknown as NonNullable<Window['electron']>;
  });

  it('opens a curated Project without creating a Session', async () => {
    const onOpenProject = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    render(
      <ProjectOpener
        open
        onOpenChange={onOpenChange}
        workspaceProjects={[
          { dir: '/project', name: 'Project', color: '#19E6FF' },
        ]}
        onOpenProject={onOpenProject}
        onImportProjects={vi.fn(async () => true)}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /Project/ }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('/project'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(window.electron?.pty).toBeUndefined();
  });

  it('releases the in-app modal before opening the native folder picker', async () => {
    const onOpenChange = vi.fn();
    vi.mocked(window.electron!.dialog!.openDirectory).mockImplementation(
      async () => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
        return null;
      }
    );
    render(
      <ProjectOpener
        open
        onOpenChange={onOpenChange}
        workspaceProjects={[]}
        onOpenProject={vi.fn(async () => true)}
        onImportProjects={vi.fn(async () => true)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Browse Folder' }));
    await waitFor(() =>
      expect(window.electron!.dialog!.openDirectory).toHaveBeenCalledOnce()
    );
    await waitFor(() =>
      expect(onOpenChange.mock.calls.map(([value]) => value)).toEqual([
        false,
        true,
      ])
    );
  });

  it('does not stack native pickers when Browse is clicked repeatedly', async () => {
    let finish!: (path: string | null) => void;
    vi.mocked(window.electron!.dialog!.openDirectory).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    render(
      <ProjectOpener
        open
        onOpenChange={vi.fn()}
        workspaceProjects={[]}
        onOpenProject={vi.fn(async () => true)}
        onImportProjects={vi.fn(async () => true)}
      />
    );

    const browse = screen.getByRole('button', { name: 'Browse Folder' });
    fireEvent.click(browse);
    fireEvent.click(browse);
    await waitFor(() =>
      expect(window.electron!.dialog!.openDirectory).toHaveBeenCalledOnce()
    );
    await act(async () => finish(null));
  });

  it('scans a parent folder and imports the reviewed selection', async () => {
    vi.mocked(window.electron!.dialog!.openDirectory).mockResolvedValue(
      '/parent'
    );
    vi.mocked(window.electron!.projects!.scanDirectory).mockResolvedValue({
      ok: true,
      candidates: [
        { projectDir: '/parent/a', projectName: 'A', suggested: true },
        { projectDir: '/parent/b', projectName: 'B', suggested: false },
      ],
    });
    const onImportProjects = vi.fn(async () => true);
    render(
      <ProjectOpener
        open
        onOpenChange={vi.fn()}
        workspaceProjects={[]}
        onOpenProject={vi.fn(async () => true)}
        onImportProjects={onImportProjects}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import Folder' }));
    await screen.findByText('Import Projects');
    fireEvent.click(screen.getByRole('button', { name: 'Import 1' }));
    await waitFor(() =>
      expect(onImportProjects).toHaveBeenCalledWith(['/parent/a'])
    );
  });

  it('locates and rebinds a synced Project whose directory moved', async () => {
    listProjects.mockResolvedValue([
      {
        id: 'project-1',
        name: 'Moved Project',
        root_path: '/old/project',
        color: '#19E6FF',
        sort_order: 0,
      },
    ]);
    vi.mocked(window.electron!.dialog!.pathExists).mockResolvedValue(false);
    vi.mocked(window.electron!.dialog!.openDirectory).mockResolvedValue(
      '/new/project'
    );
    vi.mocked(window.electron!.projects!.resolve).mockResolvedValue({
      ok: true,
      projectDir: '/new/project-root',
      projectName: 'Moved Project',
    });
    const onOpenProject = vi.fn(async () => true);
    render(
      <ProjectOpener
        open
        onOpenChange={vi.fn()}
        workspaceProjects={[]}
        onOpenProject={onOpenProject}
        onImportProjects={vi.fn(async () => true)}
      />
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /Moved Project/ })
    );
    await waitFor(() =>
      expect(rebindProjectPath).toHaveBeenCalledWith(
        'project-1',
        '/new/project-root'
      )
    );
    expect(onOpenProject).toHaveBeenCalledWith('/new/project-root');
  });
});
