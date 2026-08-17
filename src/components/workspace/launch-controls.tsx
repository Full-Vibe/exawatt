import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import {
  GitBranch,
  ExternalLink,
  MoreHorizontal,
  Pin,
  PinOff,
  Save,
} from 'lucide-react';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from './workspace-theme';
import { Button } from '@/components/ui/button';
import {
  AGENT_SOURCE_META,
  AGENT_SOURCE_ORDER,
  AGENT_PERMISSION_MODE_META,
  AGENT_PERMISSION_MODE_ORDER,
  DEFAULT_AGENT_PERMISSION_MODE,
  fallbackAgentSourceRegistry,
  isAgentSourceId,
  isAgentPermissionMode,
  launchSourceSnapshots,
  loadAgentModelCatalog,
  loadAgentSourceRegistry,
  loadAgentSourcePreferences,
  permissionModeFor,
  recommendAgentSource,
  recordAgentPermissionMode,
  rememberAgentPermissionMode,
  rememberAgentSource,
  runAgentSourceAction,
  type AgentSourcePreferenceState,
  type AgentSourceId,
} from './agent-sources';
import type { LaunchOptions, WorkspaceDraftPatch } from './use-workspace-state';
import type {
  AgentModelCatalog,
  AgentPermissionMode,
  AgentSourceRegistryLoadStatus,
  AgentSourceRegistrySnapshot,
  RecentConversation,
} from '@/types/electron';
import {
  consumePendingAgentComposerRequest,
  FOCUS_AGENT_COMPOSER_EVENT,
  LAUNCH_CONFIGURATION_CATALOG_EVENT,
  type AgentComposerRequest,
} from './session-jump';
import {
  RecentConversations,
  type ConversationOpenMode,
  type RecentConversationsHandle,
} from './recent-conversations';
import {
  createAgentLaunchConfiguration,
  emptyLaunchConfigurationPool,
  launchConfigurationId,
  rankLaunchTargets,
  recommendLaunchSetups,
  SHELL_LAUNCH_TARGET,
  type AgentLaunchConfiguration,
  type AgentLaunchConfigurationInput,
  type LaunchConfigurationPoolV1,
  type LaunchTarget,
} from '@exawatt/core';
import {
  deleteLaunchConfiguration,
  loadLaunchConfigurationPool,
  recordLaunchConfigurationSuccess,
  renameLaunchConfiguration,
  saveNamedLaunchConfiguration,
  setLaunchConfigurationPinned,
} from '@/lib/launch-configurations';
import {
  composeLaunchTargets,
  launchTargetAvailability,
  launchTargetPresentation,
  type LaunchTargetAvailability,
} from './launch-target-catalog';
import type { LaunchConfigurationRibbonItem } from './launch-configuration-ribbon';
import type { CommandPaletteLaunchConfiguration } from '@/components/shortcuts/command-palette-launch-configurations';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AgentLauncher } from './launcher/agent-launcher';
import { EngineGlyph } from './launcher/setup-chip';
import {
  rowCapacityForWidth,
  type LauncherSetup,
  type LauncherVendor,
} from './launcher/launcher-model';
import type { DetailAxis, DetailAxisOption } from './launcher/setup-detail';

function effortChoiceKey(source: AgentSourceId, model: string): string {
  return `${source}:${model}`;
}

function displayEffortLabel(value: string): string {
  if (value === 'xhigh') return 'Extra high';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function launcherModelPresentation(
  label: string,
  modelId: string
): { model: string; variant: string | null } {
  const hasLongContext =
    modelId.toLowerCase().endsWith('[1m]') ||
    /(?:\s*[·(]\s*)1m(?:\s+context)?\)?\s*$/i.test(label);
  if (!hasLongContext) return { model: label, variant: null };
  return {
    model: label
      .replace(/\s*·\s*1m(?:\s+context)?\s*$/i, '')
      .replace(/\s*\(1m(?:\s+context)?\)\s*$/i, '')
      .trim(),
    variant: '1M context',
  };
}

function launcherVendor(
  source: AgentSourceId,
  modelId: string
): LauncherVendor | null {
  if (source !== 'opencode') return null;
  const provider = modelId.slice(0, modelId.indexOf('/')).toLowerCase();
  if (!provider) return null;
  if (provider === 'ollama') return { label: 'Ollama', kind: 'local' };
  const labels: Record<string, string> = {
    openrouter: 'OpenRouter',
    anthropic: 'Anthropic',
    google: 'Google',
    openai: 'OpenAI',
  };
  return {
    label:
      labels[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1),
    kind: 'hosted',
  };
}

function providerGroup(modelId: string): string | undefined {
  const provider = modelId.slice(0, modelId.indexOf('/')).toLowerCase();
  if (!provider) return undefined;
  return (
    {
      openrouter: 'OpenRouter',
      anthropic: 'Anthropic',
      google: 'Google',
      openai: 'OpenAI',
      ollama: 'Local',
    }[provider] ?? provider
  );
}

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
    | 'harness'
    | 'id'
    | 'title'
    | 'description'
    | 'continuation'
    | 'providerSessionId'
  >
): string {
  const source = AGENT_SOURCE_META[conversation.harness].label;
  const handoff = conversation.description ?? conversation.title;
  const providerIdentity =
    conversation.providerSessionId ??
    (conversation.continuation.kind === 'provider' ? conversation.id : null);
  const priorIdentity = [
    conversation.continuation.kind === 'exawatt-session'
      ? `Previous Exawatt Session: ${conversation.continuation.durableSessionId}`
      : null,
    providerIdentity
      ? `Previous ${source} conversation: ${providerIdentity}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    `Continue this work in a fresh Agent session.`,
    priorIdentity,
    `Handoff: ${handoff}`,
    `Inspect the current Project state, then pick up the work from this handoff.`,
  ].join('\n\n');
}

export function AgentComposer({
  projectDir,
  projectName,
  initialSource,
  initialTask,
  initialModel,
  initialEffort,
  initialWorktree,
  initialBranch,
  initialRoadmapItemId,
  roadmapItems = [],

  onLaunch,
  onReopenConversation,
  onDraftChange,
  onDraftIntent,
  onUserInteraction,
}: {
  projectDir: string;
  projectName: string;
  /** the summon's requested source (palette "Start Agent with X"),
   *  carried on the draft tab (D24) — beats the recommendation */
  initialSource?: AgentSourceId;
  /** the draft tab's saved task text (D28) — a remounting pane must pick
   *  the operator's typing back up, never blank it */
  initialTask?: string;
  /** the draft tab's model snapshot; changing it affects only this launch */
  initialModel?: string;
  /** the draft tab's effort snapshot; changing it affects only this launch */
  initialEffort?: string;
  initialWorktree?: boolean;
  initialBranch?: string;
  initialRoadmapItemId?: string;
  roadmapItems?: LaunchRoadmapItem[];

  onLaunch: (opts: LaunchOptions) => Promise<boolean>;
  /** Project-ledger recents restore their logical Session and retained
   * terminal history instead of spawning a second provider process. */
  onReopenConversation?: (durableSessionId: string) => Promise<boolean>;
  /** draft tabs (D28): the tab owns the work-in-progress — every task or
   *  source edit reports up so it survives this pane unmounting */
  onDraftChange?: (patch: WorkspaceDraftPatch) => void;
  /** Called only for an operator-authored change, never catalog hydration.
   * Empty Projects use this boundary to become durable draft tabs before any
   * launch intent can be lost to the delayed Project close. */
  onDraftIntent?: (patch: WorkspaceDraftPatch) => void;
  /** Pointer/key engagement retains an otherwise transient empty Project. */
  onUserInteraction?: () => void;
}) {
  const [task, setTaskState] = useState(initialTask ?? '');
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const onDraftIntentRef = useRef(onDraftIntent);
  onDraftIntentRef.current = onDraftIntent;
  const onUserInteractionRef = useRef(onUserInteraction);
  onUserInteractionRef.current = onUserInteraction;
  const initialTaskRef = useRef(initialTask);
  initialTaskRef.current = initialTask;
  const initialModelRef = useRef(initialModel);
  initialModelRef.current = initialModel;
  const initialEffortRef = useRef(initialEffort);
  initialEffortRef.current = initialEffort;
  const initialSourceRef = useRef(initialSource);
  initialSourceRef.current = initialSource;
  const initialWorktreeRef = useRef(initialWorktree);
  initialWorktreeRef.current = initialWorktree;
  const initialBranchRef = useRef(initialBranch);
  initialBranchRef.current = initialBranch;
  const initialRoadmapItemIdRef = useRef(initialRoadmapItemId);
  initialRoadmapItemIdRef.current = initialRoadmapItemId;
  const setTask = useCallback((next: string) => {
    setTaskState(next);
    onDraftChangeRef.current?.({ draftTask: next });
  }, []);
  const reportDraftIntent = useCallback((patch: WorkspaceDraftPatch) => {
    onDraftIntentRef.current?.({ ...patch, draftTouched: true });
  }, []);
  const [source, setSource] = useState<AgentSourceId>('claude');
  const [sourceRegistry, setSourceRegistry] =
    useState<AgentSourceRegistrySnapshot>(() =>
      fallbackAgentSourceRegistry('launch')
    );
  const [sourceRegistryStatus, setSourceRegistryStatus] = useState<
    AgentSourceRegistryLoadStatus | 'loading'
  >('loading');
  const [sourceActionMessage, setSourceActionMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [modelCatalog, setModelCatalog] = useState<AgentModelCatalog | null>(
    null
  );
  const [model, setModel] = useState<string | null>(initialModel ?? null);
  const [effort, setEffort] = useState<string | null>(initialEffort ?? null);
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
  const [worktree, setWorktree] = useState(initialWorktree ?? false);
  const [branch, setBranch] = useState(() => initialBranch ?? defaultBranch());
  const [roadmapItemId, setRoadmapItemId] = useState(
    initialRoadmapItemId ?? ''
  );
  const [launching, setLaunching] = useState<'agent' | 'shell' | null>(null);
  const [selectedTargetKind, setSelectedTargetKind] = useState<
    'agent' | 'shell'
  >('agent');
  const [configurationPool, setConfigurationPool] =
    useState<LaunchConfigurationPoolV1 | null>(null);
  const [frozenTargets, setFrozenTargets] = useState<LaunchTarget[]>([
    SHELL_LAUNCH_TARGET,
  ]);
  const launcherOrderFrozenRef = useRef(false);
  const [launcherWidth, setLauncherWidth] = useState(768);
  const [catalogsBySource, setCatalogsBySource] = useState<
    Partial<Record<AgentSourceId, AgentModelCatalog>>
  >({});
  const [allConfigurationsOpen, setAllConfigurationsOpen] = useState(false);
  const [configurationMessage, setConfigurationMessage] = useState<
    string | null
  >(null);
  // D24: the composer IS the pane of a draft tab (or an empty Project) —
  // always open; ⌘T creates/selects the draft tab that hosts it.
  const branchEditSeq = useRef(0);
  const permissionSaveSeq = useRef(0);
  const permissionSaveQueue = useRef(Promise.resolve());
  const requestedSourceRef = useRef<AgentSourceId | null>(null);
  const modelLoadSeq = useRef(0);
  const initialModelPendingRef = useRef<{
    model: string | null;
    effort: string | null;
    source: AgentSourceId | null;
  } | null>(
    initialModel || initialEffort
      ? {
          model: initialModel ?? null,
          effort: initialEffort ?? null,
          source: initialSource ?? null,
        }
      : null
  );
  const modelChoicesRef = useRef<Partial<Record<AgentSourceId, string>>>({});
  const effortChoicesRef = useRef<Record<string, string>>({});
  const composerRootRef = useRef<HTMLDivElement>(null);
  const launcherMeasureRef = useRef<HTMLDivElement>(null);
  const openShellRef = useRef<() => void>(() => {});
  const taskElement = useCallback(
    () =>
      composerRootRef.current?.querySelector<HTMLTextAreaElement>(
        '[aria-label="Initial task for the new Agent"]'
      ) ?? null,
    []
  );
  const recentRef = useRef<RecentConversationsHandle>(null);
  const branchErrorId = useId();
  const preferencesReady = sourcePreferences !== null;
  const sourceRegistryReady = sourceRegistryStatus === 'live';
  const controlsDisabled = launching !== null;
  const branchReady = !worktree || branch.trim().length > 0;
  // Source policy is the only asynchronous launch prerequisite. Model
  // discovery enriches the override picker, but every harness already has a
  // trustworthy default of its own; a slow or unavailable catalog must not
  // eat the operator's Enter key or strand the Start control.
  const sourceSnapshots = launchSourceSnapshots(sourceRegistry);
  const sourceOrder = sourceSnapshots.map(source => source.harness);
  const effectiveSource = isAgentSourceId(source)
    ? source
    : (sourceOrder[0] ?? AGENT_SOURCE_ORDER[0]);
  const sourceMeta =
    sourceSnapshots.find(source => source.harness === effectiveSource) ??
    fallbackAgentSourceRegistry('launch').sources.find(
      source => source.harness === effectiveSource
    )!;
  const launchReady =
    preferencesReady &&
    sourceRegistryReady &&
    sourceMeta.launchable &&
    branchReady;
  const modelOptions = modelCatalog
    ? model && !modelCatalog.models.some(option => option.id === model)
      ? [
          {
            id: model,
            label: model,
            description: 'Previously selected for this draft.',
            defaultEffort: null,
            efforts: [],
          },
          ...modelCatalog.models,
        ]
      : modelCatalog.models
    : [];
  const modelMeta = modelOptions.find(option => option.id === model) ?? null;
  const modelLabel =
    modelMeta?.label ??
    (model ? model : (modelCatalog?.effectiveModelLabel ?? 'Harness default'));
  const effortOptions = modelMeta
    ? effort && !modelMeta.efforts.some(option => option.id === effort)
      ? [
          {
            id: effort,
            label: displayEffortLabel(effort),
            description: 'Previously selected for this draft.',
          },
          ...modelMeta.efforts,
        ]
      : modelMeta.efforts
    : [];
  const effortMeta = effortOptions.find(option => option.id === effort) ?? null;
  const effortLabel =
    effortMeta?.label ??
    (effort
      ? displayEffortLabel(effort)
      : (modelCatalog?.effectiveEffortLabel ?? 'Model default'));
  const permissionMeta = AGENT_PERMISSION_MODE_META[permissionMode];
  const currentConfigurationInput: AgentLaunchConfigurationInput | null = model
    ? {
        sourceId: sourceMeta.id,
        modelId: model,
        effort,
        labels: {
          source: sourceMeta.label,
          model: modelLabel,
          effort: effortLabel,
        },
      }
    : null;
  const currentConfigurationId = currentConfigurationInput
    ? launchConfigurationId(currentConfigurationInput)
    : `draft:${effectiveSource}`;
  const projectPins = new Set(
    configurationPool?.projects[projectDir]?.pins ?? []
  );
  // The one catalog (`launch-target-catalog.ts`). Clone to… reads the same
  // composition, availability and naming, so a change here reaches it too.
  const catalogTargets = composeLaunchTargets({
    ranked: frozenTargets,
    sources: sourceSnapshots,
    catalogs: catalogsBySource,
  });
  if (
    currentConfigurationInput &&
    !catalogTargets.some(target => target.id === currentConfigurationId)
  ) {
    catalogTargets.unshift(
      createAgentLaunchConfiguration(currentConfigurationInput)
    );
  }

  const targetAvailability = useCallback(
    (target: AgentLaunchConfiguration): LaunchTargetAvailability =>
      launchTargetAvailability(target, {
        sources: launchSourceSnapshots(sourceRegistry),
        catalogs: catalogsBySource,
      }),
    [catalogsBySource, sourceRegistry]
  );

  const ribbonTargets: Array<{
    target: LaunchTarget;
    item: LaunchConfigurationRibbonItem;
    available: boolean;
  }> = catalogTargets.map(target => {
    const availability = targetAvailability(target);
    const presented = launchTargetPresentation(target, sourceSnapshots);
    return {
      target,
      available: availability.available,
      item: {
        ...presented,
        pinned: projectPins.has(target.id),
        available: availability.available,
        unavailableReason: availability.reason,
      },
    };
  });
  ribbonTargets.push({
    target: SHELL_LAUNCH_TARGET,
    available: true,
    item: {
      id: SHELL_LAUNCH_TARGET.id,
      label: 'Shell',
      accessibleLabel: `Shell in ${projectName}`,
      source: 'shell',
      pinned: projectPins.has(SHELL_LAUNCH_TARGET.id),
      available: true,
    },
  });
  const selectedTargetId =
    selectedTargetKind === 'shell'
      ? SHELL_LAUNCH_TARGET.id
      : currentConfigurationId;
  const selectedRibbonTarget = ribbonTargets.find(
    entry => entry.item.id === selectedTargetId
  );
  const lastPublishedCatalogRef = useRef('');

  useEffect(() => {
    const rows: CommandPaletteLaunchConfiguration[] = [];
    for (const entry of ribbonTargets) {
      if (entry.target.kind === 'shell') {
        rows.push({
          configurationId: entry.target.id,
          configuration: { kind: 'shell' },
          label: entry.item.label,
          searchValue: entry.item.accessibleLabel,
        });
        continue;
      }
      const agentTarget = entry.target;
      const snapshot = sourceSnapshots.find(
        source => source.id === agentTarget.sourceId
      );
      if (!snapshot) continue;
      rows.push({
        configurationId: agentTarget.id,
        configuration: {
          kind: 'agent',
          source: snapshot.harness,
          model: agentTarget.modelId,
          effort: agentTarget.effort,
          agentTypeId: agentTarget.typeId,
        },
        label: entry.item.label,
        searchValue: entry.item.accessibleLabel,
      });
    }
    const signature = JSON.stringify(rows);
    if (signature === lastPublishedCatalogRef.current) return;
    lastPublishedCatalogRef.current = signature;
    window.dispatchEvent(
      new CustomEvent(LAUNCH_CONFIGURATION_CATALOG_EVENT, { detail: rows })
    );
  });

  useEffect(
    () => () => {
      window.dispatchEvent(
        new CustomEvent(LAUNCH_CONFIGURATION_CATALOG_EVENT, { detail: [] })
      );
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    permissionSaveSeq.current += 1;
    modelLoadSeq.current += 1;
    requestedSourceRef.current = null;
    const savedSource = initialSourceRef.current;
    initialModelPendingRef.current =
      initialModelRef.current || initialEffortRef.current
        ? {
            model: initialModelRef.current ?? null,
            effort: initialEffortRef.current ?? null,
            source: savedSource ?? null,
          }
        : null;
    modelChoicesRef.current =
      savedSource && initialModelRef.current
        ? { [savedSource]: initialModelRef.current }
        : {};
    effortChoicesRef.current =
      savedSource && initialModelRef.current && initialEffortRef.current
        ? {
            [effortChoiceKey(savedSource, initialModelRef.current)]:
              initialEffortRef.current,
          }
        : {};
    setSourcePreferences(null);
    setModelCatalog(null);
    setModel(initialModelRef.current ?? null);
    setEffort(initialEffortRef.current ?? null);
    setPermissionMode(DEFAULT_AGENT_PERMISSION_MODE);
    setUsedSafePreferenceFallback(false);
    setSourceRegistryStatus('loading');
    setSourceActionMessage(null);
    setPermissionSaveState('idle');
    setSelectedTargetKind('agent');
    setConfigurationMessage(null);
    setCatalogsBySource({});
    setConfigurationPool(null);
    setFrozenTargets([SHELL_LAUNCH_TARGET]);
    launcherOrderFrozenRef.current = false;
    void loadLaunchConfigurationPool()
      .then(pool => {
        if (cancelled) return;
        setConfigurationPool(pool);
        // Freeze ordering for this composer entry. Success updates persistence,
        // but nothing jumps under the operator's keyboard or pointer.
        setFrozenTargets(rankLaunchTargets(pool, projectDir));
      })
      .catch(() => {
        if (cancelled) return;
        setConfigurationPool(emptyLaunchConfigurationPool());
        setConfigurationMessage(
          'Saved launch configurations are unavailable for this visit.'
        );
      });
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
    void loadAgentSourceRegistry('launch').then(result => {
      if (cancelled) return;
      setSourceRegistry(result.snapshot);
      setSourceRegistryStatus(result.status);
      if (result.error) {
        setSourceActionMessage({ ok: false, text: result.error.message });
      }
    });
    // a (re)mount or Project change is not an operator edit: restore the
    // tab's saved draft directly instead of reporting a blank up (D28)
    setTaskState(initialTaskRef.current ?? '');
    setWorktree(initialWorktreeRef.current ?? false);
    setBranch(initialBranchRef.current ?? defaultBranch());
    setRoadmapItemId(initialRoadmapItemIdRef.current ?? '');
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
      const nextModel = modelChoicesRef.current[nextSource] ?? null;
      const nextEffort = nextModel
        ? (effortChoicesRef.current[effortChoiceKey(nextSource, nextModel)] ??
          null)
        : null;
      setSource(nextSource);
      setModelCatalog(null);
      setModel(nextModel);
      setEffort(nextEffort);
      onDraftChangeRef.current?.({
        draftSource: nextSource,
        draftModel: nextModel,
        draftEffort: nextEffort,
      });
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
        const nextModel = modelChoicesRef.current[next] ?? null;
        const nextEffort = nextModel
          ? (effortChoicesRef.current[effortChoiceKey(next, nextModel)] ?? null)
          : null;
        requestedSourceRef.current = next;
        setSource(next);
        setModelCatalog(null);
        setModel(nextModel);
        setEffort(nextEffort);
        onDraftChangeRef.current?.({
          draftSource: next,
          draftModel: nextModel,
          draftEffort: nextEffort,
        });
      }
    },
    [selectSource, sourcePreferences]
  );
  const chooseSourceRef = useRef<typeof chooseSource | null>(null);
  chooseSourceRef.current = chooseSource;

  const applyAgentSelection = useCallback(
    (
      nextSource: AgentSourceId,
      nextModel: string | null,
      nextEffort: string | null
    ) => {
      if (nextModel) {
        modelChoicesRef.current[nextSource] = nextModel;
        if (nextEffort) {
          effortChoicesRef.current[effortChoiceKey(nextSource, nextModel)] =
            nextEffort;
        }
      } else {
        delete modelChoicesRef.current[nextSource];
      }
      setSelectedTargetKind('agent');
      chooseSource(nextSource);
      setModel(nextModel);
      setEffort(nextEffort);
      onDraftChangeRef.current?.({
        draftSource: nextSource,
        draftModel: nextModel,
        draftEffort: nextEffort,
      });
    },
    [chooseSource]
  );

  useEffect(() => {
    if (!preferencesReady || !sourceRegistryReady || !sourceMeta.launchable) {
      return;
    }
    let cancelled = false;
    const loadSeq = modelLoadSeq.current + 1;
    modelLoadSeq.current = loadSeq;
    setModelCatalog(null);
    void loadAgentModelCatalog(effectiveSource, projectDir).then(catalog => {
      if (
        cancelled ||
        modelLoadSeq.current !== loadSeq ||
        catalog.harness !== effectiveSource
      ) {
        return;
      }
      const pendingInitialModel = initialModelPendingRef.current;
      const pendingMatchesSource =
        pendingInitialModel &&
        (pendingInitialModel.source === null ||
          pendingInitialModel.source === effectiveSource);
      const restoredModel = pendingMatchesSource
        ? pendingInitialModel.model
        : null;
      const selectedModel =
        modelChoicesRef.current[effectiveSource] ??
        restoredModel ??
        catalog.effectiveModel;
      const selectedModelMeta = catalog.models.find(
        option => option.id === selectedModel
      );
      const restoredEffort =
        pendingMatchesSource &&
        (!pendingInitialModel.model ||
          pendingInitialModel.model === selectedModel)
          ? pendingInitialModel.effort
          : null;
      if (pendingMatchesSource) initialModelPendingRef.current = null;
      const effortKey = selectedModel
        ? effortChoiceKey(effectiveSource, selectedModel)
        : null;
      const selectedEffort = catalog.effortLocked
        ? catalog.effectiveEffort
        : ((effortKey ? effortChoicesRef.current[effortKey] : null) ??
          restoredEffort ??
          (selectedModel === catalog.effectiveModel
            ? catalog.effectiveEffort
            : selectedModelMeta?.defaultEffort) ??
          null);
      if (selectedModel) {
        modelChoicesRef.current[effectiveSource] = selectedModel;
      }
      if (effortKey && selectedEffort) {
        effortChoicesRef.current[effortKey] = selectedEffort;
      }
      setModel(selectedModel);
      setEffort(selectedEffort);
      setModelCatalog(catalog);
      setCatalogsBySource(current => ({
        ...current,
        [effectiveSource]: catalog,
      }));
      onDraftChangeRef.current?.({
        draftModel: selectedModel,
        draftEffort: selectedEffort,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    effectiveSource,
    preferencesReady,
    projectDir,
    sourceMeta.launchable,
    sourceRegistryReady,
  ]);

  // Prime each launchable source's exact default identity in parallel. This
  // makes Option-arrow cycling a whole-configuration gesture without making
  // the first Enter wait for every provider catalog.
  useEffect(() => {
    if (!preferencesReady || !sourceRegistryReady) return;
    let cancelled = false;
    const sources = launchSourceSnapshots(sourceRegistry)
      .filter(snapshot => snapshot.launchable)
      .map(snapshot => snapshot.harness);
    for (const sourceId of sources) {
      if (catalogsBySource[sourceId]) continue;
      void loadAgentModelCatalog(sourceId, projectDir).then(catalog => {
        if (cancelled || catalog.harness !== sourceId) return;
        setCatalogsBySource(current =>
          current[sourceId] ? current : { ...current, [sourceId]: catalog }
        );
      });
    }
    return () => {
      cancelled = true;
    };
  }, [
    catalogsBySource,
    preferencesReady,
    projectDir,
    sourceRegistry,
    sourceRegistryReady,
  ]);

  // D49: hold inert cards until every launchable engine has either reported a
  // catalog or honestly degraded. Rank once at that boundary; subsequent
  // launches update persistence for the next composer without moving the row
  // under the current pointer or keyboard focus.
  useEffect(() => {
    if (
      launcherOrderFrozenRef.current ||
      !configurationPool ||
      !preferencesReady ||
      !sourceRegistryReady
    ) {
      return;
    }
    const launchable = launchSourceSnapshots(sourceRegistry).filter(
      snapshot => snapshot.launchable
    );
    if (launchable.some(snapshot => !catalogsBySource[snapshot.harness])) {
      return;
    }
    const seeds: AgentLaunchConfiguration[] = [];
    for (const snapshot of launchable) {
      const catalog = catalogsBySource[snapshot.harness];
      if (!catalog?.effectiveModel) continue;
      const option = catalog.models.find(
        candidate => candidate.id === catalog.effectiveModel
      );
      seeds.push(
        createAgentLaunchConfiguration(
          {
            sourceId: snapshot.id,
            modelId: catalog.effectiveModel,
            effort: catalog.effectiveEffort,
            labels: {
              source: snapshot.label,
              model: option?.label ?? catalog.effectiveModelLabel,
              effort: catalog.effectiveEffortLabel,
            },
          },
          0
        )
      );
    }
    const ranked = recommendLaunchSetups({
      pool: configurationPool,
      project: projectDir,
      seeds,
      availability: target =>
        target.kind === 'shell'
          ? { available: true }
          : targetAvailability(target),
      rankedAt: Date.now(),
    });
    launcherOrderFrozenRef.current = true;
    setFrozenTargets([
      ...ranked.ordered.map(row => row.target),
      SHELL_LAUNCH_TARGET,
    ]);
  }, [
    catalogsBySource,
    configurationPool,
    preferencesReady,
    projectDir,
    sourceRegistry,
    sourceRegistryReady,
    targetAvailability,
  ]);

  useEffect(() => {
    const element = launcherMeasureRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setLauncherWidth(width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const recheckSources = useCallback(async () => {
    setSourceRegistryStatus('loading');
    setSourceActionMessage(null);
    const result = await loadAgentSourceRegistry(
      'launch',
      true,
      sourceRegistry
    );
    setSourceRegistry(result.snapshot);
    setSourceRegistryStatus(result.status);
    setSourceActionMessage(
      result.error
        ? { ok: false, text: result.error.message }
        : { ok: true, text: 'Agent Source status verified.' }
    );
  }, [sourceRegistry]);

  // ⌘T must land in the goal field every time (D21): focus after mount —
  // the draft pane mounts fresh on every summon
  useEffect(() => {
    const frame = requestAnimationFrame(() => taskElement()?.focus());
    return () => cancelAnimationFrame(frame);
  }, [taskElement]);

  useEffect(() => {
    const focus = (request?: AgentComposerRequest) => {
      if (typeof request === 'string') {
        applyAgentSelection(request, null, null);
      } else if (request?.configuration?.kind === 'shell') {
        openShellRef.current();
        return;
      } else if (request?.configuration?.kind === 'agent') {
        applyAgentSelection(
          request.configuration.source,
          request.configuration.model,
          request.configuration.effort
        );
      } else if (request?.configurationId) {
        const target = frozenTargets.find(
          candidate => candidate.id === request.configurationId
        );
        if (target?.kind === 'shell') {
          openShellRef.current();
          return;
        } else if (target?.kind === 'agent') {
          const snapshot = sourceSnapshots.find(
            candidate =>
              candidate.id === target.sourceId ||
              candidate.harness === target.sourceId
          );
          if (snapshot) {
            applyAgentSelection(
              snapshot.harness,
              target.modelId,
              target.effort
            );
          }
        }
      }
      requestAnimationFrame(() => taskElement()?.focus());
    };
    const onFocus = (event: Event) => {
      consumePendingAgentComposerRequest();
      focus((event as CustomEvent<AgentComposerRequest>).detail);
    };
    window.addEventListener(FOCUS_AGENT_COMPOSER_EVENT, onFocus);
    const pending = consumePendingAgentComposerRequest();
    if (pending !== undefined) focus(pending);
    return () =>
      window.removeEventListener(FOCUS_AGENT_COMPOSER_EVENT, onFocus);
  }, [applyAgentSelection, frozenTargets, sourceSnapshots, taskElement]);

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
      const el = taskElement();
      const start = el?.selectionStart ?? task.length;
      const end = el?.selectionEnd ?? task.length;
      const nextTask = task.slice(0, start) + value + task.slice(end);
      setTask(nextTask);
      reportDraftIntent({ draftTask: nextTask });
      requestAnimationFrame(() => {
        const node = taskElement();
        if (!node) return;
        node.focus();
        const caret = start + value.length;
        node.setSelectionRange(caret, caret);
      });
    },
    [reportDraftIntent, task, setTask, taskElement]
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
    if (
      controlsDisabled ||
      !sourcePreferences ||
      !launchReady ||
      (model === null &&
        modelCatalog?.effectiveModelSource === 'unavailable') ||
      (model !== null && selectedRibbonTarget?.available !== true)
    ) {
      return;
    }
    const launchedConfiguration = currentConfigurationInput;
    setLaunching('agent');
    const branchSeqAtLaunch = branchEditSeq.current;
    let ok = false;
    try {
      ok = await onLaunch({
        harness: effectiveSource,
        dir: projectDir,
        permissionMode,
        model:
          modelCatalog?.effectiveModelSource === 'account-default' &&
          model === modelCatalog.effectiveModel
            ? undefined
            : (model ?? undefined),
        effort: effort && effort !== 'auto' ? effort : undefined,
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
    if (launchedConfiguration) {
      void recordLaunchConfigurationSuccess(projectDir, launchedConfiguration)
        .then(setConfigurationPool)
        .catch(() =>
          setConfigurationMessage(
            'Agent started, but its launch ranking could not be saved.'
          )
        );
    }
    setTask('');
    if (worktree && branchEditSeq.current === branchSeqAtLaunch) {
      setBranch(defaultBranch());
    }
  };

  const openShell = async () => {
    if (controlsDisabled) return;
    setLaunching('shell');
    let ok = false;
    try {
      ok = await onLaunch({ harness: 'shell', dir: projectDir });
    } catch {
      // The workspace-level launch owner surfaces the actionable error.
    } finally {
      setLaunching(null);
    }
    if (ok) {
      void recordLaunchConfigurationSuccess(projectDir, { kind: 'shell' })
        .then(setConfigurationPool)
        .catch(() =>
          setConfigurationMessage(
            'Shell opened, but its launch ranking could not be saved.'
          )
        );
    }
  };
  openShellRef.current = () => void openShell();

  const openRecentConversation = async (
    conversation: RecentConversation,
    mode: ConversationOpenMode
  ): Promise<boolean> => {
    if (controlsDisabled) return false;
    const reopenSessionId =
      mode === 'resume' && conversation.continuation.kind === 'exawatt-session'
        ? conversation.continuation.durableSessionId
        : null;
    const exactProviderId =
      mode === 'resume'
        ? (conversation.providerSessionId ??
          (conversation.continuation.kind === 'provider'
            ? conversation.id
            : null))
        : null;
    let permissionToPersist: AgentPermissionMode | null = null;
    let continueConversation: (() => Promise<boolean>) | null = null;
    if (exactProviderId) {
      if (!sourcePreferences) return false;
      permissionToPersist = permissionModeFor(
        sourcePreferences,
        projectDir,
        conversation.harness,
        usedSafePreferenceFallback ? 'prompt' : DEFAULT_AGENT_PERMISSION_MODE
      );
      continueConversation = () =>
        onLaunch({
          harness: conversation.harness,
          dir: conversation.cwd,
          permissionMode: permissionToPersist!,
          resumeSessionId: exactProviderId,
          statedTask: conversation.description ?? conversation.title,
          ...(conversation.titleSource === 'generated'
            ? { restoredSubtitle: conversation.title }
            : {}),
          ...(reopenSessionId ? { restoreSessionId: reopenSessionId } : {}),
        });
    } else if (reopenSessionId) {
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
        dir: conversation.cwd,
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

  const launchableSnapshots = sourceSnapshots.filter(
    snapshot => snapshot.launchable
  );
  const launcherSettled =
    launcherOrderFrozenRef.current &&
    configurationPool !== null &&
    preferencesReady &&
    sourceRegistryReady &&
    launchableSnapshots.every(snapshot =>
      Boolean(catalogsBySource[snapshot.harness])
    );
  const projectUsage = configurationPool?.projects[projectDir]?.usage ?? {};

  const targetToLauncherSetup = (
    target: AgentLaunchConfiguration
  ): LauncherSetup | null => {
    const snapshot = sourceSnapshots.find(
      candidate =>
        candidate.id === target.sourceId ||
        candidate.harness === target.sourceId
    );
    if (!snapshot) return null;
    const catalog = catalogsBySource[snapshot.harness];
    const option = catalog?.models.find(
      candidate => candidate.id === target.modelId
    );
    const label = target.labels.model ?? option?.label ?? target.modelId;
    const presented = launcherModelPresentation(label, target.modelId);
    const availability = targetAvailability(target);
    const pinned = projectPins.has(target.id);
    return {
      id: target.id,
      role: 'coding',
      name: target.name,
      engine: {
        harness: snapshot.harness,
        label: snapshot.label,
        color: snapshot.color,
      },
      model: presented.model,
      modelVariant: presented.variant,
      vendor: launcherVendor(snapshot.harness, target.modelId),
      thinking: target.effort
        ? (target.labels.effort ?? displayEffortLabel(target.effort))
        : null,
      reason: pinned
        ? 'pinned'
        : projectUsage[target.id]
          ? 'frecent'
          : 'default',
      launchCount: projectUsage[target.id]?.launchCount ?? 0,
      pinned,
      available: availability.available,
      unavailableReason: availability.reason,
    };
  };

  const launcherTargets = frozenTargets.filter(
    (target): target is AgentLaunchConfiguration => target.kind === 'agent'
  );
  const launcherSetups = launcherTargets
    .map(targetToLauncherSetup)
    .filter((setup): setup is LauncherSetup => setup !== null);

  // A launchable engine without a source-owned default is not absent. It is a
  // real selectable state that opens Model and blocks Start until the operator
  // supplies the missing fact (D49 finding 13; decision 0027).
  for (const snapshot of launchableSnapshots) {
    const catalog = catalogsBySource[snapshot.harness];
    if (catalog?.effectiveModel) continue;
    launcherSetups.push({
      id: `draft:${snapshot.harness}`,
      role: 'coding',
      name: null,
      engine: {
        harness: snapshot.harness,
        label: snapshot.label,
        color: snapshot.color,
      },
      model:
        catalog?.effectiveModelSource === 'account-default'
          ? catalog.effectiveModelLabel
          : null,
      modelVariant: null,
      vendor: null,
      thinking: null,
      reason: 'default',
      launchCount: 0,
      pinned: false,
      available: true,
    });
  }

  // A palette request or restored draft may name a valid exact configuration
  // outside the frozen recommendation row. Keep that operator-authored choice
  // visible without re-sorting the rest of the row.
  if (
    currentConfigurationInput &&
    !launcherSetups.some(setup => setup.id === currentConfigurationId)
  ) {
    const currentTarget = createAgentLaunchConfiguration(
      currentConfigurationInput,
      0
    );
    const setup = targetToLauncherSetup(currentTarget);
    if (setup) launcherSetups.unshift(setup);
  }

  const selectedLauncherId =
    selectedTargetKind === 'agent' ? currentConfigurationId : null;
  const capacity = rowCapacityForWidth(launcherWidth);
  let visibleLauncherSetups = launcherSetups.slice(0, capacity);
  const selectedOutsideRow = launcherSetups.find(
    setup => setup.id === selectedLauncherId
  );
  if (
    selectedOutsideRow &&
    !visibleLauncherSetups.some(setup => setup.id === selectedOutsideRow.id)
  ) {
    visibleLauncherSetups = [
      ...visibleLauncherSetups.slice(0, Math.max(0, capacity - 1)),
      selectedOutsideRow,
    ];
  }

  const chooseLauncherSetup = (id: string) => {
    if (id.startsWith('draft:')) {
      const nextSource = id.slice('draft:'.length);
      if (isAgentSourceId(nextSource)) {
        reportDraftIntent({
          draftSource: nextSource,
          draftModel: null,
          draftEffort: null,
        });
        applyAgentSelection(nextSource, null, null);
      }
      return;
    }
    const target = launcherTargets.find(candidate => candidate.id === id);
    if (!target) return;
    const snapshot = sourceSnapshots.find(
      candidate =>
        candidate.id === target.sourceId ||
        candidate.harness === target.sourceId
    );
    if (!snapshot) return;
    reportDraftIntent({
      draftSource: snapshot.harness,
      draftModel: target.modelId,
      draftEffort: target.effort,
    });
    applyAgentSelection(snapshot.harness, target.modelId, target.effort);
  };

  const selectedCatalog = catalogsBySource[effectiveSource] ?? modelCatalog;
  const selectedModelOption = selectedCatalog?.models.find(
    option => option.id === model
  );
  const engineAxisOptions: DetailAxisOption[] = sourceSnapshots.map(
    snapshot => ({
      id: snapshot.harness,
      label: snapshot.label,
      description: snapshot.launchable ? snapshot.stateLabel : snapshot.summary,
      disabled: !snapshot.launchable,
      disabledReason: !snapshot.launchable ? snapshot.stateLabel : undefined,
      mark: (
        <EngineGlyph
          engine={{
            harness: snapshot.harness,
            label: snapshot.label,
            color: snapshot.color,
          }}
          size={12}
        />
      ),
    })
  );
  const modelAxisOptions: DetailAxisOption[] = (
    selectedCatalog?.models ?? []
  ).map(option => ({
    id: option.id,
    label: option.label,
    description: option.description,
    group:
      effectiveSource === 'opencode'
        ? providerGroup(option.id)
        : sourceMeta.label,
    keywords: option.id,
  }));
  const thinkingAxisOptions: DetailAxisOption[] = (
    selectedModelOption?.efforts ?? []
  ).map(option => ({
    id: option.id,
    label: option.label,
    description: option.description,
  }));
  const permissionAxisOptions: DetailAxisOption[] =
    AGENT_PERMISSION_MODE_ORDER.filter(mode =>
      sourceMeta.capabilities.permissionModes.includes(mode)
    ).map(mode => ({
      id: mode,
      label: AGENT_PERMISSION_MODE_META[mode].label,
      description: AGENT_PERMISSION_MODE_META[mode].description,
    }));

  const launcherAxes: DetailAxis[] = [
    {
      id: 'engine',
      label: 'Engine',
      value: effectiveSource,
      options: engineAxisOptions,
      onChange: optionId => {
        if (!isAgentSourceId(optionId)) return;
        const catalog = catalogsBySource[optionId];
        reportDraftIntent({
          draftSource: optionId,
          draftModel: catalog?.effectiveModel ?? null,
          draftEffort: catalog?.effectiveEffort ?? null,
        });
        applyAgentSelection(
          optionId,
          catalog?.effectiveModel ?? null,
          catalog?.effectiveEffort ?? null
        );
      },
      provenance: 'Engines available on this machine.',
      footer: (
        <Link
          href="/settings"
          className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 font-mono text-chrome-meta text-hud-text-dim outline-none transition-colors hover:bg-hud-fill hover:text-hud-text focus-visible:ring-2 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        >
          Add or remove engines
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </Link>
      ),
    },
    {
      id: 'model',
      label: 'Model',
      weight: 2,
      value: model,
      placeholder:
        selectedCatalog?.effectiveModelSource === 'account-default'
          ? selectedCatalog.effectiveModelLabel
          : 'Choose a model',
      options: modelAxisOptions,
      onChange: optionId => {
        const nextModel = selectedCatalog?.models.find(
          option => option.id === optionId
        );
        if (!nextModel) return;
        const key = effortChoiceKey(effectiveSource, optionId);
        const nextEffort =
          effortChoicesRef.current[key] ??
          nextModel.defaultEffort ??
          (optionId === selectedCatalog?.effectiveModel
            ? selectedCatalog.effectiveEffort
            : null) ??
          null;
        modelChoicesRef.current[effectiveSource] = optionId;
        if (nextEffort) effortChoicesRef.current[key] = nextEffort;
        setSelectedTargetKind('agent');
        setModel(optionId);
        setEffort(nextEffort);
        onDraftChangeRef.current?.({
          draftModel: optionId,
          draftEffort: nextEffort,
        });
        reportDraftIntent({
          draftModel: optionId,
          draftEffort: nextEffort,
        });
      },
      provenance: selectedCatalog?.catalogProvenance,
      searchable: modelAxisOptions.length > 10,
      footer:
        selectedCatalog?.selectionAction === 'choose-in-source' ? (
          <button
            type="button"
            onClick={() => {
              void runAgentSourceAction(effectiveSource, 'choose-model').then(
                result =>
                  setSourceActionMessage({
                    ok: result.ok,
                    text: result.message,
                  })
              );
            }}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 font-mono text-chrome-meta text-hud-text-dim outline-none transition-colors hover:bg-hud-fill hover:text-hud-text focus-visible:ring-2 focus-visible:ring-hud-cyan motion-reduce:transition-none"
          >
            Choose in {sourceMeta.label}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </button>
        ) : undefined,
    },
    {
      id: 'thinking',
      label: 'Thinking',
      weight: 1.2,
      value: effort,
      placeholder: 'Engine default',
      options: thinkingAxisOptions,
      disabled:
        selectedCatalog?.effortLocked || thinkingAxisOptions.length === 0,
      onChange: optionId => {
        if (!model) return;
        effortChoicesRef.current[effortChoiceKey(effectiveSource, model)] =
          optionId;
        setEffort(optionId);
        onDraftChangeRef.current?.({ draftEffort: optionId });
        reportDraftIntent({ draftEffort: optionId });
      },
      provenance: 'Applies to this Agent only.',
    },
    {
      id: 'permission',
      label: 'Permission',
      weight: 1.2,
      value: permissionMode,
      options: permissionAxisOptions,
      tone: 'caution',
      onChange: optionId => {
        if (!isAgentPermissionMode(optionId)) return;
        setPermissionMode(optionId);
        setSourcePreferences(current =>
          current
            ? recordAgentPermissionMode(
                current,
                projectDir,
                effectiveSource,
                optionId
              )
            : current
        );
        void persistPermissionMode(effectiveSource, optionId);
      },
      provenance: 'Remembered for this Project and engine.',
    },
  ];

  const selectedSetup = visibleLauncherSetups.find(
    setup => setup.id === selectedLauncherId
  );
  const modelRequired =
    selectedCatalog?.effectiveModelSource === 'unavailable' && model === null;
  const launcherBlockedReason = !launcherSettled
    ? null
    : !sourceMeta.launchable
      ? `${sourceMeta.label}: ${sourceMeta.stateLabel}`
      : !branchReady
        ? 'Enter a branch name before starting.'
        : modelRequired
          ? `Choose a model for ${sourceMeta.label} before starting.`
          : selectedSetup && !selectedSetup.available
            ? (selectedSetup.unavailableReason ?? 'This setup is unavailable.')
            : null;

  const controls = (
    <div
      ref={composerRootRef}
      data-agent-composer
      data-preferences-ready={preferencesReady}
      aria-busy={launching !== null}
      onPointerDownCapture={() => onUserInteractionRef.current?.()}
      onPasteCapture={event => {
        const hasImage = Array.from(event.clipboardData?.items ?? []).some(
          item => item.kind === 'file' && item.type.startsWith('image/')
        );
        if (!hasImage) return;
        event.preventDefault();
        void pasteFromClipboard();
      }}
      onKeyDownCapture={event => {
        onUserInteractionRef.current?.();
        if (event.nativeEvent.isComposing) return;
        if (
          event.key === 'v' &&
          event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          void pasteFromClipboard();
          return;
        }
        const taskNode = taskElement();
        if (event.target !== taskNode || task !== '') return;
        if (
          event.altKey &&
          (event.key === 'ArrowUp' || event.key === 'ArrowDown')
        ) {
          const available = visibleLauncherSetups.filter(
            setup => setup.available
          );
          if (available.length < 2) return;
          event.preventDefault();
          event.stopPropagation();
          const index = available.findIndex(
            setup => setup.id === selectedLauncherId
          );
          const step = event.key === 'ArrowDown' ? 1 : available.length - 1;
          chooseLauncherSetup(
            available[((index < 0 ? 0 : index) + step) % available.length].id
          );
          return;
        }
        if (event.key === 'ArrowDown' && !event.altKey) {
          if (recentRef.current?.focusFirst()) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
      }}
      className="flex w-full min-w-0 flex-col gap-1.5"
    >
      <div ref={launcherMeasureRef}>
        <AgentLauncher
          setups={visibleLauncherSetups}
          selectedId={selectedLauncherId}
          state={launcherSettled ? 'ready' : 'settling'}
          axes={selectedLauncherId ? launcherAxes : []}
          detailFootnote="Changes apply to this Agent until you start it."
          task={task}
          onTaskChange={nextTask => {
            setTask(nextTask);
            reportDraftIntent({ draftTask: nextTask });
          }}
          onSelect={chooseLauncherSetup}
          onOpenCatalog={() => setAllConfigurationsOpen(open => !open)}
          onStart={() => void launchAgent()}
          launching={launching === 'agent'}
          blockedReason={launcherBlockedReason}
          placeholderCount={Math.max(2, capacity)}
        />
      </div>

      {allConfigurationsOpen && (
        <div
          data-all-launch-configurations
          className="rounded-md border p-1.5"
          style={{ borderColor: HUD.strokeSoft, background: HUD.bg.deep }}
        >
          <p className="px-2 py-1 font-mono text-chrome-meta text-hud-text-dim">
            All configurations
          </p>
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {ribbonTargets.map(entry => {
              const persistent =
                entry.target.kind === 'agent' &&
                configurationPool?.configurations.some(
                  configuration => configuration.id === entry.target.id
                );
              const pinned = projectPins.has(entry.target.id);
              return (
                <div
                  key={entry.target.id}
                  className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-hud-fill"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                    aria-label={entry.item.accessibleLabel}
                    onClick={() => {
                      if (entry.target.kind === 'shell') {
                        void openShell();
                      } else {
                        const agentTarget = entry.target;
                        const snapshot = sourceSnapshots.find(
                          source =>
                            source.id === agentTarget.sourceId ||
                            source.harness === agentTarget.sourceId
                        );
                        if (snapshot) {
                          applyAgentSelection(
                            snapshot.harness,
                            agentTarget.modelId,
                            agentTarget.effort
                          );
                        }
                      }
                      setAllConfigurationsOpen(false);
                    }}
                  >
                    <span style={{ color: HUD.text }}>{entry.item.label}</span>
                    {entry.item.detail ? (
                      <span className="ml-2 text-hud-text-dim">
                        {entry.item.detail}
                      </span>
                    ) : null}
                    {!entry.available ? (
                      <span className="ml-2 text-hud-amber">Unavailable</span>
                    ) : null}
                  </button>
                  {(entry.target.kind === 'shell' || persistent) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Manage ${entry.item.label}`}
                          className="h-8 w-8 shrink-0"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            void setLaunchConfigurationPinned(
                              projectDir,
                              entry.target.id,
                              !pinned
                            )
                              .then(setConfigurationPool)
                              .catch(() =>
                                setConfigurationMessage(
                                  'That pin could not be saved.'
                                )
                              );
                          }}
                        >
                          {pinned ? (
                            <PinOff className="h-3.5 w-3.5" />
                          ) : (
                            <Pin className="h-3.5 w-3.5" />
                          )}
                          {pinned
                            ? 'Unpin in this Project'
                            : 'Pin in this Project'}
                        </DropdownMenuItem>
                        {entry.target.kind === 'agent' && persistent && (
                          <>
                            <DropdownMenuItem
                              onSelect={() => {
                                if (entry.target.kind !== 'agent') return;
                                const agentTarget = entry.target;
                                const nextName = window.prompt(
                                  'Configuration name',
                                  agentTarget.name ?? ''
                                );
                                if (!nextName?.trim()) return;
                                void renameLaunchConfiguration(
                                  agentTarget.id,
                                  nextName
                                )
                                  .then(pool => {
                                    setConfigurationPool(pool);
                                    setFrozenTargets(current =>
                                      current.map(target =>
                                        target.kind === 'agent' &&
                                        target.id === agentTarget.id
                                          ? (pool.configurations.find(
                                              configuration =>
                                                configuration.id === target.id
                                            ) ?? target)
                                          : target
                                      )
                                    );
                                  })
                                  .catch(() =>
                                    setConfigurationMessage(
                                      'That name could not be saved.'
                                    )
                                  );
                              }}
                            >
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => {
                                if (
                                  !window.confirm(
                                    `Delete ${entry.item.label}? Launch history for it will also be removed.`
                                  )
                                ) {
                                  return;
                                }
                                void deleteLaunchConfiguration(entry.target.id)
                                  .then(pool => {
                                    setConfigurationPool(pool);
                                    setFrozenTargets(current =>
                                      current.filter(
                                        target => target.id !== entry.target.id
                                      )
                                    );
                                  })
                                  .catch(() =>
                                    setConfigurationMessage(
                                      'That configuration could not be deleted.'
                                    )
                                  );
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 grid gap-2 border-t border-hud-divider px-2 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 font-mono text-chrome-label text-hud-text">
                <input
                  type="checkbox"
                  checked={worktree}
                  onChange={event => {
                    const nextWorktree = event.target.checked;
                    setWorktree(nextWorktree);
                    onDraftChangeRef.current?.({
                      draftWorktree: nextWorktree,
                      draftBranch: branch,
                    });
                    reportDraftIntent({
                      draftWorktree: nextWorktree,
                      draftBranch: branch,
                    });
                  }}
                  className="accent-cyan-400"
                />
                <GitBranch aria-hidden="true" className="size-3.5" />
                New git worktree
              </label>
              {roadmapItems.length > 0 ? (
                <select
                  aria-label="Roadmap item this session will work on"
                  value={roadmapItemId}
                  onChange={event => {
                    const nextRoadmapItemId = event.target.value;
                    setRoadmapItemId(nextRoadmapItemId);
                    onDraftChangeRef.current?.({
                      draftRoadmapItemId: nextRoadmapItemId,
                    });
                    reportDraftIntent({
                      draftRoadmapItemId: nextRoadmapItemId,
                    });
                  }}
                  className="h-8 min-w-40 flex-1 rounded-md border border-hud-stroke-faint bg-hud-deep px-2 font-mono text-chrome-label text-hud-text outline-none focus-visible:ring-2 focus-visible:ring-hud-cyan"
                >
                  <option value="">No roadmap link</option>
                  {roadmapItems.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!currentConfigurationInput}
                className="ml-auto shrink-0 font-mono text-chrome-label"
                onClick={() => {
                  if (!currentConfigurationInput) return;
                  const nextName = window.prompt('Configuration name', '');
                  if (!nextName?.trim()) return;
                  void saveNamedLaunchConfiguration(
                    currentConfigurationInput,
                    nextName
                  )
                    .then(pool => {
                      setConfigurationPool(pool);
                      const saved = pool.configurations.find(
                        target => target.id === currentConfigurationId
                      );
                      if (saved) {
                        setFrozenTargets(current => {
                          const exists = current.some(
                            target => target.id === saved.id
                          );
                          return exists
                            ? current.map(target =>
                                target.id === saved.id ? saved : target
                              )
                            : [
                                ...current.filter(
                                  target => target.kind === 'agent'
                                ),
                                saved,
                                SHELL_LAUNCH_TARGET,
                              ];
                        });
                      }
                      setConfigurationMessage('Named configuration saved.');
                    })
                    .catch(() =>
                      setConfigurationMessage(
                        'That configuration name could not be saved.'
                      )
                    );
                }}
              >
                <Save aria-hidden="true" className="size-3.5" />
                Name setup…
              </Button>
            </div>
            {worktree ? (
              <input
                value={branch}
                onChange={event => {
                  branchEditSeq.current += 1;
                  const nextBranch = event.target.value;
                  setBranch(nextBranch);
                  onDraftChangeRef.current?.({ draftBranch: nextBranch });
                  reportDraftIntent({ draftBranch: nextBranch });
                }}
                aria-label="Branch name for the new worktree"
                aria-invalid={!branchReady}
                aria-describedby={branchReady ? undefined : branchErrorId}
                className="h-8 w-full rounded-md border border-hud-stroke-faint bg-hud-deep px-2 font-mono text-chrome-label text-hud-text outline-none focus-visible:ring-2 focus-visible:ring-hud-cyan"
              />
            ) : null}
            {worktree && !branchReady ? (
              <p
                id={branchErrorId}
                className="font-mono text-chrome-micro text-hud-red"
              >
                Enter a branch name before starting.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* D49 deleted the second control row this file used to render below the
          launcher: Engine, Model, Thinking and Permission live on the setup
          drawer, and the launch options (worktree, branch, roadmap item, Name
          setup…) live in the "All engines and models" catalog. The old row was
          left behind `hidden` instead of being removed, so it stayed in the DOM
          as UI no production interaction could reach — and nine eval scripts
          kept resolving to it and rotting silently (BUG-014). It is gone. */}
      {/* The composer's keyboard grammar is stated ONCE, by the New Agent
          surface that owns it (`launcher/agent-launcher.tsx`). This file used
          to print a second, older copy of the same keys — same chords, drifted
          words ("configuration" for what the launcher calls a setup) — so the
          highest-frequency path in the app carried two hint lines (BUG-017). */}
      {configurationMessage && (
        <p
          role="status"
          className="px-0.5 pt-1 font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          {configurationMessage}
        </p>
      )}
      {sourceActionMessage && (
        <div
          role="status"
          className="mt-1 flex min-h-7 items-center justify-between gap-3 rounded border px-2.5 py-1 font-mono text-chrome-micro leading-4"
          style={{
            color: sourceActionMessage.ok ? HUD.green : HUD.amber,
            borderColor: sourceActionMessage.ok
              ? withThemeAlpha(HUD.green, 0.28)
              : withThemeAlpha(HUD.amber, 0.32),
            background: sourceActionMessage.ok
              ? withThemeAlpha(HUD.green, 0.06)
              : withThemeAlpha(HUD.amber, 0.07),
          }}
        >
          <span>{sourceActionMessage.text}</span>
          {!sourceRegistryReady && (
            <button
              type="button"
              disabled={sourceRegistryStatus === 'loading'}
              onClick={() => void recheckSources()}
              className="shrink-0 rounded px-2 py-1 font-medium outline-none transition-colors hover:bg-hud-fill disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan"
            >
              {sourceRegistryStatus === 'loading' ? 'Checking…' : 'Recheck'}
            </button>
          )}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {launching === 'agent'
          ? `Starting ${sourceMeta.label} with ${modelLabel} and ${permissionMeta.label} permissions.`
          : launching === 'shell'
            ? `Opening a shell in ${projectName}.`
            : permissionSaveState === 'failed'
              ? 'This permission choice applies now but could not be saved.'
              : (sourceActionMessage?.text ?? '')}
      </span>
    </div>
  );

  return (
    <div className="flex w-full flex-col items-center px-5 sm:px-7">
      <div className="@container w-full max-w-3xl">
        {controls}
        <RecentConversations
          ref={recentRef}
          projectDir={projectDir}
          hidden={task.trim().length > 0}
          disabled={controlsDisabled || !preferencesReady}
          onOpen={openRecentConversation}
          onReturnToComposer={() => taskElement()?.focus()}
        />
      </div>
    </div>
  );
}
