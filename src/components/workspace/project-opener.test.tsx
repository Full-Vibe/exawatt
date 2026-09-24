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
import { ProjectOpener, useProjectOpenerState } from './project-opener';

const { listProjects, projectRegistryScope, rebindProjectPath } = vi.hoisted(
  () => ({
    listProjects: vi.fn(),
    projectRegistryScope: vi.fn(),
    rebindProjectPath: vi.fn(),
  })
);

vi.mock('@/lib/projects/registry', () => ({
  listProjects,
  projectRegistryScope,
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
      openNativeAgentId: string | null;
      agents: readonly unknown[];
    }) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Connect a server">
        <p>Can place into {(projects ?? []).map(p => p.name).join(', ')}</p>
        <button
          type="button"
          onClick={() =>
            onConnected({
              sourceId: 'source-1',
              openNativeAgentId: 'tyler',
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
    projectRegistryScope.mockReset().mockResolvedValue('local');
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
        {
          dir: '/project',
          registryId: 'project-1',
          name: 'Project',
          color: '#19E6FF',
        },
      ],
      onOpenProject,
      onImportProjects: vi.fn(async () => true),
    });

    fireEvent.click(await screen.findByRole('button', { name: /Project/ }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('/project'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(window.electron?.pty).toBeUndefined();
  });

  it('opens a folderless Context Group without asking Finder for a path', async () => {
    listProjects.mockResolvedValue([
      {
        id: 'project-manual',
        user_id: 'u',
        name: 'Remote operations',
        color: null,
        kind: 'manual',
        root_path: null,
        git_remote: null,
        last_opened_at: null,
        archived_at: null,
        sort_order: 0,
        created_at: '',
        updated_at: '',
      },
    ]);
    const onOpenContextProject = vi.fn();
    renderControlledProjectOpener({
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
      onOpenContextProject,
    });

    fireEvent.click(
      await screen.findByRole('button', { name: /Remote operations/ })
    );

    expect(onOpenContextProject).toHaveBeenCalledWith({
      id: 'project-manual',
      name: 'Remote operations',
      color: null,
    });
    expect(window.electron!.dialog!.pathExists).not.toHaveBeenCalled();
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
      name: /Connect a server/,
    });
    expect(connect).toBeEnabled();

    // The route takes the screen, exactly as the native folder picker does.
    fireEvent.click(connect);
    const dialog = await screen.findByRole('dialog', {
      name: 'Connect a server',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.querySelector('[data-project-opener]')).toBeNull();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Finish connecting' })
    );
    await waitFor(() =>
      expect(onAgentSourceConnected).toHaveBeenCalledWith({
        sourceId: 'source-1',
        openNativeAgentId: 'tyler',
        agents: [],
      })
    );
    // Connecting finished the errand: the chooser does not come back.
    expect(onOpenChange.mock.calls.map(([value]) => value)).toEqual([false]);
    expect(
      screen.queryByRole('dialog', { name: 'Connect a server' })
    ).toBeNull();
  });

  it('returns to the chooser when connecting is abandoned', async () => {
    const onOpenChange = vi.fn();
    renderControlledProjectOpener({
      onOpenChange,
      workspaceProjects: [
        {
          dir: '/project',
          registryId: 'project-1',
          name: 'Project',
          color: '#19E6FF',
        },
      ],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: /Connect a server/ })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Connect a server',
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
      await screen.findByRole('button', { name: /Connect a server/ })
    ).toBeEnabled();
  });

  it('labels the registry local while an account build is signed out', async () => {
    projectRegistryScope.mockResolvedValue('signed-out');
    renderControlledProjectOpener({
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
    });
    expect(await screen.findByText('Local Projects')).toBeVisible();
  });

  it('says the registry is not syncing when it could not be read, not that it is local', async () => {
    // BUG-190: a session auth-js could not refresh is not signed out, and the
    // registry refuses instead of answering with the local namespace.
    listProjects.mockRejectedValue(new Error('Projects are not syncing.'));
    projectRegistryScope.mockRejectedValue(
      new Error('Projects are not syncing.')
    );
    renderControlledProjectOpener({
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
    });
    expect(await screen.findByText('Not syncing')).toBeVisible();
    expect(screen.queryByText('Local Projects')).toBeNull();
  });

  it('marks a Project kept on this machine beside the account ones', async () => {
    // BUG-191: Projects made while signed out stay local after sign-in.
    projectRegistryScope.mockResolvedValue('hosted');
    listProjects.mockResolvedValue([
      {
        id: 'hosted-1',
        user_id: 'user-1',
        name: 'Nebula',
        kind: 'manual',
        root_path: null,
        git_remote: null,
        color: null,
        sort_order: 0,
        last_opened_at: null,
        archived_at: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'local-1',
        user_id: 'local',
        name: 'Tyler',
        kind: 'manual',
        root_path: null,
        git_remote: null,
        color: null,
        sort_order: 1,
        last_opened_at: null,
        archived_at: null,
        created_at: '',
        updated_at: '',
      },
    ]);
    renderControlledProjectOpener({
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
    });
    const local = await screen.findByRole('button', { name: /Tyler/ });
    const hosted = screen.getByRole('button', { name: /Nebula/ });
    expect(local.textContent).toMatch(/Local/);
    expect(hosted.textContent).not.toMatch(/Local/);
  });

  it('carries no sync label in a Community build, which has nothing to sync', async () => {
    renderControlledProjectOpener({
      workspaceProjects: [],
      onOpenProject: vi.fn(async () => true),
      onImportProjects: vi.fn(async () => true),
    });
    await screen.findByText('No Projects yet.');
    expect(screen.queryByText('Local Projects')).toBeNull();
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
        screen.getByRole('button', { name: /Connect a server/ })
      ).toBeDisabled()
    );
    expect(screen.getByText('Desktop app only')).toBeInTheDocument();
  });
});

/**
 * BUG-147: the File menu's Connect command enters the chooser already on the
 * connect route, and cancelling Connect must land on the chooser's Project
 * routes and STAY there. The route is the chooser's own position, so the
 * harness holds it through the same hook the workspace does; a harness that
 * kept a standing `route` beside `open` would reproduce the loop instead of
 * proving it gone.
 */
describe('Project opener summoned on the connect route', () => {
  function Workspace({
    onOpenChange,
  }: {
    onOpenChange: (open: boolean) => void;
  }) {
    const opener = useProjectOpenerState();
    return (
      <>
        <button type="button" onClick={() => opener.summon('connect')}>
          File: Connect a server
        </button>
        <ProjectOpener
          open={opener.open}
          initialRoute={opener.initialRoute}
          onOpenChange={next => {
            onOpenChange(next);
            opener.onOpenChange(next);
          }}
          workspaceProjects={[]}
          onOpenProject={vi.fn(async () => true)}
          onImportProjects={vi.fn(async () => true)}
        />
      </>
    );
  }

  it('can be cancelled: the chooser comes back on its Project routes and stays', async () => {
    const onOpenChange = vi.fn();
    render(<Workspace onOpenChange={onOpenChange} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'File: Connect a server' })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Connect a server',
    });
    // Connect took the screen; the chooser is the owner underneath.
    expect(document.querySelector('[data-project-opener]')).toBeNull();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel connecting' })
    );

    // The chooser is back on the routes Connect sits beside, once.
    await screen.findByText('No Projects yet.');
    expect(
      screen.queryByRole('dialog', { name: 'Connect a server' })
    ).toBeNull();
    expect(onOpenChange.mock.calls.map(([value]) => value)).toEqual([
      false,
      true,
    ]);

    // Closing the chooser closes everything; a fresh summons enters again.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    await waitFor(() =>
      expect(document.querySelector('[data-project-opener]')).toBeNull()
    );
    expect(
      screen.queryByRole('dialog', { name: 'Connect a server' })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'File: Connect a server' })
    );
    await screen.findByRole('dialog', { name: 'Connect a server' });
  });
});
