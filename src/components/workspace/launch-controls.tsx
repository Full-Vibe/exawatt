import { useEffect, useRef, useState } from 'react';
import { GitBranch, Play, Settings2, SquareTerminal } from 'lucide-react';
import { HUD } from '@/components/hud';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
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
  rememberAgentPermissionMode,
  rememberAgentSource,
  type AgentSourcePreferenceState,
  type AgentSourceId,
} from './agent-sources';
import { HarnessGlyph } from './harness-icons';
import type { LaunchOptions } from './use-workspace-state';
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
  const [worktree, setWorktree] = useState(false);
  const [branch, setBranch] = useState(defaultBranch);
  const [roadmapItemId, setRoadmapItemId] = useState('');
  const [starting, setStarting] = useState(false);
  const branchEditSeq = useRef(0);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const effectiveSource = isAgentSourceId(source)
    ? source
    : AGENT_SOURCE_ORDER[0];
  const sourceMeta = AGENT_SOURCE_META[effectiveSource];
  const permissionMeta = AGENT_PERMISSION_MODE_META[permissionMode];

  useEffect(() => {
    let cancelled = false;
    setSourcePreferences(null);
    setPermissionMode(DEFAULT_AGENT_PERMISSION_MODE);
    void loadAgentSourcePreferences().then(preferences => {
      if (cancelled) return;
      const recommendedSource = recommendAgentSource(preferences, projectDir);
      setSourcePreferences(preferences);
      setSource(recommendedSource);
      setPermissionMode(
        permissionModeFor(preferences, projectDir, recommendedSource)
      );
    });
    setTask('');
    setRoadmapItemId('');
    return () => {
      cancelled = true;
    };
  }, [projectDir]);

  useEffect(() => {
    const focus = (sourceOverride?: AgentSourceId | null) => {
      if (sourceOverride) setSource(sourceOverride);
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
  }, []);

  useEffect(() => {
    if (
      roadmapItemId &&
      !roadmapItems.some(item => item.id === roadmapItemId)
    ) {
      setRoadmapItemId('');
    }
  }, [roadmapItems, roadmapItemId]);

  const launchAgent = async () => {
    if (starting) return;
    setStarting(true);
    const branchSeqAtLaunch = branchEditSeq.current;
    const ok = await onLaunch({
      harness: effectiveSource,
      dir: projectDir,
      permissionMode,
      initialPrompt: task.trim() || undefined,
      worktreeBranch: worktree ? branch.trim() : undefined,
      roadmapItemId: roadmapItemId || undefined,
    });
    setStarting(false);
    if (!ok) return;
    await rememberAgentSource(projectDir, effectiveSource);
    await rememberAgentPermissionMode(
      projectDir,
      effectiveSource,
      permissionMode
    );
    setSourcePreferences(current => {
      if (!current) return current;
      return {
        ...current,
        projectPermissionModes: {
          ...current.projectPermissionModes,
          [projectDir]: {
            ...current.projectPermissionModes[projectDir],
            [effectiveSource]: permissionMode,
          },
        },
      };
    });
    setTask('');
    if (worktree && branchEditSeq.current === branchSeqAtLaunch) {
      setBranch(defaultBranch());
    }
  };

  const openShell = async () => {
    if (starting) return;
    setStarting(true);
    await onLaunch({ harness: 'shell', dir: projectDir });
    setStarting(false);
  };

  const controls = (
    <form
      data-agent-composer
      data-variant={variant}
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
        onChange={event => setTask(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void launchAgent();
          }
        }}
        placeholder="What should this Agent do?"
        aria-label="Initial task for the new Agent"
        className="min-h-9 min-w-32 flex-1 resize-none rounded border bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{
          color: HUD.text,
          borderColor: 'rgba(80,230,255,0.24)',
          background: 'rgba(8,13,22,0.78)',
        }}
      />

      <Select
        value={effectiveSource}
        onValueChange={value => {
          if (!isAgentSourceId(value)) return;
          setSource(value);
          setPermissionMode(
            sourcePreferences
              ? permissionModeFor(sourcePreferences, projectDir, value)
              : DEFAULT_AGENT_PERMISSION_MODE
          );
        }}
      >
        <SelectTrigger
          aria-label="Agent Source"
          className="h-9 w-[148px] shrink-0 rounded border px-2 font-mono text-xs shadow-none"
          style={{
            color: sourceMeta.color,
            borderColor: 'rgba(80,230,255,0.24)',
            background: HUD.bg.deep,
          }}
        >
          <span className="flex min-w-0 items-center gap-2">
            <HarnessGlyph harness={effectiveSource} size={13} />
            <SelectValue />
          </span>
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
        onValueChange={value => {
          if (isAgentPermissionMode(value)) setPermissionMode(value);
        }}
      >
        <SelectTrigger
          aria-label="Agent permissions"
          title={`${permissionMeta.label}: ${permissionMeta.description}`}
          className="h-9 w-[80px] shrink-0 rounded border px-2 font-mono text-xs shadow-none"
          style={{
            color:
              permissionMode === 'unrestricted'
                ? HUD.amber
                : permissionMode === 'auto'
                  ? HUD.green
                  : HUD.textDim,
            borderColor:
              permissionMode === 'unrestricted'
                ? `${HUD.amber}66`
                : 'rgba(80,230,255,0.24)',
            background: HUD.bg.deep,
          }}
        >
          <SelectValue>{permissionMeta.shortLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {sourceMeta.capabilities.permissionModes
            .filter(mode => AGENT_PERMISSION_MODE_ORDER.includes(mode))
            .map(mode => (
              <SelectItem key={mode} value={mode}>
                {AGENT_PERMISSION_MODE_META[mode].label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Agent launch options"
            title="Agent launch options"
            className="grid h-9 w-9 shrink-0 place-items-center rounded border outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-hud-cyan"
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
              className="mt-2 h-8 w-full rounded border bg-transparent px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: HUD.cyan, borderColor: 'rgba(25,230,255,0.3)' }}
            />
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
        disabled={starting}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded border px-3 font-mono text-xs outline-none disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{
          color: HUD.text,
          borderColor: `${sourceMeta.color}77`,
          background: `${sourceMeta.color}12`,
        }}
      >
        <Play className="h-3.5 w-3.5" />
        Start
      </button>

      <button
        type="button"
        disabled={starting}
        onClick={() => void openShell()}
        aria-label={`Open shell in ${projectName}`}
        title="Open shell"
        className="grid h-9 w-9 shrink-0 place-items-center rounded outline-none hover:bg-white/5 disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{ color: HUD.textDim }}
      >
        <SquareTerminal className="h-4 w-4" />
      </button>
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
