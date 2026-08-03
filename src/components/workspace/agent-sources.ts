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

export async function loadAgentModelCatalog(
  source: AgentSourceId,
  projectDir: string
): Promise<AgentModelCatalog> {
  const listModels = window.electron?.pty?.listAgentModels;
  if (listModels) {
    try {
      return await listModels(source, projectDir);
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
