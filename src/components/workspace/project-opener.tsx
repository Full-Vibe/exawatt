'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPrimaryActionHint,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from './workspace-theme';
import { listProjects, rebindProjectPath } from '@/lib/projects/registry';
import { extractRecentProjects } from './switcher-rows';
import {
  mergeProjectLibrary,
  type ProjectLibraryEntry,
  type WorkspaceProjectSummary,
} from './project-library';
import type { ProjectImportCandidate } from '@/types/electron';
import {
  ArrowLeft,
  Check,
  FolderInput,
  FolderOpen,
  Search,
} from 'lucide-react';

export function ProjectOpener({
  open,
  onOpenChange,
  workspaceProjects,
  onOpenProject,
  onImportProjects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceProjects: WorkspaceProjectSummary[];
  onOpenProject: (dir: string) => Promise<boolean>;
  onImportProjects: (dirs: string[]) => Promise<boolean>;
}) {
  const [synced, setSynced] = useState<
    Awaited<ReturnType<typeof listProjects>>
  >([]);
  const [recents, setRecents] = useState<
    ReturnType<typeof extractRecentProjects>
  >([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncUnavailable, setSyncUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ProjectImportCandidate[] | null>(
    null
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nativePicker, setNativePicker] = useState<
    'browse' | 'import' | 'locate' | null
  >(null);
  const nativePickerActive = useRef(false);
  const releaseNativePicker = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      // A native picker temporarily replaces this modal. Preserve its state
      // while control belongs to the OS so cancel/error can return the user to
      // exactly the chooser they left.
      if (!nativePicker) {
        setQuery('');
        setCandidates(null);
        setError(null);
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSyncUnavailable(false);
    void Promise.all([
      listProjects().catch(() => {
        if (!cancelled) setSyncUnavailable(true);
        return [];
      }),
      window.electron?.workspace?.load() ?? Promise.resolve(null),
    ]).then(([projects, layout]) => {
      if (cancelled) return;
      setSynced(projects);
      setRecents(extractRecentProjects(layout));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, nativePicker]);

  const projects = useMemo(() => {
    const library = mergeProjectLibrary(synced, workspaceProjects, recents);
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? library.filter(project =>
          `${project.name} ${project.dir}`
            .toLocaleLowerCase()
            .includes(normalized)
        )
      : library;
  }, [synced, workspaceProjects, recents, query]);

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

  const choose = async (project: ProjectLibraryEntry) => {
    let dir = project.dir;
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
        opened = await onOpenProject(dir);
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
      if (await onOpenProject(dir)) onOpenChange(false);
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
      opened = await onOpenProject(pick.path);
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
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron?.projects?.scanDirectory(pick.path);
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
      finishDirectoryPick(true);
    }
  };

  const finishImport = async () => {
    if (selected.size === 0) return;
    if (await onImportProjects([...selected])) onOpenChange(false);
  };

  return (
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
        className="max-h-[min(760px,calc(100vh-3rem))] w-[min(820px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-md border p-0"
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
          <div className="flex min-h-0 flex-1 flex-col">
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
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
                  style={{ color: HUD.text }}
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading ? (
                <p
                  className="py-12 text-center font-mono text-sm"
                  style={{ color: HUD.textDim }}
                >
                  Loading Projects...
                </p>
              ) : projects.length === 0 ? (
                <p
                  className="py-12 text-center font-mono text-sm"
                  style={{ color: HUD.textDim }}
                >
                  {query ? 'No matching Projects.' : 'No Projects yet.'}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {projects.map(project => (
                    <button
                      key={project.dir}
                      type="button"
                      onClick={() => void choose(project)}
                      className="group min-w-0 rounded-md border p-3 text-left outline-none transition-colors hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
                      style={{
                        borderColor: HUD.strokeFaint,
                        background: HUD.surfaceInputSoft,
                      }}
                    >
                      <span
                        className="mb-5 block h-5 w-[3px] rounded-full"
                        style={{
                          background: project.color ?? HUD.textDim,
                          boxShadow: `0 0 8px ${withThemeAlpha(project.color ?? HUD.textDim, 0.4)}`,
                        }}
                      />
                      <span
                        className="block truncate text-sm font-medium"
                        style={{ color: HUD.text }}
                      >
                        {project.name}
                      </span>
                      <span
                        className="mt-1 block truncate font-mono text-chrome-micro"
                        style={{ color: HUD.textDim }}
                      >
                        {project.dir}
                      </span>
                    </button>
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
              className="flex items-center gap-2 border-t px-4 py-3"
              style={{ borderColor: HUD.strokeFaint }}
            >
              <button
                type="button"
                disabled={nativePicker !== null}
                onClick={() => void browse()}
                className="inline-flex h-8 items-center gap-2 rounded border px-3 font-mono text-xs outline-none hover:bg-hud-fill disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{
                  color: HUD.text,
                  borderColor: HUD.strokeSoft,
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" /> Browse Folder
              </button>
              <button
                type="button"
                disabled={nativePicker !== null}
                onClick={() => void beginImport()}
                className="inline-flex h-8 items-center gap-2 rounded px-3 font-mono text-xs outline-none hover:bg-hud-fill disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{ color: HUD.textDim }}
              >
                <FolderInput className="h-3.5 w-3.5" /> Import Folder
              </button>
              {syncUnavailable && (
                <span
                  className="ml-auto font-mono text-chrome-micro"
                  style={{ color: HUD.textDim }}
                >
                  Local Projects
                </span>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
