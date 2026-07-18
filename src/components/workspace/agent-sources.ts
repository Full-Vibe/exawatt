import type { AgentPermissionMode, PtyHarness } from '@/types/electron';

export type AgentSourceId = Exclude<PtyHarness, 'shell'>;

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
    label: 'Prompt',
    shortLabel: 'Ask',
    description: 'Pause for operator approval when the harness requires it.',
  },
  auto: {
    label: 'Auto-review',
    shortLabel: 'Auto',
    description:
      'Use the harness safety reviewer to allow routine work and block risky actions.',
  },
  unrestricted: {
    label: 'YOLO',
    shortLabel: 'YOLO',
    description:
      'Bypass approval prompts and sandboxing. The Agent receives full machine access.',
  },
};

export interface AgentSourceMeta {
  label: string;
  color: string;
  capabilities: {
    interactive: boolean;
    initialTask: boolean;
    exactResume: boolean;
    permissionModes: readonly AgentPermissionMode[];
  };
}

export const AGENT_SOURCE_META: Record<AgentSourceId, AgentSourceMeta> = {
  claude: {
    label: 'Claude Code',
    color: '#D97757',
    capabilities: {
      interactive: true,
      initialTask: true,
      exactResume: true,
      permissionModes: AGENT_PERMISSION_MODE_ORDER,
    },
  },
  codex: {
    label: 'Codex',
    color: '#ECECEC',
    capabilities: {
      interactive: true,
      initialTask: true,
      exactResume: true,
      permissionModes: AGENT_PERMISSION_MODE_ORDER,
    },
  },
};

export const AGENT_SOURCE_ORDER = Object.keys(
  AGENT_SOURCE_META
) as AgentSourceId[];

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
  source: AgentSourceId
): AgentPermissionMode {
  const supported = AGENT_SOURCE_META[source].capabilities.permissionModes;
  const saved = state.projectPermissionModes[projectDir]?.[source];
  if (saved && supported.includes(saved)) return saved;
  return supported.includes(DEFAULT_AGENT_PERMISSION_MODE)
    ? DEFAULT_AGENT_PERMISSION_MODE
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

export async function loadAgentSourcePreferences(): Promise<AgentSourcePreferenceState> {
  if (typeof window === 'undefined') return emptyPreferences();
  try {
    const settings = await window.electron?.settings?.get();
    return parseAgentSourcePreferences(settings?.agentSources);
  } catch {
    return emptyPreferences();
  }
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
): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await window.electron?.settings?.setAgentPermissionMode(
      projectDir,
      source,
      permissionMode
    );
  } catch {
    // A launch must still work when personal settings are unavailable.
  }
}
