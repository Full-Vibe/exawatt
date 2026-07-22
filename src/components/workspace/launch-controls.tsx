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
import { Button } from '@/components/ui/button';
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
import type { RecentConversation } from '@/types/electron';
import {
  consumePendingAgentComposer,
  FOCUS_AGENT_COMPOSER_EVENT,
} from './session-jump';
import {
  RecentConversations,
  type ConversationOpenMode,
  type RecentConversationsHandle,
} from './recent-conversations';

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

export function freshConversationPrompt(
  conversation: Pick<
    RecentConversation,
    'harness' | 'id' | 'title' | 'description' | 'continuation'
  >
): string {
  const source = AGENT_SOURCE_META[conversation.harness].label;
  const handoff = conversation.description ?? conversation.title;
  const priorIdentity =
    conversation.continuation.kind === 'exawatt-session'
      ? `Previous Exawatt Session: ${conversation.continuation.durableSessionId}`
      : `Previous ${source} conversation: ${conversation.id}`;
  return [
    `Continue this work in a fresh Agent session.`,
    priorIdentity,
    `Handoff: ${handoff}`,
    `Inspect the current Project state, then pick up the work from this handoff.`,
  ].join('\n\n');
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
  initialSource,
  initialTask,
  roadmapItems = [],

  onLaunch,
  onReopenConversation,
  onDraftChange,
}: {
  projectDir: string;
  projectName: string;
  /** the summon's requested source (palette "Start Agent with X"),
   *  carried on the draft tab (D24) — beats the recommendation */
  initialSource?: AgentSourceId;
  /** the draft tab's saved task text (D28) — a remounting pane must pick
   *  the operator's typing back up, never blank it */
  initialTask?: string;
  roadmapItems?: LaunchRoadmapItem[];

  onLaunch: (opts: LaunchOptions) => Promise<boolean>;
  /** Project-ledger recents restore their logical Session and retained
   * terminal history instead of spawning a second provider process. */
  onReopenConversation?: (durableSessionId: string) => Promise<boolean>;
  /** draft tabs (D28): the tab owns the work-in-progress — every task or
   *  source edit reports up so it survives this pane unmounting */
  onDraftChange?: (patch: {
    draftTask?: string;
    draftSource?: AgentSourceId;
  }) => void;
}) {
  const [task, setTaskState] = useState(initialTask ?? '');
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const initialTaskRef = useRef(initialTask);
  initialTaskRef.current = initialTask;
  const setTask = useCallback((next: string) => {
    setTaskState(next);
    onDraftChangeRef.current?.({ draftTask: next });
  }, []);
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
  // D24: the composer IS the pane of a draft tab (or an empty Project) —
  // always open; ⌘T creates/selects the draft tab that hosts it.
  const branchEditSeq = useRef(0);
  const permissionSaveSeq = useRef(0);
  const permissionSaveQueue = useRef(Promise.resolve());
  const requestedSourceRef = useRef<AgentSourceId | null>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const recentRef = useRef<RecentConversationsHandle>(null);
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
    // a (re)mount or Project change is not an operator edit: restore the
    // tab's saved draft directly instead of reporting a blank up (D28)
    setTaskState(initialTaskRef.current ?? '');
    setRoadmapItemId('');
    return () => {
      cancelled = true;
    };
  }, [projectDir]);

  // the requested source must survive the preferences effect's reset —
  // declared after it so a strict-mode remount replays them in order
  useEffect(() => {
    if (initialSource) chooseSourceRef.current?.(initialSource);
  }, [initialSource]);

  const selectSource = useCallback(
    (nextSource: AgentSourceId) => {
      setSource(nextSource);
      onDraftChangeRef.current?.({ draftSource: nextSource });
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

  /** Choose a source whether or not preferences have resolved yet: the
   *  pre-resolution pick is remembered and wins over the recommendation. */
  const chooseSource = useCallback(
    (next: AgentSourceId) => {
      if (sourcePreferences) selectSource(next);
      else {
        requestedSourceRef.current = next;
        setSource(next);
        onDraftChangeRef.current?.({ draftSource: next });
      }
    },
    [selectSource, sourcePreferences]
  );
  const chooseSourceRef = useRef<typeof chooseSource | null>(null);
  chooseSourceRef.current = chooseSource;

  // ⌘T must land in the goal field every time (D21): focus after mount —
  // the draft pane mounts fresh on every summon
  useEffect(() => {
    const frame = requestAnimationFrame(() => taskRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const focus = (sourceOverride?: AgentSourceId | null) => {
      if (sourceOverride) chooseSource(sourceOverride);
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
  }, [chooseSource]);

  useEffect(() => {
    if (
      roadmapItemId &&
      !roadmapItems.some(item => item.id === roadmapItemId)
    ) {
      setRoadmapItemId('');
    }
  }, [roadmapItems, roadmapItemId]);

  /** insert pasted content at the caret, keeping focus and selection */
  const insertAtCursor = useCallback(
    (value: string) => {
      const el = taskRef.current;
      const start = el?.selectionStart ?? task.length;
      const end = el?.selectionEnd ?? task.length;
      setTask(task.slice(0, start) + value + task.slice(end));
      requestAnimationFrame(() => {
        const node = taskRef.current;
        if (!node) return;
        node.focus();
        const caret = start + value.length;
        node.setSelectionRange(caret, caret);
      });
    },
    [task, setTask]
  );

  /** ⌘V/⌃V (D24): an image saves to a temp file and its path joins the
   *  task — the same shape the coding harnesses accept in a prompt */
  const pasteFromClipboard = useCallback(async () => {
    const clip = await window.electron?.pty?.clipboardRead?.();
    if (!clip) return;
    if (clip.kind === 'image' && clip.path) {
      insertAtCursor(`${clip.path} `);
    } else if (clip.kind === 'text' && clip.text) {
      insertAtCursor(clip.text);
    }
  }, [insertAtCursor]);

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

  const openRecentConversation = async (
    conversation: RecentConversation,
    mode: ConversationOpenMode
  ): Promise<boolean> => {
    if (controlsDisabled) return false;
    const reopenSessionId =
      mode === 'resume' && conversation.continuation.kind === 'exawatt-session'
        ? conversation.continuation.durableSessionId
        : null;
    let permissionToPersist: AgentPermissionMode | null = null;
    let continueConversation: (() => Promise<boolean>) | null = null;
    if (reopenSessionId) {
      if (!onReopenConversation) return false;
      continueConversation = () => onReopenConversation(reopenSessionId);
    } else {
      if (!sourcePreferences) return false;
      permissionToPersist = permissionModeFor(
        sourcePreferences,
        projectDir,
        conversation.harness,
        usedSafePreferenceFallback ? 'prompt' : DEFAULT_AGENT_PERMISSION_MODE
      );
      const launchOptions: LaunchOptions = {
        harness: conversation.harness,
        dir: projectDir,
        permissionMode: permissionToPersist,
        ...(mode === 'resume'
          ? {
              resumeSessionId: conversation.id,
              statedTask: conversation.description ?? conversation.title,
              ...(conversation.titleSource === 'generated'
                ? { restoredSubtitle: conversation.title }
                : {}),
            }
          : { initialPrompt: freshConversationPrompt(conversation) }),
      };
      continueConversation = () => onLaunch(launchOptions);
    }
    setLaunching('agent');
    let ok = false;
    try {
      ok = await continueConversation();
    } catch {
      ok = false;
    } finally {
      setLaunching(null);
    }
    if (ok) {
      void rememberAgentSource(projectDir, conversation.harness);
      if (permissionToPersist) {
        void persistPermissionMode(conversation.harness, permissionToPersist);
      }
      setTask('');
    }
    return ok;
  };

  const controls = (
    <form
      data-agent-composer
      data-preferences-ready={preferencesReady}
      aria-busy={launching !== null}
      onSubmit={event => {
        event.preventDefault();
        void launchAgent();
      }}
      className="flex w-full min-w-0 flex-col gap-1.5"
    >
      <textarea
        ref={taskRef}
        rows={1}
        value={task}
        maxLength={8_000}
        disabled={controlsDisabled}
        onChange={event => setTask(event.target.value)}
        // image paste (D24): ⌘V catches images via the paste event; ⌃V is
        // the coding-harness muscle memory and works the same way
        onPaste={event => {
          const hasImage = Array.from(event.clipboardData?.items ?? []).some(
            item => item.kind === 'file' && item.type.startsWith('image/')
          );
          if (hasImage) {
            event.preventDefault();
            void pasteFromClipboard();
          }
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (
            event.key === 'v' &&
            event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            event.preventDefault();
            void pasteFromClipboard();
            return;
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void launchAgent();
            return;
          }
          // The empty composer opens into local history with ↓. Source
          // cycling keeps a distinct Option+arrow chord so both paths stay
          // fully keyboard reachable and unambiguous.
          if (
            (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
            task === '' &&
            event.altKey
          ) {
            event.preventDefault();
            const order = AGENT_SOURCE_ORDER;
            const index = order.indexOf(effectiveSource);
            const step = event.key === 'ArrowDown' ? 1 : order.length - 1;
            chooseSource(order[(index + step) % order.length]);
            return;
          }
          if (event.key === 'ArrowDown' && task === '') {
            if (recentRef.current?.focusFirst()) event.preventDefault();
          }
        }}
        placeholder="What should this Agent do?"
        aria-label="Initial task for the new Agent"
        className="max-h-40 min-h-9 w-full resize-none rounded border bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none transition-colors [field-sizing:content] placeholder:text-hud-text-dim/80 hover:border-hud-cyan/40 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        style={{
          color: HUD.text,
          borderColor: 'rgba(80,230,255,0.24)',
          background: 'rgba(8,13,22,0.78)',
        }}
      />

      <div className="flex min-w-0 items-center gap-1">
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
                {/* The trigger owns its one brand glyph. An empty SelectValue
                  projects the selected item's decorated children here, which
                  would duplicate the option glyph (D27 correction). */}
                <SelectValue>{sourceMeta.label}</SelectValue>
              </span>
            ) : (
              <span className="truncate" style={{ color: HUD.textDim }}>
                Loading…
              </span>
            )}
          </SelectTrigger>
          <SelectContent>
            {AGENT_SOURCE_ORDER.map(id => (
              <SelectItem
                key={id}
                value={id}
                textValue={AGENT_SOURCE_META[id].label}
                className="font-mono"
              >
                {/* Options own their menu presentation independently of the
                  trigger: glyph + brand color, with no selection flash. */}
                <span
                  className="flex items-center gap-2"
                  style={{ color: AGENT_SOURCE_META[id].color }}
                >
                  <HarnessGlyph harness={id} size={12} />
                  {AGENT_SOURCE_META[id].label}
                </span>
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
              <SelectLabel className="px-2 pb-1 pt-2 font-mono text-[11px] font-medium text-hud-text-dim">
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

        <span className="flex-1" />
        {/* one button system (D32): the primary action wears the system
            accent, never the harness color */}
        <Button
          type="submit"
          size="sm"
          className="h-9 shrink-0 font-mono"
          disabled={controlsDisabled || !preferencesReady || !branchReady}
          title={
            preferencesReady
              ? `Start ${sourceMeta.label} with ${permissionMeta.label} permissions`
              : 'Loading launch preferences'
          }
        >
          {launching === 'agent' ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {launching === 'agent' ? 'Starting…' : 'Start'}
        </Button>

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
      </div>
      {/* the keyboard grammar teaches itself (D21): ⌘T is a complete
          keyboard path, so its keys are visible where they apply */}
      <p
        data-composer-hints
        aria-hidden="true"
        className="px-0.5 pt-0.5 font-mono text-[10px] leading-none"
        style={{ color: HUD.textDim }}
      >
        ⏎ start · ↓ recent · ⌥↑↓ source · ⌘V image · ⇧⏎ newline
      </p>
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

  return (
    <div className="flex w-full flex-col items-center px-5 sm:px-7">
      <div className="w-full max-w-3xl text-left">
        <p
          className="font-display text-lg font-semibold tracking-tight"
          style={{ color: HUD.text }}
        >
          {projectName}
        </p>
        <p className="mt-1 font-mono text-xs" style={{ color: HUD.textDim }}>
          New Agent
        </p>
      </div>
      <div className="mt-3 w-full max-w-3xl">
        {controls}
        <RecentConversations
          ref={recentRef}
          projectDir={projectDir}
          hidden={task.trim().length > 0}
          disabled={controlsDisabled || !preferencesReady}
          onOpen={openRecentConversation}
          onReturnToComposer={() => taskRef.current?.focus()}
        />
      </div>
    </div>
  );
}
