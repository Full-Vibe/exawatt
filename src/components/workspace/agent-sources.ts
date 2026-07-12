import type { PtyHarness } from '@/types/electron';

export type AgentSourceId = Exclude<PtyHarness, 'shell'>;

export interface AgentSourceMeta {
  label: string;
  color: string;
  capabilities: {
    interactive: boolean;
    initialTask: boolean;
    exactResume: boolean;
  };
}

export const AGENT_SOURCE_META: Record<AgentSourceId, AgentSourceMeta> = {
  claude: {
    label: 'Claude Code',
    color: '#D97757',
    capabilities: { interactive: true, initialTask: true, exactResume: true },
  },
  codex: {
    label: 'Codex',
    color: '#ECECEC',
    capabilities: { interactive: true, initialTask: true, exactResume: true },
  },
};

export const AGENT_SOURCE_ORDER = Object.keys(
  AGENT_SOURCE_META
) as AgentSourceId[];

export interface AgentSourcePreferenceState {
  projectLastUsed: Record<string, AgentSourceId>;
  sourceRecency: Partial<Record<AgentSourceId, number>>;
}

const emptyPreferences = (): AgentSourcePreferenceState => ({
  projectLastUsed: {},
  sourceRecency: {},
});

export function isAgentSourceId(value: unknown): value is AgentSourceId {
  return typeof value === 'string' && value in AGENT_SOURCE_META;
}

export function parseAgentSourcePreferences(
  raw: unknown
): AgentSourcePreferenceState {
  if (!raw || typeof raw !== 'object') return emptyPreferences();
  const candidate = raw as {
    projectLastUsed?: unknown;
    sourceRecency?: unknown;
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
  return { projectLastUsed, sourceRecency };
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

export function recordAgentSourceUse(
  state: AgentSourcePreferenceState,
  projectDir: string,
  source: AgentSourceId,
  usedAt: number
): AgentSourcePreferenceState {
  return {
    projectLastUsed: { ...state.projectLastUsed, [projectDir]: source },
    sourceRecency: { ...state.sourceRecency, [source]: usedAt },
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
