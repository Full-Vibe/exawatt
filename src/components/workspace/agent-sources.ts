import type {
  AgentHarness,
  AgentModelCatalog,
  AgentPermissionMode,
  AgentSourceAction,
  AgentSourceActionResult,
  AgentSourceAdapterId,
  AgentSourceCatalogEntry,
  AgentSourceRegistryLoadResult,
  AgentSourceRegistrySnapshot,
  AgentSourceSnapshot,
} from '@/types/electron';
import {
  agentSourceDeclaration,
  AGENT_SOURCE_DECLARATIONS,
  FUTURE_AGENT_SOURCE_CATALOG,
} from '@/generated/agent-source-declarations';

export type AgentSourceId = AgentHarness;

export const AGENT_PERMISSION_MODE_ORDER = [
  'prompt',
  'auto',
  'unrestricted',
] as const satisfies readonly AgentPermissionMode[];

export const DEFAULT_AGENT_PERMISSION_MODE: AgentPermissionMode =
  'unrestricted';

export const AGENT_PERMISSION_MODE_META: Record<
  AgentPermissionMode,
  {
    label: string;
    shortLabel: string;
    description: string;
  }
> = {
  prompt: {
    label: 'Ask first',
    shortLabel: 'Ask',
    description:
      'Keep harness protections on and ask before sensitive actions.',
  },
  auto: {
    label: 'Auto-review',
    shortLabel: 'Auto',
    description:
      'Let the harness review actions. Routine work proceeds; risky work asks or stops.',
  },
  unrestricted: {
    label: 'YOLO',
    shortLabel: 'YOLO',
    description:
      'No approvals or sandbox. The Agent can do anything this user can.',
  },
};

export interface AgentSourceMeta {
  label: string;
  color: string;
  capabilities: {
    interactive: boolean;
    initialTask: boolean;
    exactResume: boolean;
    modelSelection: boolean;
    effortSelection: boolean;
    permissionModes: readonly AgentPermissionMode[];
  };
}

export const AGENT_SOURCE_META: Record<AgentSourceId, AgentSourceMeta> = {
  claude: (() => {
    const declaration = agentSourceDeclaration('claude');
    return {
      label: declaration.label,
      color: declaration.color,
      capabilities: {
        interactive: declaration.capabilities.interactiveLaunch,
        initialTask: declaration.capabilities.initialTask,
        exactResume: declaration.capabilities.exactResume,
        modelSelection: true,
        effortSelection: true,
        permissionModes: declaration.capabilities.permissionModes,
      },
    };
  })(),
  codex: (() => {
    const declaration = agentSourceDeclaration('codex');
    return {
      label: declaration.label,
      color: declaration.color,
      capabilities: {
        interactive: declaration.capabilities.interactiveLaunch,
        initialTask: declaration.capabilities.initialTask,
        exactResume: declaration.capabilities.exactResume,
        modelSelection: true,
        effortSelection: true,
        permissionModes: declaration.capabilities.permissionModes,
      },
    };
  })(),
  opencode: (() => {
    const declaration = agentSourceDeclaration('opencode');
    return {
      label: declaration.label,
      color: declaration.color,
      capabilities: {
        interactive: declaration.capabilities.interactiveLaunch,
        initialTask: declaration.capabilities.initialTask,
        exactResume: declaration.capabilities.exactResume,
        modelSelection: true,
        effortSelection: true,
        permissionModes: declaration.capabilities.permissionModes,
      },
    };
  })(),
  grok: (() => {
    const declaration = agentSourceDeclaration('grok');
    return {
      label: declaration.label,
      color: declaration.color,
      capabilities: {
        interactive: declaration.capabilities.interactiveLaunch,
        initialTask: declaration.capabilities.initialTask,
        exactResume: declaration.capabilities.exactResume,
        modelSelection:
          declaration.capabilities.modelSelection !== 'source-owned',
        // Grok Build accepts `--reasoning-effort` but publishes no per-model
        // option set to any interface a PTY launch can read, so Exawatt shows
        // no effort control rather than inventing one.
        effortSelection:
          declaration.capabilities.effortSelection !== 'source-owned',
        permissionModes: declaration.capabilities.permissionModes,
      },
    };
  })(),
};

export const AGENT_SOURCE_ORDER = Object.keys(
  AGENT_SOURCE_META
) as AgentSourceId[];

const fallbackObservedAt = 0;

function fallbackFact(
  value: string,
  detail: string,
  simulated = false
): AgentSourceSnapshot['facts']['installation'] {
  return {
    basis: simulated ? 'simulated' : 'declared',
    state: simulated ? 'simulated' : 'unknown',
    value,
    detail,
    provenance: {
      kind: simulated ? 'simulation' : 'adapter-declaration',
      label: simulated
        ? 'Exawatt Demo Scenario Source'
        : 'Renderer compatibility fallback',
      observedAt: fallbackObservedAt,
    },
  };
}

function fallbackLocalSource(id: AgentSourceId): AgentSourceSnapshot {
  const declaration = agentSourceDeclaration(id);
  const fact = fallbackFact(
    'Unknown',
    'Open the Electron desktop app to inspect this local source.'
  );
  return {
    ...declaration,
    id: `${id}-local`,
    configured: false,
    launchable: false,
    state: 'unknown',
    stateLabel: 'Unknown',
    summary:
      'Local source status is available through the Electron desktop bridge.',
    observedAt: fallbackObservedAt,
    // Nothing was probed at all here: without the bridge there is no login
    // shell to ask. Declaring that keeps a fallback snapshot from reading as
    // an observed verdict (BUG-063).
    unobservedProbes: [
      'installation',
      'version',
      'authentication',
      'model catalog',
    ],
    facts: {
      installation: fact,
      reachability: fact,
      authentication: fact,
      identity: fact,
      compatibility: fact,
      modelDiscovery: fact,
    },
    capabilities: {
      ...declaration.capabilities,
    },
    actions: {
      recheck: false,
      authenticate: false,
      chooseModel: false,
      installGuide: false,
    },
  };
}

function fallbackDemoSource(): AgentSourceSnapshot {
  const declaration = agentSourceDeclaration('demo');
  const fact = fallbackFact(
    'Simulated',
    'Fixture data with explicit simulated provenance.',
    true
  );
  return {
    ...declaration,
    id: 'demo-built-in',
    configured: true,
    launchable: false,
    state: 'ready',
    stateLabel: 'Ready',
    summary:
      'Demo Mode exercises the same source-facing concepts without a live harness.',
    observedAt: fallbackObservedAt,
    unobservedProbes: [],
    facts: {
      installation: fact,
      reachability: fact,
      authentication: fact,
      identity: fact,
      compatibility: fact,
      modelDiscovery: fact,
    },
    actions: {
      recheck: false,
      authenticate: false,
      chooseModel: false,
      installGuide: false,
    },
  };
}

function fallbackOpenClawSource(): AgentSourceSnapshot {
  const declaration = agentSourceDeclaration('openclaw');
  const fact = fallbackFact(
    'Unknown',
    'Open the Electron desktop app to inspect the local gateway.'
  );
  return {
    ...declaration,
    id: 'openclaw-local',
    configured: false,
    launchable: false,
    state: 'unknown',
    stateLabel: 'Unknown',
    summary: 'Local gateway status is available through the desktop bridge.',
    observedAt: fallbackObservedAt,
    unobservedProbes: ['installation', 'gateway'],
    facts: {
      installation: fact,
      reachability: fact,
      authentication: fact,
      identity: fact,
      compatibility: fact,
      modelDiscovery: fact,
    },
    actions: {
      recheck: false,
      authenticate: false,
      chooseModel: false,
      installGuide: false,
    },
  };
}

export function fallbackAgentSourceRegistry(
  scope: 'all' | 'launch' = 'all'
): AgentSourceRegistrySnapshot {
  const local = AGENT_SOURCE_ORDER.map(fallbackLocalSource);
  const sources =
    scope === 'launch'
      ? local
      : [...local, fallbackOpenClawSource(), fallbackDemoSource()];
  return {
    sources,
    available: sources.map(source => ({
      adapterId: source.adapterId,
      label: source.label,
      description: source.summary,
      availability: source.configured ? 'configured' : 'configure',
    })),
    comingSoon: scope === 'all' ? [...FUTURE_AGENT_SOURCE_CATALOG] : [],
    observedAt: fallbackObservedAt,
  };
}

export async function loadAgentSourceRegistry(
  scope: 'all' | 'launch' = 'all',
  refresh = false,
  previous?: AgentSourceRegistrySnapshot
): Promise<AgentSourceRegistryLoadResult> {
  const list =
    typeof window !== 'undefined' ? window.electron?.agentSources?.list : null;
  if (!list) {
    return {
      status: previous ? 'stale' : 'unavailable',
      snapshot: previous ?? fallbackAgentSourceRegistry(scope),
      error: {
        code: 'bridge-unavailable',
        message: 'Agent Source status requires the Electron desktop bridge.',
      },
    };
  }
  try {
    return {
      status: 'live',
      snapshot: await list(scope, refresh),
      error: null,
    };
  } catch {
    return {
      status: previous ? 'stale' : 'unavailable',
      snapshot: previous ?? fallbackAgentSourceRegistry(scope),
      error: {
        code: 'observation-failed',
        message:
          'Exawatt could not verify Agent Source status. Recheck before launching.',
      },
    };
  }
}

export async function runAgentSourceAction(
  adapterId: AgentSourceAdapterId,
  action: AgentSourceAction
): Promise<AgentSourceActionResult> {
  const act =
    typeof window !== 'undefined' ? window.electron?.agentSources?.act : null;
  if (!act) {
    return {
      ok: false,
      message: 'This source action is available in the Electron desktop app.',
    };
  }
  try {
    return await act(adapterId, action);
  } catch {
    return { ok: false, message: 'The source action could not be opened.' };
  }
}

export function launchSourceSnapshots(
  registry: AgentSourceRegistrySnapshot
): Array<AgentSourceSnapshot & { harness: AgentHarness }> {
  return registry.sources.filter(
    (source): source is AgentSourceSnapshot & { harness: AgentHarness } =>
      source.harness !== null && source.capabilities.interactiveLaunch
  );
}

export interface AgentSourcePreferenceState {
  projectLastUsed: Record<string, AgentSourceId>;
  sourceRecency: Partial<Record<AgentSourceId, number>>;
  projectPermissionModes: Record<
    string,
    Partial<Record<AgentSourceId, AgentPermissionMode>>
  >;
}

const emptyPreferences = (): AgentSourcePreferenceState => ({
  projectLastUsed: {},
  sourceRecency: {},
  projectPermissionModes: {},
});

export function isAgentSourceId(value: unknown): value is AgentSourceId {
  return typeof value === 'string' && value in AGENT_SOURCE_META;
}

export function isAgentPermissionMode(
  value: unknown
): value is AgentPermissionMode {
  return (
    typeof value === 'string' &&
    AGENT_PERMISSION_MODE_ORDER.includes(value as AgentPermissionMode)
  );
}

export function parseAgentSourcePreferences(
  raw: unknown
): AgentSourcePreferenceState {
  if (!raw || typeof raw !== 'object') return emptyPreferences();
  const candidate = raw as {
    projectLastUsed?: unknown;
    sourceRecency?: unknown;
    projectPermissionModes?: unknown;
  };
  const projectLastUsed: Record<string, AgentSourceId> = {};
  if (
    candidate.projectLastUsed &&
    typeof candidate.projectLastUsed === 'object'
  ) {
    for (const [dir, source] of Object.entries(candidate.projectLastUsed)) {
      if (dir && isAgentSourceId(source)) projectLastUsed[dir] = source;
    }
  }
  const sourceRecency: Partial<Record<AgentSourceId, number>> = {};
  if (candidate.sourceRecency && typeof candidate.sourceRecency === 'object') {
    for (const [source, timestamp] of Object.entries(candidate.sourceRecency)) {
      if (
        isAgentSourceId(source) &&
        typeof timestamp === 'number' &&
        Number.isFinite(timestamp) &&
        timestamp >= 0
      ) {
        sourceRecency[source] = timestamp;
      }
    }
  }
  const projectPermissionModes: AgentSourcePreferenceState['projectPermissionModes'] =
    {};
  if (
    candidate.projectPermissionModes &&
    typeof candidate.projectPermissionModes === 'object'
  ) {
    for (const [dir, sourceModes] of Object.entries(
      candidate.projectPermissionModes
    )) {
      if (!dir || !sourceModes || typeof sourceModes !== 'object') continue;
      const parsed: Partial<Record<AgentSourceId, AgentPermissionMode>> = {};
      for (const [source, permissionMode] of Object.entries(sourceModes)) {
        if (
          isAgentSourceId(source) &&
          isAgentPermissionMode(permissionMode) &&
          AGENT_SOURCE_META[source].capabilities.permissionModes.includes(
            permissionMode
          )
        ) {
          parsed[source] = permissionMode;
        }
      }
      if (Object.keys(parsed).length > 0) projectPermissionModes[dir] = parsed;
    }
  }
  return { projectLastUsed, sourceRecency, projectPermissionModes };
}

export function recommendAgentSource(
  state: AgentSourcePreferenceState,
  projectDir: string
): AgentSourceId {
  const projectChoice = state.projectLastUsed[projectDir];
  if (projectChoice) return projectChoice;
  return [...AGENT_SOURCE_ORDER].sort(
    (a, b) => (state.sourceRecency[b] ?? 0) - (state.sourceRecency[a] ?? 0)
  )[0];
}

/** Sources whose observation is incomplete, so nothing about them is settled. */
export function unprovenSources(
  registry: AgentSourceRegistrySnapshot
): AgentSourceSnapshot[] {
  return registry.sources.filter(
    source => source.unobservedProbes.length > 0 || source.state === 'unknown'
  );
}

/**
 * What a one-click launch should do with the registry it can see.
 *
 * `none` is a CLAIM: every source was observed, and none of them can launch.
 * `unproven` is the absence of one, and it still carries a source, because an
 * incomplete observation is not a reason to refuse the operator a launch. The
 * main process agrees (`agentSourceLaunchReadiness`): the launch attempt is
 * the better probe, and the harness speaks for itself in the pane.
 */
export type LaunchSourceChoice =
  | { kind: 'launchable'; source: AgentSourceId }
  | { kind: 'unproven'; source: AgentSourceId }
  | { kind: 'none' };

/**
 * Resolve a one-click launch against observed source truth. Preferences rank
 * candidates, but can never select a source the live registry says cannot
 * launch (BUG-063: they also cannot be overruled by a probe that never
 * answered).
 */
export function recommendLaunchableAgentSource(
  state: AgentSourcePreferenceState,
  projectDir: string,
  registry: AgentSourceRegistrySnapshot
): LaunchSourceChoice {
  const launchSources = launchSourceSnapshots(registry);
  const launchable = new Set(
    launchSources
      .filter(source => source.launchable)
      .map(source => source.harness)
  );
  const projectChoice = state.projectLastUsed[projectDir];
  if (projectChoice && launchable.has(projectChoice)) {
    return { kind: 'launchable', source: projectChoice };
  }
  const ranked = [...AGENT_SOURCE_ORDER]
    .filter(source => launchable.has(source))
    .sort(
      (a, b) => (state.sourceRecency[b] ?? 0) - (state.sourceRecency[a] ?? 0)
    )[0];
  if (ranked) return { kind: 'launchable', source: ranked };
  // Nothing is known-launchable. Before saying so, check whether we finished
  // asking: "no source is ready" over an incomplete registry is the fleet-wide
  // marker painted from a partial map all over again.
  const unproven = new Set(
    unprovenSources(registry)
      .map(source => source.harness)
      .filter((harness): harness is AgentSourceId => harness !== null)
  );
  if (unproven.size === 0) return { kind: 'none' };
  const preferred = recommendAgentSource(state, projectDir);
  return {
    kind: 'unproven',
    source: unproven.has(preferred)
      ? preferred
      : ([...AGENT_SOURCE_ORDER].find(source => unproven.has(source)) ??
        preferred),
  };
}

export function permissionModeFor(
  state: AgentSourcePreferenceState,
  projectDir: string,
  source: AgentSourceId,
  fallbackMode: AgentPermissionMode = DEFAULT_AGENT_PERMISSION_MODE
): AgentPermissionMode {
  const supported = AGENT_SOURCE_META[source].capabilities.permissionModes;
  const saved = state.projectPermissionModes[projectDir]?.[source];
  if (saved && supported.includes(saved)) return saved;
  return supported.includes(fallbackMode)
    ? fallbackMode
    : (supported[0] ?? 'prompt');
}

export function recordAgentSourceUse(
  state: AgentSourcePreferenceState,
  projectDir: string,
  source: AgentSourceId,
  usedAt: number
): AgentSourcePreferenceState {
  return {
    projectLastUsed: { ...state.projectLastUsed, [projectDir]: source },
    sourceRecency: { ...state.sourceRecency, [source]: usedAt },
    projectPermissionModes: state.projectPermissionModes,
  };
}

export function recordAgentPermissionMode(
  state: AgentSourcePreferenceState,
  projectDir: string,
  source: AgentSourceId,
  permissionMode: AgentPermissionMode
): AgentSourcePreferenceState {
  return {
    ...state,
    projectPermissionModes: {
      ...state.projectPermissionModes,
      [projectDir]: {
        ...state.projectPermissionModes[projectDir],
        [source]: permissionMode,
      },
    },
  };
}

export interface AgentSourcePreferenceLoadResult {
  preferences: AgentSourcePreferenceState;
  usedSafeFallback: boolean;
}

export async function loadAgentSourcePreferences(): Promise<AgentSourcePreferenceLoadResult> {
  if (typeof window === 'undefined') {
    return { preferences: emptyPreferences(), usedSafeFallback: false };
  }
  const getSettings = window.electron?.settings?.get;
  if (!getSettings) {
    return { preferences: emptyPreferences(), usedSafeFallback: true };
  }
  try {
    const settings = await getSettings();
    return {
      preferences: parseAgentSourcePreferences(settings?.agentSources),
      usedSafeFallback: false,
    };
  } catch {
    return { preferences: emptyPreferences(), usedSafeFallback: true };
  }
}

/**
 * Ceiling on how long the composer will wait for a source to describe itself.
 * Comfortably above the main process's own probe deadlines, so this only fires
 * when the bridge itself fails to answer — never as a second, tighter race.
 */
const MODEL_CATALOG_DEADLINE_MS = 25_000;

export async function loadAgentModelCatalog(
  source: AgentSourceId,
  projectDir: string
): Promise<AgentModelCatalog> {
  const listModels = window.electron?.pty?.listAgentModels;
  if (listModels) {
    try {
      // A never-settling bridge call used to leave the effort control spinning
      // on "Detecting…" for the rest of the session (ENG-016 D49). The UI's
      // readiness must not depend on a promise it does not control: an
      // unanswered catalog resolves to the honest "unavailable" shape below,
      // which every control already knows how to render.
      const timeout = new Promise<null>(resolve => {
        setTimeout(() => resolve(null), MODEL_CATALOG_DEADLINE_MS);
      });
      const catalog = await Promise.race([
        listModels(source, projectDir),
        timeout,
      ]);
      if (catalog) return catalog;
    } catch {
      // The launch remains available when an older bridge or CLI cannot
      // describe its catalog; the UI labels that uncertainty explicitly.
    }
  }
  return {
    harness: source,
    effectiveModel: null,
    effectiveModelLabel:
      source === 'claude' ? 'Account default' : 'Source default',
    effectiveModelSource:
      source === 'claude' ? 'account-default' : 'unavailable',
    effectiveEffort: null,
    effectiveEffortLabel: source === 'claude' ? 'Model default' : 'Unavailable',
    effectiveEffortSource: 'unavailable',
    effortLocked: false,
    models: [],
    catalogMode: source === 'claude' ? 'source-owned' : 'unavailable',
    catalogProvenance:
      source === 'claude' ? 'Claude Code account default' : 'Unavailable',
    observedAt: 0,
    selectionAction: source === 'claude' ? 'choose-in-source' : null,
  };
}

export async function rememberAgentSource(
  projectDir: string,
  source: AgentSourceId,
  usedAt = Date.now()
): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await window.electron?.settings?.recordAgentSourceUse(
      projectDir,
      source,
      usedAt
    );
  } catch {
    // A launch must still work when personal settings are unavailable.
  }
}

export async function rememberAgentPermissionMode(
  projectDir: string,
  source: AgentSourceId,
  permissionMode: AgentPermissionMode
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const setAgentPermissionMode =
    window.electron?.settings?.setAgentPermissionMode;
  if (!setAgentPermissionMode) return false;
  try {
    await setAgentPermissionMode(projectDir, source, permissionMode);
    return true;
  } catch {
    return false;
  }
}
