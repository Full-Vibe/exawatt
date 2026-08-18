import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { type ComponentProps, useState } from 'react';
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

/** ENG-010 C2 lands the connect surface in its own module; the chooser is
 *  responsible for presenting the route and handing the connected Agent up,
 *  which is exactly what this stand-in lets the test hold it to. */
vi.mock('./connect-source-dialog', () => ({
  ConnectSourceDialog: ({
    open,
    projects,
    onOpenChange,
    onConnected,
  }: {
    open: boolean;
    projects?: readonly { id: string; name: string }[];
    onOpenChange: (open: boolean) => void;
    onConnected: (result: {
      sourceId: string;
      openAgentId: string | null;
      agents: readonly unknown[];
    }) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Connect existing Agent">
        <p>Can place into {(projects ?? []).map(p => p.name).join(', ')}</p>
        <button
          type="button"
          onClick={() =>
            onConnected({
              sourceId: 'source-1',
              openAgentId: 'tyler',
              agents: [],
            })
          }
        >
          Finish connecting
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel connecting
        </button>
      </div>
    ) : null,
}));

function renderControlledProjectOpener({
  onOpenChange = vi.fn(),
  ...props
}: Omit<ComponentProps<typeof ProjectOpener>, 'open' | 'onOpenChange'> & {
  onOpenChange?: (open: boolean) => void;
}) {
  function ControlledProjectOpener() {
    const [open, setOpen] = useState(true);
    return (
      <ProjectOpener
        {...props}
        open={open}
        onOpenChange={next => {
          onOpenChange(next);
          setOpen(next);
        }}
      />
    );
  }

  return render(<ControlledProjectOpener />);
}

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
      connectedSources: {
        list: vi.fn().mockResolvedValue([]),
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
    renderControlledProjectOpener({
      onOpenChange,
      workspaceProjects: [
        { dir: '/project', name: 'Project', color: '#19E6FF' },
      ],
      onOpenProject,
      onImportProjects: vi.fn(async () => true),
    });

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
        expect(document.querySelector('[data-project-opener]')).toBeNull();
        return null;
      }
    );
    renderControlledProjectOpener({
      onOpenChange,
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
    });

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
    renderControlledProjectOpener({
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
    });

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
    renderControlledProjectOpener({
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects,
    });

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
    renderControlledProjectOpener({
      workspaceProjects: [],
      onOpenProject,
      onImportProjects: vi.fn(async () => true),
    });

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
  it('offers connecting an existing Agent beside the Project routes', async () => {
    const onOpenChange = vi.fn();
    const onAgentSourceConnected = vi.fn();
    renderControlledProjectOpener({
      onOpenChange,
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
      onAgentSourceConnected,
    });

    // A peer of Browse and Import, present even with nothing in the library.
    await screen.findByText('No Projects yet.');
    const connect = screen.getByRole('button', {
      name: /Connect existing Agent/,
    });
    expect(connect).toBeEnabled();

    // The route takes the screen, exactly as the native folder picker does.
    fireEvent.click(connect);
    const dialog = await screen.findByRole('dialog', {
      name: 'Connect existing Agent',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.querySelector('[data-project-opener]')).toBeNull();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Finish connecting' })
    );
    await waitFor(() =>
      expect(onAgentSourceConnected).toHaveBeenCalledWith({
        sourceId: 'source-1',
        openAgentId: 'tyler',
        agents: [],
      })
    );
    // Connecting finished the errand: the chooser does not come back.
    expect(onOpenChange.mock.calls.map(([value]) => value)).toEqual([false]);
    expect(
      screen.queryByRole('dialog', { name: 'Connect existing Agent' })
    ).toBeNull();
  });

  it('returns to the chooser when connecting is abandoned', async () => {
    const onOpenChange = vi.fn();
    renderControlledProjectOpener({
      onOpenChange,
      workspaceProjects: [
        { dir: '/project', name: 'Project', color: '#19E6FF' },
      ],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: /Connect existing Agent/ })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Connect existing Agent',
    });
    // Mapping is explicit, so the flow is handed the Projects it may choose.
    expect(within(dialog).getByText('Can place into Project')).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel connecting' })
    );

    await waitFor(() =>
      expect(onOpenChange.mock.calls.map(([value]) => value)).toEqual([
        false,
        true,
      ])
    );
    expect(
      await screen.findByRole('button', { name: /Connect existing Agent/ })
    ).toBeEnabled();
  });

  it('says so when connecting has no desktop process to run in', async () => {
    delete (window.electron as { connectedSources?: unknown }).connectedSources;
    renderControlledProjectOpener({
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Connect existing Agent/ })
      ).toBeDisabled()
    );
    expect(screen.getByText('Desktop app only')).toBeInTheDocument();
  });
});
