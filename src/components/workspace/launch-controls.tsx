import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  GitBranch,
  LoaderCircle,
  Play,
  Settings2,
  ShieldCheck,
  ShieldQuestion,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react';
import { HUD } from '@/components/hud';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AGENT_SOURCE_META,
  AGENT_SOURCE_ORDER,
  AGENT_PERMISSION_MODE_META,
  AGENT_PERMISSION_MODE_ORDER,
  DEFAULT_AGENT_PERMISSION_MODE,
  isAgentSourceId,
  isAgentPermissionMode,
  loadAgentSourcePreferences,
  permissionModeFor,
  recommendAgentSource,
  recordAgentPermissionMode,
  rememberAgentPermissionMode,
  rememberAgentSource,
  type AgentSourcePreferenceState,
  type AgentSourceId,
} from './agent-sources';
import { HarnessGlyph } from './harness-icons';
import type { LaunchOptions } from './use-workspace-state';
import type { AgentPermissionMode } from '@/types/electron';
import {
  consumePendingAgentComposer,
  FOCUS_AGENT_COMPOSER_EVENT,
} from './session-jump';

function defaultBranch(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `agent/${mm}${dd}-${hh}${mi}`;
}

export interface LaunchRoadmapItem {
  id: string;
  label: string;
}

function PermissionModeIcon({
  mode,
  className,
}: {
  mode: AgentPermissionMode;
  className?: string;
}) {
  if (mode === 'prompt') return <ShieldQuestion className={className} />;
  if (mode === 'auto') return <ShieldCheck className={className} />;
  return <TriangleAlert className={className} />;
}

export function AgentComposer({
  projectDir,
  projectName,
  roadmapItems = [],
  variant = 'compact',
  onLaunch,
}: {
  projectDir: string;
  projectName: string;
  roadmapItems?: LaunchRoadmapItem[];
  variant?: 'compact' | 'empty';
  onLaunch: (opts: LaunchOptions) => Promise<boolean>;
}) {
  const [task, setTask] = useState('');
  const [source, setSource] = useState<AgentSourceId>('claude');
  const [permissionMode, setPermissionMode] = useState(
    DEFAULT_AGENT_PERMISSION_MODE
  );
  const [sourcePreferences, setSourcePreferences] =
    useState<AgentSourcePreferenceState | null>(null);
  const [usedSafePreferenceFallback, setUsedSafePreferenceFallback] =
    useState(false);
  const [permissionSaveState, setPermissionSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'failed'
  >('idle');
  const [worktree, setWorktree] = useState(false);
  const [branch, setBranch] = useState(defaultBranch);
  const [roadmapItemId, setRoadmapItemId] = useState('');
  const [launching, setLaunching] = useState<'agent' | 'shell' | null>(null);
  const branchEditSeq = useRef(0);
  const permissionSaveSeq = useRef(0);
  const permissionSaveQueue = useRef(Promise.resolve());
  const requestedSourceRef = useRef<AgentSourceId | null>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const permissionDescriptionId = useId();
  const branchErrorId = useId();
  const preferencesReady = sourcePreferences !== null;
  const controlsDisabled = launching !== null;
  const branchReady = !worktree || branch.trim().length > 0;
  const effectiveSource = isAgentSourceId(source)
    ? source
    : AGENT_SOURCE_ORDER[0];
  const sourceMeta = AGENT_SOURCE_META[effectiveSource];
  const permissionMeta = AGENT_PERMISSION_MODE_META[permissionMode];
  const permissionColor =
    permissionMode === 'unrestricted'
      ? HUD.amber
      : permissionMode === 'auto'
        ? HUD.green
        : HUD.textDim;

  useEffect(() => {
    let cancelled = false;
    permissionSaveSeq.current += 1;
    requestedSourceRef.current = null;
    setSourcePreferences(null);
    setPermissionMode(DEFAULT_AGENT_PERMISSION_MODE);
    setUsedSafePreferenceFallback(false);
    setPermissionSaveState('idle');
    void loadAgentSourcePreferences().then(result => {
      if (cancelled) return;
      const { preferences, usedSafeFallback } = result;
      const recommendedSource = recommendAgentSource(preferences, projectDir);
      const selectedSource = requestedSourceRef.current ?? recommendedSource;
      setSourcePreferences(preferences);
      setUsedSafePreferenceFallback(usedSafeFallback);
      setSource(selectedSource);
      setPermissionMode(
        permissionModeFor(
          preferences,
          projectDir,
          selectedSource,
          usedSafeFallback ? 'prompt' : DEFAULT_AGENT_PERMISSION_MODE
        )
      );
      requestedSourceRef.current = null;
    });
    setTask('');
    setRoadmapItemId('');
    return () => {
      cancelled = true;
    };
  }, [projectDir]);

  const selectSource = useCallback(
    (nextSource: AgentSourceId) => {
      setSource(nextSource);
      setPermissionSaveState('idle');
      setPermissionMode(
        sourcePreferences
          ? permissionModeFor(
              sourcePreferences,
              projectDir,
              nextSource,
              usedSafePreferenceFallback
                ? 'prompt'
                : DEFAULT_AGENT_PERMISSION_MODE
            )
          : DEFAULT_AGENT_PERMISSION_MODE
      );
    },
    [projectDir, sourcePreferences, usedSafePreferenceFallback]
  );

  useEffect(() => {
    const focus = (sourceOverride?: AgentSourceId | null) => {
      if (sourceOverride) {
        if (sourcePreferences) selectSource(sourceOverride);
        else {
          requestedSourceRef.current = sourceOverride;
          setSource(sourceOverride);
        }
      }
      requestAnimationFrame(() => taskRef.current?.focus());
    };
    const onFocus = (event: Event) => {
      consumePendingAgentComposer();
      focus((event as CustomEvent<AgentSourceId | null>).detail);
    };
    window.addEventListener(FOCUS_AGENT_COMPOSER_EVENT, onFocus);
    const pending = consumePendingAgentComposer();
    if (pending !== undefined) focus(pending);
    return () =>
      window.removeEventListener(FOCUS_AGENT_COMPOSER_EVENT, onFocus);
  }, [selectSource, sourcePreferences]);

  useEffect(() => {
    if (
      roadmapItemId &&
      !roadmapItems.some(item => item.id === roadmapItemId)
    ) {
      setRoadmapItemId('');
    }
  }, [roadmapItems, roadmapItemId]);

  const persistPermissionMode = useCallback(
    async (nextSource: AgentSourceId, nextMode: AgentPermissionMode) => {
      const saveSeq = permissionSaveSeq.current + 1;
      permissionSaveSeq.current = saveSeq;
      setPermissionSaveState('saving');
      const save = permissionSaveQueue.current.then(() =>
        rememberAgentPermissionMode(projectDir, nextSource, nextMode)
      );
      permissionSaveQueue.current = save.then(
        () => undefined,
        () => undefined
      );
      const saved = await save;
      if (permissionSaveSeq.current !== saveSeq) return;
      setPermissionSaveState(saved ? 'saved' : 'failed');
    },
    [projectDir]
  );

  const launchAgent = async () => {
    if (controlsDisabled || !sourcePreferences || !branchReady) return;
    setLaunching('agent');
    const branchSeqAtLaunch = branchEditSeq.current;
    let ok = false;
    try {
      ok = await onLaunch({
        harness: effectiveSource,
        dir: projectDir,
        permissionMode,
        initialPrompt: task.trim() || undefined,
        worktreeBranch: worktree ? branch.trim() : undefined,
        roadmapItemId: roadmapItemId || undefined,
      });
    } catch {
      ok = false;
    } finally {
      setLaunching(null);
    }
    if (!ok) return;
    void rememberAgentSource(projectDir, effectiveSource);
    void persistPermissionMode(effectiveSource, permissionMode);
    setTask('');
    if (worktree && branchEditSeq.current === branchSeqAtLaunch) {
      setBranch(defaultBranch());
    }
  };

  const openShell = async () => {
    if (controlsDisabled) return;
    setLaunching('shell');
    try {
      await onLaunch({ harness: 'shell', dir: projectDir });
    } catch {
      // The workspace-level launch owner surfaces the actionable error.
    } finally {
      setLaunching(null);
    }
  };

  const controls = (
    <form
      data-agent-composer
      data-variant={variant}
      data-preferences-ready={preferencesReady}
      aria-busy={launching !== null}
      onSubmit={event => {
        event.preventDefault();
        void launchAgent();
      }}
      className={`flex min-w-0 items-stretch gap-1 ${
        variant === 'empty' ? 'w-full max-w-2xl' : 'w-full max-w-3xl'
      }`}
    >
      <textarea
        ref={taskRef}
        rows={1}
        value={task}
        maxLength={8_000}
        disabled={controlsDisabled}
        onChange={event => setTask(event.target.value)}
        onKeyDown={event => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void launchAgent();
          }
        }}
        placeholder="What should this Agent do?"
        aria-label="Initial task for the new Agent"
        className="min-h-9 min-w-32 flex-1 resize-none rounded border bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none transition-colors placeholder:text-hud-text-dim/80 hover:border-hud-cyan/40 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        style={{
          color: HUD.text,
          borderColor: 'rgba(80,230,255,0.24)',
          background: 'rgba(8,13,22,0.78)',
        }}
      />

      <Select
        value={effectiveSource}
        disabled={!preferencesReady || controlsDisabled}
        onValueChange={value => {
          if (!isAgentSourceId(value)) return;
          selectSource(value);
        }}
      >
        <SelectTrigger
          aria-label="Agent Source"
          title={
            preferencesReady
              ? `Agent Source: ${sourceMeta.label}`
              : 'Loading Agent Source'
          }
          className="h-9 w-[148px] shrink-0 rounded border px-2 font-mono text-xs shadow-none transition-[border-color,filter] duration-150 hover:brightness-110 focus:ring-hud-cyan data-[state=open]:brightness-110 motion-reduce:transition-none"
          style={{
            color: sourceMeta.color,
            borderColor: 'rgba(80,230,255,0.24)',
            background: HUD.bg.deep,
          }}
        >
          {preferencesReady ? (
            <span className="flex min-w-0 items-center gap-2">
              <HarnessGlyph harness={effectiveSource} size={13} />
              <SelectValue />
            </span>
          ) : (
            <span className="truncate" style={{ color: HUD.textDim }}>
              Loading…
            </span>
          )}
        </SelectTrigger>
        <SelectContent>
          {AGENT_SOURCE_ORDER.map(id => (
            <SelectItem key={id} value={id}>
              {AGENT_SOURCE_META[id].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={permissionMode}
        disabled={!preferencesReady || controlsDisabled}
        onValueChange={value => {
          if (
            !isAgentPermissionMode(value) ||
            !sourceMeta.capabilities.permissionModes.includes(value)
          ) {
            return;
          }
          setPermissionMode(value);
          setSourcePreferences(current =>
            current
              ? recordAgentPermissionMode(
                  current,
                  projectDir,
                  effectiveSource,
                  value
                )
              : current
          );
          void persistPermissionMode(effectiveSource, value);
        }}
      >
        <SelectTrigger
          aria-label="Agent permissions"
          aria-describedby={permissionDescriptionId}
          title={
            preferencesReady
              ? `${permissionMeta.label}: ${permissionMeta.description}${
                  usedSafePreferenceFallback
                    ? ' Saved preferences were unavailable, so Exawatt used Ask first.'
                    : permissionSaveState === 'failed'
                      ? ' This choice applies now but could not be saved.'
                      : ''
                }`
              : 'Loading launch permissions'
          }
          className="h-9 w-[80px] shrink-0 rounded border px-2 font-mono text-xs shadow-none transition-[border-color,filter] duration-150 hover:brightness-110 focus:ring-hud-cyan data-[state=open]:brightness-110 motion-reduce:transition-none"
          style={{
            color: permissionColor,
            borderColor:
              permissionSaveState === 'failed'
                ? `${HUD.red}88`
                : permissionMode === 'unrestricted'
                  ? `${HUD.amber}66`
                  : 'rgba(80,230,255,0.24)',
            background: HUD.bg.deep,
          }}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {preferencesReady ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      permissionSaveState === 'failed'
                        ? HUD.red
                        : usedSafePreferenceFallback
                          ? HUD.amber
                          : permissionColor,
                  }}
                />
                <SelectValue>{permissionMeta.shortLabel}</SelectValue>
                <span id={permissionDescriptionId} className="sr-only">
                  {permissionMeta.description}
                  {usedSafePreferenceFallback
                    ? ' Saved preferences could not be loaded. Ask first is the safe fallback.'
                    : ''}
                  {permissionSaveState === 'failed'
                    ? ' This choice applies to the current launch but could not be saved.'
                    : ''}
                </span>
              </>
            ) : (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="h-3 w-3 animate-spin motion-reduce:animate-none"
                />
                <span>···</span>
                <span id={permissionDescriptionId} className="sr-only">
                  Loading saved launch permissions.
                </span>
              </>
            )}
          </span>
        </SelectTrigger>
        <SelectContent
          align="end"
          className="w-[min(22rem,calc(100vw-1.5rem))] border-hud-cyan/25 bg-hud-deep shadow-xl"
        >
          <SelectGroup>
            <SelectLabel className="px-2 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-hud-text-dim">
              {sourceMeta.label} permissions
            </SelectLabel>
            {sourceMeta.capabilities.permissionModes
              .filter(mode => AGENT_PERMISSION_MODE_ORDER.includes(mode))
              .map(mode => {
                const meta = AGENT_PERMISSION_MODE_META[mode];
                const color =
                  mode === 'unrestricted'
                    ? HUD.amber
                    : mode === 'auto'
                      ? HUD.green
                      : HUD.textDim;
                return (
                  <SelectItem
                    key={mode}
                    value={mode}
                    textValue={meta.label}
                    className="items-start py-2.5 pl-2 pr-8 font-mono [&>span:first-child]:top-3"
                  >
                    <span className="flex items-start gap-2.5">
                      <PermissionModeIcon
                        mode={mode}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span
                          className="text-xs font-semibold"
                          style={{ color }}
                        >
                          {meta.label}
                        </span>
                        <span className="text-[11px] leading-4 text-hud-text-dim">
                          {meta.description}
                        </span>
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
          </SelectGroup>
          <SelectSeparator className="bg-hud-cyan/15" />
          <div
            aria-live="polite"
            className="px-2 py-1.5 font-mono text-[11px] leading-4"
            style={{
              color:
                usedSafePreferenceFallback || permissionSaveState === 'failed'
                  ? HUD.amber
                  : HUD.textDim,
            }}
          >
            {usedSafePreferenceFallback
              ? 'Saved permissions were unavailable. Unsaved pairs use Ask first.'
              : permissionSaveState === 'failed'
                ? 'This choice applies now, but Exawatt could not save it.'
                : permissionSaveState === 'saving'
                  ? `Saving for ${projectName} + ${sourceMeta.label}…`
                  : `Changes are remembered for ${projectName} + ${sourceMeta.label}.`}
          </div>
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={controlsDisabled}
            aria-label="Agent launch options"
            title="Agent launch options"
            className="grid h-9 w-9 shrink-0 place-items-center rounded border outline-none transition-[filter,transform] duration-150 hover:brightness-125 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
            style={{
              color: worktree || roadmapItemId ? HUD.cyan : HUD.textDim,
              borderColor: 'rgba(80,230,255,0.24)',
            }}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 rounded-md border p-3"
          style={{
            background: HUD.bg.deep,
            borderColor: 'rgba(80,230,255,0.25)',
          }}
        >
          <label
            className="flex cursor-pointer items-center gap-2 font-mono text-xs"
            style={{ color: HUD.text }}
          >
            <input
              type="checkbox"
              checked={worktree}
              onChange={event => setWorktree(event.target.checked)}
              className="accent-cyan-400"
            />
            <GitBranch className="h-3.5 w-3.5" />
            New git worktree
          </label>
          {worktree && (
            <input
              value={branch}
              onChange={event => {
                branchEditSeq.current += 1;
                setBranch(event.target.value);
              }}
              aria-label="Branch name for the new worktree"
              aria-invalid={!branchReady}
              aria-describedby={branchReady ? undefined : branchErrorId}
              className="mt-2 h-8 w-full rounded border bg-transparent px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: HUD.cyan, borderColor: 'rgba(25,230,255,0.3)' }}
            />
          )}
          {worktree && !branchReady && (
            <p
              id={branchErrorId}
              className="mt-1 font-mono text-[10px]"
              style={{ color: HUD.red }}
            >
              Enter a branch name before starting.
            </p>
          )}
          {roadmapItems.length > 0 && (
            <label
              className="mt-3 block font-mono text-[10px]"
              style={{ color: HUD.textDim }}
            >
              Working on
              <select
                aria-label="Roadmap item this session will work on"
                value={roadmapItemId}
                onChange={event => setRoadmapItemId(event.target.value)}
                className="mt-1 h-8 w-full rounded border bg-transparent px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{
                  color: HUD.text,
                  borderColor: 'rgba(80,230,255,0.2)',
                  background: HUD.bg.deep,
                }}
              >
                <option value="">No roadmap link</option>
                {roadmapItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </PopoverContent>
      </Popover>

      <button
        type="submit"
        disabled={controlsDisabled || !preferencesReady || !branchReady}
        title={
          preferencesReady
            ? `Start ${sourceMeta.label} with ${permissionMeta.label} permissions`
            : 'Loading launch preferences'
        }
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded border px-3 font-mono text-xs outline-none transition-[filter,transform] duration-150 hover:brightness-125 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        style={{
          color: HUD.text,
          borderColor: `${sourceMeta.color}77`,
          background: `${sourceMeta.color}12`,
        }}
      >
        {launching === 'agent' ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {launching === 'agent' ? 'Starting…' : 'Start'}
      </button>

      <button
        type="button"
        disabled={controlsDisabled}
        onClick={() => void openShell()}
        aria-label={
          launching === 'shell'
            ? `Opening shell in ${projectName}`
            : `Open shell in ${projectName}`
        }
        title={launching === 'shell' ? 'Opening shell…' : 'Open shell'}
        className="grid h-9 w-9 shrink-0 place-items-center rounded outline-none transition-[filter,transform] duration-150 hover:brightness-125 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        style={{ color: HUD.textDim }}
      >
        {launching === 'shell' ? (
          <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <SquareTerminal className="h-4 w-4" />
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {launching === 'agent'
          ? `Starting ${sourceMeta.label} with ${permissionMeta.label} permissions.`
          : launching === 'shell'
            ? `Opening a shell in ${projectName}.`
            : permissionSaveState === 'failed'
              ? 'This permission choice applies now but could not be saved.'
              : ''}
      </span>
    </form>
  );

  if (variant === 'compact') return controls;
  return (
    <div className="flex w-full flex-col items-center gap-4 px-6">
      <div className="text-center">
        <p
          className="font-display text-lg font-semibold"
          style={{ color: HUD.text }}
        >
          {projectName}
        </p>
        <p className="mt-1 font-mono text-xs" style={{ color: HUD.textDim }}>
          No Agents running
        </p>
      </div>
      {controls}
    </div>
  );
}
