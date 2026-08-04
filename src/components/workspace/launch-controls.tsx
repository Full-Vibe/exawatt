import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import {
  GitBranch,
  ExternalLink,
  LoaderCircle,
  MoreHorizontal,
  Pin,
  PinOff,
  Save,
  Settings2,
  Shapes,
  ShieldCheck,
  ShieldQuestion,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from './workspace-theme';
import { Button } from '@/components/ui/button';
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
import { HarnessGlyph } from './harness-icons';
import { SourceIdentityMark } from './source-identity-mark';
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
  launchConfigurationId,
  rankLaunchTargets,
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
  LaunchConfigurationRibbon,
  type LaunchConfigurationRibbonItem,
} from './launch-configuration-ribbon';
import { ModelPicker } from './model-picker';
import type { CommandPaletteLaunchConfiguration } from '@/components/shortcuts/command-palette-launch-configurations';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const UNRESOLVED_MODEL_VALUE = '__exawatt-unresolved-model__';

function effortChoiceKey(source: AgentSourceId, model: string): string {
  return `${source}:${model}`;
}

function displayEffortLabel(value: string): string {
  if (value === 'xhigh') return 'Extra high';
  return value.charAt(0).toUpperCase() + value.slice(1);
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
  const [catalogsBySource, setCatalogsBySource] = useState<
    Partial<Record<AgentSourceId, AgentModelCatalog>>
  >({});
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [allConfigurationsOpen, setAllConfigurationsOpen] = useState(false);
  const [configurationName, setConfigurationName] = useState('');
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
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const recentRef = useRef<RecentConversationsHandle>(null);
  const permissionDescriptionId = useId();
  const branchErrorId = useId();
  const preferencesReady = sourcePreferences !== null;
  const modelReady = modelCatalog !== null;
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
  const launchableSourceOrder = sourceSnapshots
    .filter(source => source.launchable)
    .map(source => source.harness);
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
  const defaultEffort =
    model === modelCatalog?.effectiveModel
      ? modelCatalog.effectiveEffort
      : (modelMeta?.defaultEffort ?? null);
  const modelOriginLabel =
    modelCatalog?.effectiveModelSource === 'config'
      ? `${sourceMeta.label} config`
      : modelCatalog?.effectiveModelSource === 'harness-recommended'
        ? `${sourceMeta.label} recommendation`
        : modelCatalog?.effectiveModelSource === 'account-default'
          ? `${sourceMeta.label} account default`
          : `${sourceMeta.label} default`;
  const effortOriginLabel =
    modelCatalog?.effectiveEffortSource === 'environment'
      ? 'environment override'
      : model !== modelCatalog?.effectiveModel
        ? `${modelLabel} default`
        : modelCatalog?.effectiveEffortSource === 'config'
          ? `${sourceMeta.label} config`
          : modelCatalog?.effectiveEffortSource === 'model-default'
            ? `${modelLabel} default`
            : `${sourceMeta.label} default`;
  const permissionMeta = AGENT_PERMISSION_MODE_META[permissionMode];
  const permissionColor =
    permissionMode === 'unrestricted'
      ? HUD.amber
      : permissionMode === 'auto'
        ? HUD.green
        : HUD.textDim;
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
  const catalogTargets: AgentLaunchConfiguration[] = [];
  const seenTargetIds = new Set<string>();
  for (const target of frozenTargets) {
    if (target.kind === 'agent' && !seenTargetIds.has(target.id)) {
      catalogTargets.push(target);
      seenTargetIds.add(target.id);
    }
  }
  for (const sourceId of launchableSourceOrder) {
    const catalog = catalogsBySource[sourceId];
    if (!catalog?.effectiveModel) continue;
    const option = catalog.models.find(
      candidate => candidate.id === catalog.effectiveModel
    );
    const sourceSnapshot = sourceSnapshots.find(
      candidate => candidate.harness === sourceId
    );
    try {
      const target = createAgentLaunchConfiguration(
        {
          sourceId: sourceSnapshot?.id ?? sourceId,
          modelId: catalog.effectiveModel,
          effort: catalog.effectiveEffort,
          labels: {
            source: sourceSnapshot?.label ?? sourceId,
            model: option?.label ?? catalog.effectiveModelLabel,
            effort: catalog.effectiveEffortLabel,
          },
        },
        0
      );
      if (!seenTargetIds.has(target.id)) {
        catalogTargets.push(target);
        seenTargetIds.add(target.id);
      }
    } catch {
      // A malformed source-owned identity is not made selectable.
    }
  }
  if (currentConfigurationInput && !seenTargetIds.has(currentConfigurationId)) {
    catalogTargets.unshift(
      createAgentLaunchConfiguration(currentConfigurationInput)
    );
    seenTargetIds.add(currentConfigurationId);
  }

  const targetAvailability = (
    target: AgentLaunchConfiguration
  ): { available: boolean; reason?: string } => {
    const snapshot = sourceSnapshots.find(
      candidate => candidate.id === target.sourceId
    );
    if (!snapshot) {
      return {
        available: false,
        reason: `Agent Source ${target.labels.source ?? target.sourceId} is not installed.`,
      };
    }
    if (!snapshot?.launchable) {
      return {
        available: false,
        reason: snapshot
          ? `${snapshot.label}: ${snapshot.stateLabel}`
          : `Agent Source ${target.sourceId} is unavailable.`,
      };
    }
    const catalog = catalogsBySource[snapshot.harness];
    if (!catalog) {
      return { available: false, reason: 'Checking model availability…' };
    }
    const exactModelAvailable =
      target.modelId === catalog.effectiveModel ||
      catalog.models.some(option => option.id === target.modelId);
    return exactModelAvailable
      ? { available: true }
      : {
          available: false,
          reason: `${target.labels.model ?? target.modelId} is not available from ${snapshot.label}.`,
        };
  };

  const ribbonTargets: Array<{
    target: LaunchTarget;
    item: LaunchConfigurationRibbonItem;
    available: boolean;
  }> = catalogTargets.map(target => {
    const availability = targetAvailability(target);
    const sourceLabel = target.labels.source ?? target.sourceId;
    const modelDisplay = target.labels.model ?? target.modelId;
    const effortDisplay = target.labels.effort ?? target.effort;
    const label = target.name ?? modelDisplay;
    const identity = [
      sourceLabel,
      modelDisplay,
      effortDisplay,
      target.labels.type,
    ]
      .filter(Boolean)
      .join(', ');
    return {
      target,
      available: availability.available,
      item: {
        id: target.id,
        label,
        detail: target.name
          ? [modelDisplay, effortDisplay].filter(Boolean).join(' · ')
          : effortDisplay || undefined,
        accessibleLabel: target.name ? `${target.name}: ${identity}` : identity,
        source:
          sourceSnapshots.find(candidate => candidate.id === target.sourceId)
            ?.harness ?? 'claude',
        named: Boolean(target.name),
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
    setConfigurationName('');
    setConfigurationMessage(null);
    setCatalogsBySource({});
    setConfigurationPool(null);
    setFrozenTargets([SHELL_LAUNCH_TARGET]);
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
    const frame = requestAnimationFrame(() => taskRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const focus = (request?: AgentComposerRequest) => {
      if (typeof request === 'string') {
        applyAgentSelection(request, null, null);
      } else if (request?.configuration?.kind === 'shell') {
        setSelectedTargetKind('shell');
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
          setSelectedTargetKind('shell');
        } else if (target?.kind === 'agent') {
          const snapshot = sourceSnapshots.find(
            candidate => candidate.id === target.sourceId
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
      requestAnimationFrame(() => taskRef.current?.focus());
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
  }, [applyAgentSelection, frozenTargets, sourceSnapshots]);

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
      const nextTask = task.slice(0, start) + value + task.slice(end);
      setTask(nextTask);
      reportDraftIntent({ draftTask: nextTask });
      requestAnimationFrame(() => {
        const node = taskRef.current;
        if (!node) return;
        node.focus();
        const caret = start + value.length;
        node.setSelectionRange(caret, caret);
      });
    },
    [reportDraftIntent, task, setTask]
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

  const launchSelected = () =>
    selectedTargetKind === 'shell' ? openShell() : launchAgent();

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

  const controls = (
    <form
      data-agent-composer
      data-preferences-ready={preferencesReady}
      aria-busy={launching !== null}
      onPointerDownCapture={() => onUserInteractionRef.current?.()}
      onKeyDownCapture={() => onUserInteractionRef.current?.()}
      onSubmit={event => {
        event.preventDefault();
        void launchSelected();
      }}
      className="flex w-full min-w-0 flex-col gap-1.5"
    >
      <textarea
        ref={taskRef}
        rows={1}
        value={task}
        maxLength={8_000}
        disabled={controlsDisabled}
        onChange={event => {
          const nextTask = event.target.value;
          setTask(nextTask);
          reportDraftIntent({ draftTask: nextTask });
        }}
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
            void launchSelected();
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
            const order = ribbonTargets.filter(
              entry => entry.target.kind === 'agent' && entry.available
            );
            if (order.length < 2) {
              if (launchableSourceOrder.length < 2) return;
              const sourceIndex =
                launchableSourceOrder.indexOf(effectiveSource);
              const sourceStep =
                event.key === 'ArrowDown'
                  ? 1
                  : launchableSourceOrder.length - 1;
              const nextSource =
                launchableSourceOrder[
                  ((sourceIndex < 0 ? 0 : sourceIndex) + sourceStep) %
                    launchableSourceOrder.length
                ];
              reportDraftIntent({
                draftSource: nextSource,
                draftModel: null,
                draftEffort: null,
              });
              applyAgentSelection(nextSource, null, null);
              return;
            }
            const index = order.findIndex(
              entry => entry.item.id === selectedTargetId
            );
            const step = event.key === 'ArrowDown' ? 1 : order.length - 1;
            const next = order[((index < 0 ? 0 : index) + step) % order.length];
            if (next.target.kind !== 'agent') return;
            const nextTarget = next.target;
            const snapshot = sourceSnapshots.find(
              candidate => candidate.id === nextTarget.sourceId
            );
            if (!snapshot) return;
            reportDraftIntent({
              draftSource: snapshot.harness,
              draftModel: nextTarget.modelId,
              draftEffort: nextTarget.effort,
            });
            applyAgentSelection(
              snapshot.harness,
              nextTarget.modelId,
              nextTarget.effort
            );
            return;
          }
          if (event.key === 'ArrowDown' && task === '') {
            if (recentRef.current?.focusFirst()) event.preventDefault();
          }
        }}
        placeholder="What should this Agent do?"
        aria-label="Initial task for the new Agent"
        className="max-h-40 min-h-11 w-full resize-none rounded border bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none transition-colors [field-sizing:content] placeholder:text-hud-text-dim/80 hover:border-hud-cyan/40 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        style={{
          color: HUD.text,
          borderColor: HUD.strokeSoft,
          background: HUD.surfaceInput,
        }}
      />

      <div className="flex min-w-0 items-center gap-2">
        <LaunchConfigurationRibbon
          className="min-w-0 flex-1"
          items={ribbonTargets.map(entry => entry.item)}
          selectedId={selectedTargetId}
          onSelect={id => {
            const entry = ribbonTargets.find(
              candidate => candidate.item.id === id
            );
            if (!entry) return;
            if (entry.target.kind === 'shell') {
              setSelectedTargetKind('shell');
              return;
            }
            const agentTarget = entry.target;
            const snapshot = sourceSnapshots.find(
              candidate => candidate.id === agentTarget.sourceId
            );
            if (!snapshot) return;
            applyAgentSelection(
              snapshot.harness,
              agentTarget.modelId,
              agentTarget.effort
            );
          }}
          onCustomize={() => {
            setCustomizeOpen(open => !open);
            setAllConfigurationsOpen(false);
          }}
          onShowAll={() => {
            setAllConfigurationsOpen(open => !open);
            setCustomizeOpen(false);
          }}
          alwaysShowAll={ribbonTargets.length > 1}
          allLabel="All configurations…"
        />
        <Button
          type="submit"
          aria-busy={launching !== null}
          aria-label={
            launching === 'shell'
              ? 'Opening shell…'
              : launching === 'agent'
                ? 'Starting…'
                : selectedTargetKind === 'shell'
                  ? 'Open shell'
                  : 'Start'
          }
          data-agent-start-button
          disabled={
            controlsDisabled ||
            (selectedTargetKind === 'agent' &&
              (!launchReady ||
                (model !== null && selectedRibbonTarget?.available !== true)))
          }
          className="min-w-20 shrink-0 motion-reduce:transition-none"
        >
          {launching !== null && (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          )}
          {launching === 'shell'
            ? 'Opening…'
            : launching === 'agent'
              ? 'Starting…'
              : selectedTargetKind === 'shell'
                ? 'Open shell'
                : 'Start'}
        </Button>
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
                        setSelectedTargetKind('shell');
                      } else {
                        const agentTarget = entry.target;
                        const snapshot = sourceSnapshots.find(
                          source => source.id === agentTarget.sourceId
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
        </div>
      )}

      <div
        data-launch-customize
        hidden={!customizeOpen}
        className={
          customizeOpen
            ? 'flex min-w-0 flex-wrap items-center justify-between gap-1 rounded-md border p-2'
            : 'hidden'
        }
        style={{ borderColor: HUD.strokeSoft, background: HUD.surfaceInput }}
      >
        <div className="flex min-w-0 items-center gap-1 @max-[520px]:flex-wrap">
          <Select
            value={effectiveSource}
            disabled={
              !preferencesReady || !sourceRegistryReady || controlsDisabled
            }
            onValueChange={value => {
              if (!isAgentSourceId(value)) return;
              delete modelChoicesRef.current[value];
              reportDraftIntent({
                draftSource: value,
                draftModel: null,
                draftEffort: null,
              });
              applyAgentSelection(value, null, null);
            }}
          >
            <SelectTrigger
              aria-label="Agent Source"
              title={
                preferencesReady
                  ? `Agent Source: ${sourceMeta.label}`
                  : 'Loading Agent Source'
              }
              className="h-9 w-[136px] shrink-0 rounded border px-2 font-mono text-xs shadow-none transition-[border-color,filter] duration-150 hover:brightness-110 focus:ring-hud-cyan data-[state=open]:brightness-110 motion-reduce:transition-none"
              style={{
                color: HUD.text,
                borderColor: HUD.strokeSoft,
                background: HUD.bg.deep,
              }}
            >
              {preferencesReady ? (
                <span className="flex min-w-0 items-center gap-2">
                  <SourceIdentityMark color={sourceMeta.color}>
                    <HarnessGlyph harness={effectiveSource} size={12} />
                  </SourceIdentityMark>
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
              {sourceSnapshots.map(sourceOption => {
                const id = sourceOption.harness;
                return (
                  <SelectItem
                    key={id}
                    value={id}
                    disabled={!sourceOption.launchable}
                    textValue={`${sourceOption.label} ${sourceOption.stateLabel}`}
                    className="font-mono"
                  >
                    {/* Options own their menu presentation independently of the
                  trigger: glyph + brand color, with no selection flash. */}
                    <span className="flex items-center gap-2">
                      <SourceIdentityMark color={sourceOption.color}>
                        <HarnessGlyph harness={id} size={11} />
                      </SourceIdentityMark>
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <span>{sourceOption.label}</span>
                        {!sourceOption.launchable && (
                          <span className="text-chrome-micro uppercase tracking-[0.1em] text-hud-text-dim">
                            {sourceOption.stateLabel}
                          </span>
                        )}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {modelCatalog?.selectionAction === 'choose-in-source' ? (
            <Button
              type="button"
              variant="outline"
              disabled={!modelReady || controlsDisabled}
              onClick={() => {
                setSourceActionMessage(null);
                void runAgentSourceAction(effectiveSource, 'choose-model').then(
                  result =>
                    setSourceActionMessage({
                      ok: result.ok,
                      text: result.message,
                    })
                );
              }}
              aria-label={`Agent model: ${modelLabel}. Choose in ${sourceMeta.label}`}
              className="h-9 max-w-48 shrink-0 justify-between gap-2 font-mono text-xs"
            >
              <span className="truncate">{modelLabel}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </Button>
          ) : (
            <ModelPicker
              models={modelOptions}
              value={model}
              onValueChange={value => {
                const nextModel = modelOptions.find(
                  option => option.id === value
                );
                if (!nextModel) return;
                const nextEffortKey = effortChoiceKey(effectiveSource, value);
                const nextEffort = modelCatalog?.effortLocked
                  ? (modelCatalog.effectiveEffort ?? null)
                  : (effortChoicesRef.current[nextEffortKey] ??
                    (value === modelCatalog?.effectiveModel
                      ? modelCatalog.effectiveEffort
                      : null) ??
                    nextModel.defaultEffort ??
                    null);
                modelChoicesRef.current[effectiveSource] = value;
                if (nextEffort) {
                  effortChoicesRef.current[nextEffortKey] = nextEffort;
                }
                setSelectedTargetKind('agent');
                setModel(value);
                setEffort(nextEffort);
                onDraftChangeRef.current?.({
                  draftModel: value,
                  draftEffort: nextEffort,
                });
                reportDraftIntent({
                  draftModel: value,
                  draftEffort: nextEffort,
                });
              }}
              sourceLabel={sourceMeta.label}
              catalogProvenance={
                modelCatalog?.catalogProvenance ??
                `Detecting ${sourceMeta.label} models…`
              }
              defaultModelId={modelCatalog?.effectiveModel}
              defaultModelDescription={`Default from ${modelOriginLabel}.`}
              loading={!modelReady}
              disabled={controlsDisabled}
              className="w-[min(18rem,48vw)]"
            />
          )}

          <div className="hidden" hidden aria-hidden="true">
            {modelCatalog?.selectionAction === 'choose-in-source' ? (
              <button
                type="button"
                disabled={!modelReady || controlsDisabled}
                onClick={() => {
                  setSourceActionMessage(null);
                  void runAgentSourceAction(
                    effectiveSource,
                    'choose-model'
                  ).then(result =>
                    setSourceActionMessage({
                      ok: result.ok,
                      text: result.message,
                    })
                  );
                }}
                aria-label={`Agent model: ${modelLabel}. Choose in ${sourceMeta.label}`}
                title={`${modelLabel} · choose in ${sourceMeta.label}`}
                className="flex h-9 w-[168px] shrink-0 items-center justify-between gap-2 rounded border px-2 font-mono text-xs outline-none transition-[border-color,filter] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan @max-[560px]:w-[152px] motion-reduce:transition-none"
                style={{
                  color: HUD.text,
                  borderColor: HUD.strokeSoft,
                  background: HUD.bg.deep,
                }}
              >
                <span className="min-w-0 truncate">{modelLabel}</span>
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              </button>
            ) : (
              <Select
                value={model ?? UNRESOLVED_MODEL_VALUE}
                disabled={
                  !modelReady || controlsDisabled || modelOptions.length === 0
                }
                onValueChange={value => {
                  const nextModel = modelOptions.find(
                    option => option.id === value
                  );
                  if (!nextModel) return;
                  const nextEffortKey = effortChoiceKey(effectiveSource, value);
                  const nextEffort = modelCatalog?.effortLocked
                    ? (modelCatalog.effectiveEffort ?? null)
                    : (effortChoicesRef.current[nextEffortKey] ??
                      (value === modelCatalog?.effectiveModel
                        ? modelCatalog.effectiveEffort
                        : null) ??
                      nextModel.defaultEffort ??
                      null);
                  modelChoicesRef.current[effectiveSource] = value;
                  if (nextEffort) {
                    effortChoicesRef.current[nextEffortKey] = nextEffort;
                  }
                  setModel(value);
                  setEffort(nextEffort);
                  onDraftChangeRef.current?.({
                    draftModel: value,
                    draftEffort: nextEffort,
                  });
                  reportDraftIntent({
                    draftModel: value,
                    draftEffort: nextEffort,
                  });
                }}
              >
                <SelectTrigger
                  aria-label="Agent model"
                  title={
                    modelReady
                      ? `Agent model: ${modelLabel}. Default from ${modelOriginLabel}.`
                      : `Detecting ${sourceMeta.label} model`
                  }
                  className="h-9 w-[168px] shrink-0 rounded border px-2 font-mono text-xs shadow-none transition-[border-color,filter] duration-150 hover:brightness-110 focus:ring-hud-cyan data-[state=open]:brightness-110 @max-[560px]:w-[152px] motion-reduce:transition-none"
                  style={{
                    color: HUD.text,
                    borderColor: HUD.strokeSoft,
                    background: HUD.bg.deep,
                  }}
                >
                  {modelReady ? (
                    <span className="min-w-0 truncate">
                      <SelectValue>{modelLabel}</SelectValue>
                    </span>
                  ) : (
                    <span
                      className="flex min-w-0 items-center gap-1.5 truncate"
                      style={{ color: HUD.textDim }}
                    >
                      <LoaderCircle
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none"
                      />
                      Detecting…
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent className="w-[min(23rem,calc(100vw-1.5rem))] border-hud-cyan/25 bg-hud-deep shadow-xl">
                  <SelectGroup>
                    <SelectLabel className="px-2 pb-1 pt-2 font-mono text-chrome-meta font-medium text-hud-text-dim">
                      {sourceMeta.label} model
                    </SelectLabel>
                    {modelOptions.map(option => (
                      <SelectItem
                        key={option.id}
                        value={option.id}
                        textValue={`${option.label} ${option.description}`}
                        className="items-start py-2.5 pl-2 pr-8 font-mono [&>span:first-child]:top-3"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-baseline gap-2">
                            <span className="text-xs font-semibold text-hud-text">
                              {option.label}
                            </span>
                            {option.id === modelCatalog?.effectiveModel && (
                              <span className="text-chrome-micro uppercase tracking-[0.12em] text-hud-cyan">
                                default
                              </span>
                            )}
                          </span>
                          <span className="text-chrome-meta leading-4 text-hud-text-dim">
                            {option.description}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator className="bg-hud-cyan/15" />
                  <p className="px-2 py-1.5 font-mono text-chrome-meta leading-4 text-hud-text-dim">
                    {model === modelCatalog?.effectiveModel
                      ? `Default from ${modelOriginLabel}.`
                      : `This override applies only to this Agent.`}
                  </p>
                </SelectContent>
              </Select>
            )}
          </div>

          <Select
            value={effort ?? UNRESOLVED_MODEL_VALUE}
            disabled={
              !modelReady ||
              controlsDisabled ||
              effortOptions.length === 0 ||
              modelCatalog?.effortLocked
            }
            onValueChange={value => {
              if (
                !model ||
                !effortOptions.some(option => option.id === value)
              ) {
                return;
              }
              effortChoicesRef.current[
                effortChoiceKey(effectiveSource, model)
              ] = value;
              setEffort(value);
              onDraftChangeRef.current?.({ draftEffort: value });
              reportDraftIntent({ draftEffort: value });
            }}
          >
            <SelectTrigger
              aria-label="Agent effort"
              title={
                modelCatalog?.effortLocked
                  ? `Agent effort: ${effortLabel}. Fixed by ${effortOriginLabel}.`
                  : modelReady
                    ? `Agent effort: ${effortLabel}. Default from ${effortOriginLabel}.`
                    : `Detecting ${sourceMeta.label} effort`
              }
              className="h-9 w-[112px] shrink-0 rounded border px-2 font-mono text-xs shadow-none transition-[border-color,filter] duration-150 hover:brightness-110 focus:ring-hud-cyan data-[state=open]:brightness-110 @max-[560px]:w-[96px] motion-reduce:transition-none"
              style={{
                color: HUD.text,
                borderColor: HUD.strokeSoft,
                background: HUD.bg.deep,
              }}
            >
              {modelReady ? (
                <span className="min-w-0 truncate">
                  <SelectValue>{effortLabel}</SelectValue>
                </span>
              ) : (
                <span
                  className="flex min-w-0 items-center gap-1.5 truncate"
                  style={{ color: HUD.textDim }}
                >
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none"
                  />
                  Detecting…
                </span>
              )}
            </SelectTrigger>
            <SelectContent className="w-[min(21rem,calc(100vw-1.5rem))] border-hud-cyan/25 bg-hud-deep shadow-xl">
              <SelectGroup>
                <SelectLabel className="px-2 pb-1 pt-2 font-mono text-chrome-meta font-medium text-hud-text-dim">
                  {modelLabel} effort
                </SelectLabel>
                {effortOptions.map(option => (
                  <SelectItem
                    key={option.id}
                    value={option.id}
                    textValue={`${option.label} ${option.description}`}
                    className="items-start py-2.5 pl-2 pr-8 font-mono [&>span:first-child]:top-3"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-hud-text">
                          {option.label}
                        </span>
                        {option.id === defaultEffort && (
                          <span className="text-chrome-micro uppercase tracking-[0.12em] text-hud-cyan">
                            default
                          </span>
                        )}
                      </span>
                      <span className="text-chrome-meta leading-4 text-hud-text-dim">
                        {option.description}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator className="bg-hud-cyan/15" />
              <p className="px-2 py-1.5 font-mono text-chrome-meta leading-4 text-hud-text-dim">
                {effort === defaultEffort
                  ? `Default from ${effortOriginLabel}.`
                  : `This override applies only to this Agent.`}
              </p>
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
                    ? withThemeAlpha(HUD.red, 0.53)
                    : permissionMode === 'unrestricted'
                      ? withThemeAlpha(HUD.amber, 0.4)
                      : HUD.strokeSoft,
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
                <SelectLabel className="px-2 pb-1 pt-2 font-mono text-chrome-meta font-medium text-hud-text-dim">
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
                            <span className="text-chrome-meta leading-4 text-hud-text-dim">
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
                className="px-2 py-1.5 font-mono text-chrome-meta leading-4"
                style={{
                  color:
                    usedSafePreferenceFallback ||
                    permissionSaveState === 'failed'
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
                  borderColor: HUD.strokeSoft,
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
                borderColor: HUD.strokeSoft,
              }}
            >
              <label
                className="flex cursor-pointer items-center gap-2 font-mono text-xs"
                style={{ color: HUD.text }}
              >
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
                <GitBranch className="h-3.5 w-3.5" />
                New git worktree
              </label>
              {worktree && (
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
                  className="mt-2 h-8 w-full rounded border bg-transparent px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{
                    color: HUD.cyan,
                    borderColor: withThemeAlpha(HUD.cyan, 0.3),
                  }}
                />
              )}
              {worktree && !branchReady && (
                <p
                  id={branchErrorId}
                  className="mt-1 font-mono text-chrome-micro"
                  style={{ color: HUD.red }}
                >
                  Enter a branch name before starting.
                </p>
              )}
              {roadmapItems.length > 0 && (
                <label
                  className="mt-3 block font-mono text-chrome-micro"
                  style={{ color: HUD.textDim }}
                >
                  Working on
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
                    className="mt-1 h-8 w-full rounded border bg-transparent px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                    style={{
                      color: HUD.text,
                      borderColor: HUD.strokeSoft,
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

          <div
            className="flex h-9 min-w-40 items-center gap-1 rounded border px-1.5"
            style={{ borderColor: HUD.strokeSoft }}
          >
            <input
              value={configurationName}
              maxLength={80}
              onChange={event => setConfigurationName(event.target.value)}
              aria-label="Name this launch configuration"
              placeholder="Optional name"
              className="min-w-0 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:text-hud-text-dim"
              style={{ color: HUD.text }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!currentConfigurationInput || !configurationName.trim()}
              aria-label="Save configuration name"
              title="Save as a named configuration"
              className="h-7 w-7 shrink-0"
              onClick={() => {
                if (!currentConfigurationInput || !configurationName.trim())
                  return;
                void saveNamedLaunchConfiguration(
                  currentConfigurationInput,
                  configurationName
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
              <Save className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Agent Types preview's contextual anchor (ENG-026 N5 / ENG-028):
              the composer source row is where "what kind of worker" will be
              chosen, beside "which engine". Real navigation to the designed
              surface, muted like a Coming soon ⌘K row — not an announced
              chip, because it works. */}
          <Link
            href="/agent-types"
            data-agent-types-anchor
            aria-label="Agent Types — coming soon. What kind of worker this is, not just which engine runs it."
            title="Agent Types — Coming soon. What kind of worker this is, not just which engine runs it."
            className="grid h-9 w-9 shrink-0 place-items-center rounded border outline-none transition-[filter,transform] duration-150 hover:brightness-125 active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
            style={{ color: HUD.textDim, borderColor: HUD.strokeSoft }}
          >
            <Shapes className="h-4 w-4" />
          </Link>
        </div>

        <div className="hidden" hidden aria-hidden="true">
          <Button
            type="submit"
            aria-busy={launching === 'agent'}
            aria-label={launching === 'agent' ? 'Starting…' : 'Start'}
            data-agent-start-button
            disabled={controlsDisabled || !launchReady}
            title={
              launchReady
                ? `Start ${sourceMeta.label} with ${modelLabel} and ${permissionMeta.label} permissions`
                : !preferencesReady
                  ? 'Loading launch preferences'
                  : !sourceRegistryReady
                    ? sourceRegistryStatus === 'loading'
                      ? 'Checking Agent Sources'
                      : 'Agent Source status unavailable — recheck required'
                    : !sourceMeta.launchable
                      ? `${sourceMeta.label}: ${sourceMeta.stateLabel}`
                      : 'Enter a worktree branch name before starting'
            }
            className="min-w-20 shrink-0 @max-[520px]:flex-1 motion-reduce:transition-none"
          >
            {launching === 'agent' && (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
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
      </div>
      {/* the keyboard grammar teaches itself (D21): ⌘T is a complete
          keyboard path, so its keys are visible where they apply */}
      <p
        data-composer-hints
        aria-hidden="true"
        className="px-0.5 pt-0.5 font-mono text-chrome-micro leading-none"
        style={{ color: HUD.textDim }}
      >
        ⏎ start · ↓ recent · ⌥↑↓ configuration · ⌘⌥T shell · ⌘V image · ⇧⏎
        newline
      </p>
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
      <div className="@container mt-3 w-full max-w-3xl">
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
