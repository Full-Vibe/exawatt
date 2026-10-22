'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPrimaryActionHint,
  DialogTitle,
} from '@/components/ui/dialog';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from './workspace-theme';
import {
  listProjects,
  projectRegistryScope,
  rebindProjectPath,
  type ProjectOpenedContext,
} from '@/lib/projects/registry';
import { extractRecentProjects } from './switcher-rows';
import {
  mergeProjectLibrary,
  type ProjectLibraryEntry,
  type WorkspaceProjectSummary,
} from './project-library';
import { ArrowLeft, Check, Search } from 'lucide-react';
import {
  ConnectSourceDialog,
  type ConnectSourceResult,
} from './connect-source-dialog';
import type { ProjectImportCandidate } from '@exawatt/core/desktop-bridge';
import { ProjectCard, ProjectRoutes } from './project-routes';
import {
  YourProjects,
  type SuggestionOpen,
} from './start-screen/your-projects';

type ProjectOpenerRoute = 'projects' | 'connect' | 'import';

/** Where the listed Projects came from, as the registry answered. */
type RegistryPosition =
  | Awaited<ReturnType<typeof projectRegistryScope>>
  | 'unavailable';

/** Community has nothing to sync and carries no label; neither does a
 *  registry that is syncing. */
const REGISTRY_LABEL: Record<RegistryPosition, string | null> = {
  hosted: null,
  local: null,
  'signed-out': 'Local Projects',
  unavailable: 'Not syncing',
};

/**
 * The chooser's position in the workspace, as ONE value: closed, or the
 * route it is on.
 *
 * The route is not standing state beside `open`. The chooser closes itself
 * to hand the screen to Connect and reopens itself when Connect is cancelled
 * or the native folder picker is dismissed; a route that survived that round
 * trip re-entered Connect on every reopen, so File → Connect a server…
 * could never be cancelled (BUG-147). With closed as a member of the same
 * value, the chooser reopening itself lands on the Project routes, and only
 * a fresh summons can put it on Connect.
 */
export function useProjectOpenerState(): {
  open: boolean;
  initialRoute: ProjectOpenerRoute;
  /** The folder an `import` summons reviews, already picked by the caller. */
  importDirectory: string | null;
  onOpenChange: (open: boolean) => void;
  /** Open the chooser on a route. The default is the Project routes. An
   *  `import` summons carries the folder its caller already picked (the
   *  Start screen picks first, so no dialog flashes before the OS picker). */
  summon: (route?: ProjectOpenerRoute, importDirectory?: string) => void;
} {
  const [position, setPosition] = useState<
    | { route: 'closed' }
    | { route: ProjectOpenerRoute; importDirectory: string | null }
  >({ route: 'closed' });
  const summon = useCallback(
    (route: ProjectOpenerRoute = 'projects', importDirectory?: string) =>
      setPosition({ route, importDirectory: importDirectory ?? null }),
    []
  );
  const onOpenChange = useCallback(
    (next: boolean) =>
      setPosition(
        next
          ? { route: 'projects', importDirectory: null }
          : { route: 'closed' }
      ),
    []
  );
  return {
    open: position.route !== 'closed',
    initialRoute: position.route === 'closed' ? 'projects' : position.route,
    importDirectory:
      position.route === 'closed' ? null : position.importDirectory,
    onOpenChange,
    summon,
  };
}

export function ProjectOpener({
  open,
  onOpenChange,
  workspaceProjects,
  onOpenProject,
  onImportProjects,
  onOpenContextProject,
  onAgentSourceConnected,
  onOpenSuggestion,
  onOpenAllSuggestions,
  initialRoute = 'projects',
  importDirectory = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceProjects: WorkspaceProjectSummary[];
  onOpenProject: (
    dir: string,
    opened: ProjectOpenedContext
  ) => Promise<boolean>;
  onImportProjects: (dirs: string[]) => Promise<boolean>;
  /** Open a durable folderless Context Group without resolving a path. */
  onOpenContextProject?: (
    project: {
      id: string;
      name: string;
      color: string | null;
    },
    opened: ProjectOpenedContext
  ) => void;
  /** ENG-010 C2: a saved source hands back its mapping and the Agent to open. */
  onAgentSourceConnected?: (result: ConnectSourceResult) => void;
  /** ENG-046: open a harness-store suggestion, exactly as Browse would. */
  onOpenSuggestion?: (open: SuggestionOpen) => Promise<boolean>;
  /** ENG-046: "Open all recent". */
  onOpenAllSuggestions?: (opens: SuggestionOpen[]) => Promise<boolean>;
  /**
   * Which route the chooser lands on. The File menu's Connect command enters
   * here rather than opening a second door to the same place, so cancelling
   * still returns to the chooser the route belongs to.
   */
  initialRoute?: ProjectOpenerRoute;
  /** The folder an `import` route reviews, picked before the chooser opened. */
  importDirectory?: string | null;
}) {
  const [synced, setSynced] = useState<
    Awaited<ReturnType<typeof listProjects>>
  >([]);
  const [recents, setRecents] = useState<
    ReturnType<typeof extractRecentProjects>
  >([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [registry, setRegistry] = useState<RegistryPosition>('local');
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ProjectImportCandidate[] | null>(
    null
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nativePicker, setNativePicker] = useState<
    'browse' | 'import' | 'locate' | null
  >(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [suggestionsListed, setSuggestionsListed] = useState(0);
  // Connecting runs a tunnel and a Gateway handshake from the main process,
  // so outside the desktop app the route says so instead of failing later.
  const [connectSupported, setConnectSupported] = useState(true);
  const nativePickerActive = useRef(false);
  const releaseNativePicker = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      // A native picker temporarily replaces this modal. Preserve its state
      // while control belongs to the OS so cancel/error can return the user to
      // exactly the chooser they left.
      if (!nativePicker && !connectOpen) {
        setQuery('');
        setCandidates(null);
        setError(null);
      }
      return;
    }
    let cancelled = false;
    let syncFailed = false;
    setLoading(true);
    setRegistry('local');
    setConnectSupported(Boolean(window.electron?.connectedSources));
    void Promise.all([
      listProjects().catch(() => {
        syncFailed = true;
        return [];
      }),
      window.electron?.workspace?.load() ?? Promise.resolve(null),
      projectRegistryScope().catch(() => 'unavailable' as const),
    ]).then(([projects, layout, scope]) => {
      if (cancelled) return;
      setSynced(projects);
      setRecents(extractRecentProjects(layout));
      // The label is the registry's own answer. A read that failed is not
      // "signed out" and not "Community": it is not syncing, and saying
      // "Local Projects" there told the operator his Projects lived on this
      // machine when they were in an account nobody could reach (BUG-190).
      setRegistry(syncFailed ? 'unavailable' : scope);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, nativePicker, connectOpen]);

  const library = useMemo(
    () => mergeProjectLibrary(synced, workspaceProjects, recents),
    [synced, workspaceProjects, recents]
  );

  // A suggestion for a folder the library already lists would be the same
  // Project twice; the library row is the one that carries its identity.
  const libraryPaths = useMemo(
    () =>
      new Set(
        library
          .map(project => project.rootPath)
          .filter((path): path is string => path !== null)
      ),
    [library]
  );

  const projects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? library.filter(project =>
          `${project.name} ${project.rootPath ?? ''}`
            .toLocaleLowerCase()
            .includes(normalized)
        )
      : library;
  }, [library, query]);

  // Where a discovered Agent can land: the same library this chooser lists,
  // identified by durable Project id. Folder binding is separate and optional;
  // a Gateway is never silently turned into a Project.
  const connectProjectOptions = useMemo(
    () =>
      library
        // A recent folder with no registry row has no durable Project id yet.
        // It remains openable, but Connect cannot turn its path into identity.
        .filter(project => project.registryId !== null)
        .map(project => ({
          id: project.registryId!,
          name: project.name,
          rootPath: project.rootPath,
          remoteHome: project.remoteHome,
        })),
    [library]
  );

  const pickDirectory = async (
    kind: NonNullable<typeof nativePicker>,
    title: string
  ): Promise<{ started: boolean; path: string | null }> => {
    if (nativePickerActive.current) return { started: false, path: null };
    nativePickerActive.current = true;
    setNativePicker(kind);
    setError(null);

    const dialogReleased = new Promise<void>(resolve => {
      releaseNativePicker.current = resolve;
    });
    onOpenChange(false);

    // Radix keeps its FocusScope mounted through the close animation. A frame
    // is not a lifecycle boundary: AppKit can receive the sheet request while
    // the web modal still owns focus, leaving the native picker invisible and
    // this control permanently disabled. Wait for Radix's close-auto-focus
    // phase, which runs only after the modal focus scope has been released.
    await dialogReleased;
    try {
      return {
        started: true,
        path: (await window.electron?.dialog?.openDirectory(title)) ?? null,
      };
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The folder picker could not be opened.'
      );
      return { started: true, path: null };
    }
  };

  const finishDirectoryPick = (reopen: boolean) => {
    nativePickerActive.current = false;
    releaseNativePicker.current = null;
    if (reopen) onOpenChange(true);
    setNativePicker(null);
  };

  // Connecting is a route out of this chooser, so it takes the screen the way
  // the native picker does: one modal at a time, and cancelling comes back to
  // exactly the routes the operator was choosing between.
  const connectSucceeded = useRef(false);

  const beginConnect = () => {
    connectSucceeded.current = false;
    setConnectOpen(true);
    onOpenChange(false);
  };

  // Entering on the connect route hands the screen straight to it. The chooser
  // stays the owner underneath, so cancelling lands on the routes this verb
  // sits beside rather than on nothing.
  useEffect(() => {
    if (!open || initialRoute !== 'connect') return;
    beginConnect();
    // Only on the transition into an open chooser; beginConnect closes this
    // one, and re-running on its own state change would reopen the dialog the
    // operator just cancelled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRoute]);

  const choose = async (project: ProjectLibraryEntry) => {
    if (project.rootPath === null) {
      onOpenContextProject?.(
        { id: project.projectId, name: project.name, color: project.color },
        { source: 'recent' }
      );
      onOpenChange(false);
      return;
    }
    let dir = project.rootPath;
    const exists = await window.electron?.dialog?.pathExists(dir);
    if (exists === false) {
      const pick = await pickDirectory('locate', `Locate ${project.name}`);
      if (!pick.started) return;
      if (!pick.path) {
        finishDirectoryPick(true);
        return;
      }
      let opened = false;
      try {
        const resolved = await window.electron?.projects?.resolve(pick.path);
        if (!resolved) return;
        if (!resolved.ok) {
          setError(resolved.error);
          return;
        }
        dir = resolved.projectDir;
        if (project.registryId) {
          await rebindProjectPath(project.registryId, dir).catch(() => {});
        }
        opened = await onOpenProject(dir, { source: 'recent' });
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The selected Project could not be opened.'
        );
      } finally {
        finishDirectoryPick(!opened);
      }
      return;
    }
    try {
      if (await onOpenProject(dir, { source: 'recent' })) onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The selected Project could not be opened.'
      );
    }
  };

  const browse = async () => {
    const pick = await pickDirectory('browse', 'Open Project');
    if (!pick.started) return;
    if (!pick.path) {
      finishDirectoryPick(true);
      return;
    }
    let opened = false;
    try {
      opened = await onOpenProject(pick.path, { source: 'browse' });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The selected Project could not be opened.'
      );
    } finally {
      finishDirectoryPick(!opened);
    }
  };

  const beginImport = async () => {
    const pick = await pickDirectory(
      'import',
      'Choose a folder containing Projects'
    );
    if (!pick.started) return;
    if (!pick.path) {
      finishDirectoryPick(true);
      return;
    }
    await reviewImport(pick.path);
    finishDirectoryPick(true);
  };

  /** Scan a picked folder and put its Projects up for review. */
  const reviewImport = async (directory: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron?.projects?.scanDirectory(directory);
      if (!result) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCandidates(result.candidates);
      const suggested = result.candidates.filter(item => item.suggested);
      setSelected(
        new Set(
          (suggested.length > 0 ? suggested : result.candidates).map(
            item => item.projectDir
          )
        )
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Projects could not be discovered in that folder.'
      );
    } finally {
      setLoading(false);
    }
  };

  // An import summoned with its folder already picked goes straight to the
  // review, the way a Browse-then-Import inside the chooser arrives there.
  useEffect(() => {
    if (!open || initialRoute !== 'import' || !importDirectory) return;
    // Only on the transition into an open chooser with a folder to review.
    void reviewImport(importDirectory);
  }, [open, initialRoute, importDirectory]);

  const finishImport = async () => {
    if (selected.size === 0) return;
    if (await onImportProjects([...selected])) onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-project-opener
          primaryAction={
            // Import review is the one mode with a single action the dialog is
            // for. Browsing is a chooser: each row IS its own action, and a
            // default over a list of Projects could only pick one arbitrarily.
            candidates
              ? {
                  label: `Import ${selected.size || ''}`.trim(),
                  run: () => void finishImport(),
                  disabled: selected.size === 0,
                }
              : {
                  none: 'Browsing is a chooser rather than a form: every row is its own action, and a default button over a list of Projects would have to pick one of them arbitrarily.',
                }
          }
          onCloseAutoFocus={event => {
            if (!nativePickerActive.current) return;
            event.preventDefault();
            const release = releaseNativePicker.current;
            releaseNativePicker.current = null;
            release?.();
          }}
          className="flex max-h-[min(760px,calc(100vh-3rem))] w-[min(820px,calc(100vw-2rem))] max-w-none flex-col overflow-hidden rounded-md border p-0 sm:max-w-none"
          style={{
            background: HUD.bg.deep,
            borderColor: HUD.strokeSoft,
          }}
        >
          <DialogHeader
            className="gap-1 border-b px-5 py-4 pr-12"
            style={{ borderColor: HUD.strokeFaint }}
          >
            <DialogTitle
              className="font-display text-base"
              style={{ color: HUD.text }}
            >
              {candidates ? 'Import Projects' : 'Open Project'}
            </DialogTitle>
            <DialogDescription
              className="font-mono text-xs"
              style={{ color: HUD.textDim }}
            >
              {candidates
                ? 'Choose which folders belong in your Project library.'
                : 'Opening a Project does not start an Agent or shell.'}
            </DialogDescription>
          </DialogHeader>

          {candidates ? (
            <div
              data-project-import-review
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="max-h-[480px] overflow-y-auto p-3">
                {candidates.length === 0 ? (
                  <p
                    className="px-2 py-10 text-center font-mono text-sm"
                    style={{ color: HUD.textDim }}
                  >
                    No folders found.
                  </p>
                ) : (
                  <div className="grid gap-1">
                    {candidates.map(candidate => {
                      const checked = selected.has(candidate.projectDir);
                      return (
                        <button
                          key={candidate.projectDir}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() =>
                            setSelected(current => {
                              const next = new Set(current);
                              if (checked) next.delete(candidate.projectDir);
                              else next.add(candidate.projectDir);
                              return next;
                            })
                          }
                          className="flex min-w-0 items-center gap-3 rounded px-3 py-2 text-left outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
                        >
                          <span
                            className="grid h-4 w-4 shrink-0 place-items-center border"
                            style={{
                              borderColor: checked ? HUD.cyan : HUD.textDim,
                              color: HUD.cyan,
                            }}
                          >
                            {checked && <Check className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className="block truncate text-sm"
                              style={{ color: HUD.text }}
                            >
                              {candidate.projectName}
                            </span>
                            <span
                              className="block truncate font-mono text-chrome-micro"
                              style={{ color: HUD.textDim }}
                            >
                              {candidate.projectDir}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div
                className="flex items-center justify-between border-t px-4 py-3"
                style={{ borderColor: HUD.strokeFaint }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setCandidates(null);
                    setError(null);
                  }}
                  className="inline-flex h-8 items-center gap-2 rounded px-2 font-mono text-xs outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{ color: HUD.textDim }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  data-project-import-confirm
                  onClick={() => void finishImport()}
                  className="flex h-8 items-center gap-1.5 rounded border px-3 font-mono text-xs outline-none disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{
                    color: HUD.text,
                    borderColor: withThemeAlpha(HUD.cyan, 0.45),
                    background: withThemeAlpha(HUD.cyan, 0.09),
                  }}
                >
                  Import {selected.size || ''}
                  <DialogPrimaryActionHint />
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="border-b px-4 py-3"
                style={{ borderColor: HUD.divider }}
              >
                <label
                  className="flex h-9 items-center gap-2 rounded border px-3"
                  style={{
                    borderColor: HUD.strokeSoft,
                    color: HUD.textDim,
                  }}
                >
                  <Search className="h-4 w-4 shrink-0" />
                  <input
                    autoFocus
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search Projects"
                    aria-label="Search Projects"
                    data-project-opener-search
                    className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
                    style={{ color: HUD.text }}
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {onOpenSuggestion && onOpenAllSuggestions && (
                  <YourProjects
                    headingLevel="h3"
                    hiddenPaths={libraryPaths}
                    query={query}
                    divided={loading || projects.length > 0}
                    onListedChange={setSuggestionsListed}
                    onOpen={async open => {
                      const opened = await onOpenSuggestion(open);
                      if (opened) onOpenChange(false);
                      return opened;
                    }}
                    onOpenAll={async opens => {
                      const opened = await onOpenAllSuggestions(opens);
                      if (opened) onOpenChange(false);
                      return opened;
                    }}
                  />
                )}
                {loading ? (
                  <p
                    className="py-12 text-center font-mono text-sm"
                    style={{ color: HUD.textDim }}
                  >
                    Loading Projects...
                  </p>
                ) : projects.length === 0 ? (
                  // Suggestions above are the Projects there are to open;
                  // "No Projects yet" under them would contradict the rows.
                  suggestionsListed > 0 ? null : (
                    <p
                      className="py-12 text-center font-mono text-sm"
                      style={{ color: HUD.textDim }}
                    >
                      {query ? 'No matching Projects.' : 'No Projects yet.'}
                    </p>
                  )
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {projects.map(project => (
                      <ProjectCard
                        key={project.dir}
                        name={project.name}
                        color={project.color}
                        remoteHome={project.remoteHome}
                        onOpen={() => void choose(project)}
                        detail={
                          <>
                            {project.remoteHome
                              ? 'Connected servers'
                              : (project.rootPath ?? 'No folder')}
                            {/* Beside an account's Projects, one kept on this
                              machine says so: it does not sync (BUG-191). */}
                            {registry === 'hosted' &&
                              project.local &&
                              ' · Local'}
                          </>
                        }
                      />
                    ))}
                  </div>
                )}
                {error && (
                  <p
                    role="alert"
                    className="mt-3 font-mono text-xs"
                    style={{ color: HUD.red }}
                  >
                    {error}
                  </p>
                )}
              </div>
              <div
                className="border-t px-4 py-3"
                style={{ borderColor: HUD.strokeFaint }}
              >
                <ProjectRoutes
                  disabled={nativePicker !== null}
                  connectSupported={connectSupported}
                  onBrowse={() => void browse()}
                  onImport={() => void beginImport()}
                  onConnect={beginConnect}
                  trailing={
                    REGISTRY_LABEL[registry] && (
                      <span
                        className="ml-auto font-mono text-chrome-micro"
                        style={{ color: HUD.textDim }}
                      >
                        {REGISTRY_LABEL[registry]}
                      </span>
                    )
                  }
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {/* The connect route's own surface. A connection hands the Agent up and
          leaves the chooser closed, because the operator is done choosing;
          any other exit returns them to the chooser they came from. */}
      <ConnectSourceDialog
        open={connectOpen}
        onOpenChange={(next: boolean) => {
          setConnectOpen(next);
          if (!next && !connectSucceeded.current) onOpenChange(true);
        }}
        projects={connectProjectOptions}
        onConnected={(result: ConnectSourceResult) => {
          connectSucceeded.current = true;
          setConnectOpen(false);
          onAgentSourceConnected?.(result);
        }}
      />
    </>
  );
}
