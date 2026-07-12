'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HUD } from '@/components/hud';
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

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCandidates(null);
      setError(null);
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
  }, [open]);

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

  const choose = async (project: ProjectLibraryEntry) => {
    let dir = project.dir;
    const exists = await window.electron?.dialog?.pathExists(dir);
    if (exists === false) {
      const picked = await window.electron?.dialog?.openDirectory(
        `Locate ${project.name}`
      );
      if (!picked) return;
      const resolved = await window.electron?.projects?.resolve(picked);
      if (!resolved) return;
      if (!resolved.ok) {
        setError(resolved.error);
        return;
      }
      dir = resolved.projectDir;
      if (project.registryId) {
        await rebindProjectPath(project.registryId, dir).catch(() => {});
      }
    }
    if (await onOpenProject(dir)) onOpenChange(false);
  };

  const browse = async () => {
    const picked = await window.electron?.dialog?.openDirectory('Open Project');
    if (picked && (await onOpenProject(picked))) onOpenChange(false);
  };

  const beginImport = async () => {
    const root = await window.electron?.dialog?.openDirectory(
      'Choose a folder containing Projects'
    );
    if (!root) return;
    setLoading(true);
    setError(null);
    const result = await window.electron?.projects?.scanDirectory(root);
    setLoading(false);
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
  };

  const finishImport = async () => {
    if (selected.size === 0) return;
    if (await onImportProjects([...selected])) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-project-opener
        className="max-h-[min(760px,calc(100vh-3rem))] w-[min(820px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-md border p-0"
        style={{
          background: HUD.bg.deep,
          borderColor: 'rgba(80,230,255,0.25)',
        }}
      >
        <DialogHeader
          className="gap-1 border-b px-5 py-4 pr-12"
          style={{ borderColor: 'rgba(80,230,255,0.14)' }}
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
                        className="flex min-w-0 items-center gap-3 rounded px-3 py-2 text-left outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-hud-cyan"
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
                            className="block truncate font-mono text-[10px]"
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
              style={{ borderColor: 'rgba(80,230,255,0.14)' }}
            >
              <button
                type="button"
                onClick={() => {
                  setCandidates(null);
                  setError(null);
                }}
                className="inline-flex h-8 items-center gap-2 rounded px-2 font-mono text-xs outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{ color: HUD.textDim }}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => void finishImport()}
                className="h-8 rounded border px-3 font-mono text-xs outline-none disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{
                  color: HUD.text,
                  borderColor: 'rgba(25,230,255,0.45)',
                  background: 'rgba(25,230,255,0.09)',
                }}
              >
                Import {selected.size || ''}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className="border-b px-4 py-3"
              style={{ borderColor: 'rgba(80,230,255,0.1)' }}
            >
              <label
                className="flex h-9 items-center gap-2 rounded border px-3"
                style={{
                  borderColor: 'rgba(80,230,255,0.2)',
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
                      className="group min-w-0 rounded-md border p-3 text-left outline-none transition-colors hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                      style={{
                        borderColor: 'rgba(138,160,190,0.18)',
                        background: 'rgba(8,13,22,0.7)',
                      }}
                    >
                      <span
                        className="mb-5 block h-3 w-3 rotate-45"
                        style={{
                          background: project.color ?? HUD.textDim,
                          boxShadow: `0 0 8px ${project.color ?? HUD.textDim}66`,
                        }}
                      />
                      <span
                        className="block truncate text-sm font-medium"
                        style={{ color: HUD.text }}
                      >
                        {project.name}
                      </span>
                      <span
                        className="mt-1 block truncate font-mono text-[10px]"
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
              style={{ borderColor: 'rgba(80,230,255,0.14)' }}
            >
              <button
                type="button"
                onClick={() => void browse()}
                className="inline-flex h-8 items-center gap-2 rounded border px-3 font-mono text-xs outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{
                  color: HUD.text,
                  borderColor: 'rgba(80,230,255,0.25)',
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" /> Browse Folder
              </button>
              <button
                type="button"
                onClick={() => void beginImport()}
                className="inline-flex h-8 items-center gap-2 rounded px-3 font-mono text-xs outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{ color: HUD.textDim }}
              >
                <FolderInput className="h-3.5 w-3.5" /> Import Folder
              </button>
              {syncUnavailable && (
                <span
                  className="ml-auto font-mono text-[10px]"
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
