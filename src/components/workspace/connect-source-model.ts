/**
 * Connect a server, as a pure state machine (ENG-010 C2, reshaped by ENG-033
 * H2.4 P2 into one screen).
 *
 * No React, no IO, no clock. The dialog renders what this module hands it and
 * dispatches what the operator did; every product rule from
 * `docs/engineering/projects/connected-openclaw-and-hosted-agents.md` lives
 * here, so the surface can never disagree with the policy:
 *
 * - the operator's servers are listed without contacting any of them, and a
 *   server is reached only once it is picked;
 * - picking a server tests it in place, on its own row, and a failure stays on
 *   that row with nothing saved;
 * - retired identities are never preselected and only ever join by an
 *   explicit act;
 * - one Project choice covers the batch, and a Gateway is never turned into a
 *   Project;
 * - a display name defaults to the source's own configured name, and a
 *   persona is never promoted to an identity;
 * - cancelling leaves the remote runtime untouched and releases only a record
 *   this flow created;
 * - a partially entered server survives as a draft only when the operator
 *   authored it.
 *
 * Validation reports issues; it never throws.
 */

import type {
  AgentSourcePlacement,
  SourceAgentDiscoveryState,
  SourceCredentialOwner,
  SourceTransport,
  SourceFailureClass,
  SshHostAlias,
} from '@exawatt/core';

/**
 * The source's own default loopback Gateway port. It is the port the record
 * stores when the operator says nothing about it; the server's declared port
 * is resolved through the tunnel by Electron main.
 */
export const DEFAULT_GATEWAY_PORT = 1337;
export const DEFAULT_SSH_PORT = 22;

const MAX_NAME_LENGTH = 120;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

/** The bounded test's stages, in the order the transport performs them. */
export const CONNECT_STAGES = [
  'tunnel',
  'credential',
  'pairing',
  'discovery',
] as const;
export type ConnectStage = (typeof CONNECT_STAGES)[number];

/**
 * The connection phase a session reports, translated into the stage the
 * operator is watching.
 *
 * The four stages are not a second vocabulary invented for the dialog: they
 * are the four phases the session actually moves through on the way to a
 * snapshot, named in the operator's words. Keeping the translation here is
 * what lets the surface read the phase channel main already broadcasts
 * instead of waiting on a progress callback that cannot cross the bridge.
 *
 * The phases missing from this table are deliberate. `idle`, `connected`,
 * `reconnecting`, and `failed` are not steps of the bounded test: the first
 * two bracket it and the last two are answers the invoke itself carries, so
 * none of them may move the checklist. A phase this table does not know
 * leaves the checklist exactly where it was.
 */
const STAGE_FOR_PHASE: Readonly<Partial<Record<string, ConnectStage>>> = {
  'opening-tunnel': 'tunnel',
  bootstrapping: 'credential',
  pairing: 'pairing',
  discovering: 'discovery',
};

export function stageForPhase(phase: string): ConnectStage | null {
  return STAGE_FOR_PHASE[phase] ?? null;
}

/** One configured Agent as the source reported it. */
export interface DiscoveredAgent {
  nativeAgentId: string;
  /** The source's own configured name. Exawatt never invents one. */
  displayName: string;
  discoveryState: SourceAgentDiscoveryState;
  contextCount: number;
  hasPrimaryConversation: boolean;
}

/** Where an imported Agent lands. Both arms are an explicit operator choice. */
export type ProjectTarget =
  | { kind: 'new-project'; name: string }
  | { kind: 'existing-project'; projectId: string };

export interface AgentMappingRow {
  nativeAgentId: string;
  /** The source's configured name, carried unchanged for reference. */
  sourceName: string;
  /** Operator's override. Null means the source's own name stands. */
  nameOverride: string | null;
  project: ProjectTarget;
  hasPrimaryConversation: boolean;
}

/** What the operator typed for a server they described themselves. */
export interface ManualServerDraft {
  /** The operator's name for this server. Also the source's display name. */
  label: string;
  host: string;
  user: string;
  port: number;
  gatewayPort: number;
  /** Empty when the operator's default key applies. */
  identityFile: string;
}

export function emptyManualDraft(): ManualServerDraft {
  return {
    label: '',
    host: '',
    user: '',
    port: DEFAULT_SSH_PORT,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    identityFile: '',
  };
}

export const CONNECT_ISSUE_CODES = [
  'server-label-required',
  'server-host-required',
  'server-user-required',
  'server-port-invalid',
  'gateway-port-invalid',
  'agent-name-required',
  'agent-name-too-long',
  'project-name-required',
  'project-name-too-long',
  'project-unknown',
  'selection-required',
] as const;
export type ConnectIssueCode = (typeof CONNECT_ISSUE_CODES)[number];

export interface ConnectIssue {
  code: ConnectIssueCode;
  /** The row the issue belongs to, or null when it is about the flow. */
  nativeAgentId: string | null;
  /** Operator-facing sentence. */
  message: string;
}

/** Facts observed on the source during the bounded test. */
export interface ObservedSourceFacts {
  /** The installation's own reported identity, or null when it declared none. */
  identity: string | null;
  version: string | null;
  /** Scope or method tokens the source declared for this device. */
  capabilities: readonly string[];
  observedAt: number | null;
}

export interface ConnectionFact {
  id: 'identity' | 'version' | 'placement' | 'credential' | 'capabilities';
  label: string;
  value: string;
}

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

export const CONNECT_STAGE_COPY: Readonly<Record<ConnectStage, string>> = {
  tunnel: 'Opening the SSH tunnel',
  credential: 'Reading the Gateway credential',
  pairing: 'Pairing this device for read access',
  discovery: 'Discovering configured Agents',
};

/**
 * Failure copy names the class the operator can act on and says what happens
 * next. None of it may suggest the remote runtime changed: Exawatt lost sight
 * of the server, which is a fact about Exawatt.
 */
export const CONNECT_FAILURE_COPY: Readonly<
  Record<SourceFailureClass, { headline: string; nextStep: string }>
> = {
  'host-unreachable': {
    headline: 'Server unreachable',
    nextStep: 'Check the server is reachable over SSH, then try again.',
  },
  'gateway-down': {
    headline: 'Gateway not responding',
    nextStep:
      'The server answered and the Gateway did not. Start it there, then try again.',
  },
  'auth-rejected': {
    headline: 'Sign-in rejected',
    nextStep:
      'The server refused this SSH sign-in. Check your access to it, then try again.',
  },
  'approval-required': {
    headline: 'Approval needed',
    nextStep: 'Approve this device on the Gateway, then try again.',
  },
  incompatible: {
    headline: 'Version not supported',
    nextStep:
      'This Gateway runs a protocol version Exawatt does not speak yet. Update it there, then try again.',
  },
  unknown: {
    headline: 'Connection did not complete',
    nextStep: 'Try again, or describe the server yourself.',
  },
};

export const PLACEMENT_LABELS: Readonly<Record<AgentSourcePlacement, string>> =
  {
    local: 'Local',
    'customer-hosted': 'Remote',
    'exawatt-hosted': 'Exawatt Cloud',
  };

export const CREDENTIAL_OWNER_LABELS: Readonly<
  Record<SourceCredentialOwner, string>
> = {
  'source-owned-ssh': 'Your SSH configuration',
  'exawatt-keychain': 'Exawatt keychain',
};

/** Source scope tokens, in the product's own words. Unknown tokens pass through. */
const CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  'operator.read': 'Read',
  'operator.write': 'Send',
  'operator.admin': 'Manage',
};

/** The honesty marker for a fact the source did not declare. */
export const NOT_REPORTED = 'Not reported';

/* -------------------------------------------------------------------------- */
/* Derivations                                                                */
/* -------------------------------------------------------------------------- */

export function placementForTransport(
  kind: SourceTransport['kind']
): AgentSourcePlacement {
  return kind === 'local-loopback' ? 'local' : 'customer-hosted';
}

/**
 * Server access custody. An alias reaches the server through the operator's
 * own SSH configuration and stores nothing; a described server is the one
 * path that writes host, user, and key material to the OS keychain.
 */
export function credentialOwnerForTransport(
  kind: SourceTransport['kind']
): SourceCredentialOwner {
  return kind === 'ssh-alias' ? 'source-owned-ssh' : 'exawatt-keychain';
}

/**
 * The five connection facts, kept apart on purpose. Identity, version, and
 * capabilities are what the source said; placement and credential custody are
 * what this flow chose. Collapsing them into one status line would hide which
 * half came from where.
 */
export function connectionFacts(input: {
  observed: ObservedSourceFacts | null;
  placement: AgentSourcePlacement;
  credentialOwner: SourceCredentialOwner;
}): readonly ConnectionFact[] {
  const observed = input.observed;
  const capabilities = (observed?.capabilities ?? [])
    .map(token => CAPABILITY_LABELS[token] ?? token)
    .join(', ');
  return [
    {
      id: 'identity',
      label: 'Identity',
      value: nonEmpty(observed?.identity) ?? NOT_REPORTED,
    },
    {
      id: 'version',
      label: 'Version',
      value: nonEmpty(observed?.version) ?? NOT_REPORTED,
    },
    {
      id: 'placement',
      label: 'Placement',
      value: PLACEMENT_LABELS[input.placement],
    },
    {
      id: 'credential',
      label: 'Credentials',
      value: CREDENTIAL_OWNER_LABELS[input.credentialOwner],
    },
    {
      id: 'capabilities',
      label: 'Capabilities',
      value: nonEmpty(capabilities) ?? NOT_REPORTED,
    },
  ];
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Active configured Agents first; everything else is history, kept apart. */
export function partitionAgents(agents: readonly DiscoveredAgent[]): {
  configured: readonly DiscoveredAgent[];
  retired: readonly DiscoveredAgent[];
} {
  return {
    configured: agents.filter(agent => agent.discoveryState === 'configured'),
    retired: agents.filter(agent => agent.discoveryState !== 'configured'),
  };
}

/**
 * The preselection. Only currently configured Agents, every time discovery
 * runs: a retired identity that was chosen once must not ride a later
 * discovery back into the roster on its own.
 */
export function preselectedAgentIds(
  agents: readonly DiscoveredAgent[]
): ReadonlySet<string> {
  return new Set(
    partitionAgents(agents).configured.map(agent => agent.nativeAgentId)
  );
}

/** The name Exawatt shows: the operator's override, or the source's own name. */
export function resolvedDisplayName(row: AgentMappingRow): string {
  return nonEmpty(row.nameOverride) ?? row.sourceName;
}

/**
 * The rows a Connect saves: every chosen Agent, under the name the operator
 * gave it inline or the source's own, all into the one Project the batch
 * chose. The Project is chosen for the batch, never derived from the server.
 */
export function mappingRowsFor(
  agents: readonly DiscoveredAgent[],
  selected: ReadonlySet<string>,
  names: Readonly<Record<string, string | null>>,
  project: ProjectTarget
): readonly AgentMappingRow[] {
  return agents
    .filter(agent => selected.has(agent.nativeAgentId))
    .map(agent => ({
      nativeAgentId: agent.nativeAgentId,
      sourceName: agent.displayName,
      nameOverride: names[agent.nativeAgentId] ?? null,
      project,
      hasPrimaryConversation: agent.hasPrimaryConversation,
    }));
}

export function validateManualDraft(
  draft: ManualServerDraft
): readonly ConnectIssue[] {
  const issues: ConnectIssue[] = [];
  if (nonEmpty(draft.label) === null) {
    issues.push(issue('server-label-required', 'Name this server.'));
  }
  if (nonEmpty(draft.host) === null) {
    issues.push(issue('server-host-required', 'Enter the server address.'));
  }
  if (nonEmpty(draft.user) === null) {
    issues.push(issue('server-user-required', 'Enter the SSH user.'));
  }
  if (!isPort(draft.port)) {
    issues.push(
      issue(
        'server-port-invalid',
        `SSH port runs from ${MIN_PORT} to ${MAX_PORT}.`
      )
    );
  }
  if (!isPort(draft.gatewayPort)) {
    issues.push(
      issue(
        'gateway-port-invalid',
        `Gateway port runs from ${MIN_PORT} to ${MAX_PORT}.`
      )
    );
  }
  return issues;
}

export function validateMappingRows(
  rows: readonly AgentMappingRow[],
  knownProjectIds: readonly string[]
): readonly ConnectIssue[] {
  const issues: ConnectIssue[] = [];
  if (rows.length === 0) {
    issues.push(issue('selection-required', 'Choose at least one Agent.'));
    return issues;
  }
  for (const row of rows) {
    const name = row.nameOverride;
    if (name !== null && nonEmpty(name) === null) {
      issues.push(
        issue(
          'agent-name-required',
          'Give this Agent a name, or leave the field empty to keep the name it has.',
          row.nativeAgentId
        )
      );
    } else if (name !== null && name.trim().length > MAX_NAME_LENGTH) {
      issues.push(
        issue(
          'agent-name-too-long',
          `Keep the name to ${MAX_NAME_LENGTH} characters.`,
          row.nativeAgentId
        )
      );
    }
  }
  // One Project for the batch, so one fault for it, not one per Agent.
  const project = rows[0]!.project;
  if (project.kind === 'new-project') {
    const projectName = nonEmpty(project.name);
    if (projectName === null) {
      issues.push(issue('project-name-required', 'Name the Project.'));
    } else if (projectName.length > MAX_NAME_LENGTH) {
      issues.push(
        issue(
          'project-name-too-long',
          `Keep the Project name to ${MAX_NAME_LENGTH} characters.`
        )
      );
    }
  } else if (!new Set(knownProjectIds).has(project.projectId)) {
    issues.push(
      issue('project-unknown', 'Choose a Project that still exists.')
    );
  }
  return issues;
}

function issue(
  code: ConnectIssueCode,
  message: string,
  nativeAgentId: string | null = null
): ConnectIssue {
  return { code, nativeAgentId, message };
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT;
}

/* -------------------------------------------------------------------------- */
/* The one screen                                                             */
/* -------------------------------------------------------------------------- */

/** A server Exawatt already keeps a source for, with the coworkers it maps. */
export interface ConnectedServer {
  alias: string;
  agentNames: readonly string[];
}

/** The server under test, or tested and ready to connect. */
export interface ConnectAttempt {
  alias: string;
  sourceId: string;
  /**
   * True only when this flow created the record. Leaving releases a record
   * the flow created and never one it was handed (BUG-155).
   */
  owned: boolean;
  /** True when the operator described the server rather than picking one. */
  operatorAuthored: boolean;
  phase:
    | { kind: 'testing'; stage: ConnectStage }
    | {
        kind: 'ready';
        agents: readonly DiscoveredAgent[];
        selected: ReadonlySet<string>;
        /** Inline renames. Absent or null means the source's own name. */
        names: Readonly<Record<string, string | null>>;
        facts: readonly ConnectionFact[];
        version: string | null;
      };
}

/**
 * A server whose test stopped. It stays on its own row, and the record the
 * test ran against was released, so nothing of it is saved (`released`
 * false says the release itself failed and the record is still in Settings).
 */
interface ConnectFailure {
  stage: ConnectStage;
  failure: SourceFailureClass;
  message: string;
  released: boolean;
}

export interface ConnectFlowState {
  servers: {
    /** False until the local configuration read answers. */
    loaded: boolean;
    aliases: readonly SshHostAlias[];
    connected: readonly ConnectedServer[];
    configPresent: boolean;
    incompleteIncludes: boolean;
  };
  filter: string;
  /** True when the operator is describing a server rather than picking one. */
  manual: boolean;
  draft: ManualServerDraft;
  attempt: ConnectAttempt | null;
  failures: Readonly<Record<string, ConnectFailure>>;
  /**
   * The batch's Project, once the operator chose one. Null means the host's
   * default stands, which the dialog passes in because only it knows the
   * Projects and the coworkers already connected.
   */
  project: ProjectTarget | null;
  /**
   * The mapping has been handed on and the record belongs to the operator.
   * There is no step for this: the flow closes straight through to the Agent.
   */
  settled: boolean;
  issues: readonly ConnectIssue[];
}

export type ConnectAction =
  | {
      type: 'servers-loaded';
      aliases: readonly SshHostAlias[];
      connected: readonly ConnectedServer[];
      configPresent: boolean;
      incompleteIncludes: boolean;
    }
  | { type: 'filter'; text: string }
  | { type: 'set-manual'; manual: boolean }
  | { type: 'edit-manual'; patch: Partial<ManualServerDraft> }
  | {
      type: 'test-started';
      alias: string;
      sourceId: string;
      operatorAuthored: boolean;
      owned: boolean;
    }
  | { type: 'test-stage'; stage: ConnectStage }
  | {
      type: 'test-failed';
      failure: SourceFailureClass;
      message: string;
      released: boolean;
    }
  | {
      type: 'agents-discovered';
      agents: readonly DiscoveredAgent[];
      facts: readonly ConnectionFact[];
      version: string | null;
    }
  /** The ready attempt was released because the operator picked another server. */
  | { type: 'attempt-released' }
  | { type: 'toggle-agent'; nativeAgentId: string }
  | { type: 'rename-agent'; nativeAgentId: string; name: string | null }
  | { type: 'set-project'; project: ProjectTarget }
  | { type: 'save'; knownProjectIds: readonly string[]; project: ProjectTarget }
  | { type: 'cancel' };

/** What the caller owes the world when the operator walks away. */
export interface CancelOutcome {
  /** Cancelling never produces a saved source. The type says so. */
  savedSource: null;
  /** A record this flow created that must be removed. Remote work is untouched. */
  releaseSourceId: string | null;
  /** The operator's own typing, kept so they can come back to it. */
  retainedDraft: ManualServerDraft | null;
}

/** How one server row reads. */
type ServerRowState =
  | 'idle'
  | 'connected'
  | 'testing'
  | 'ready'
  | 'failed';

export interface ServerRow {
  alias: string;
  state: ServerRowState;
  /** The line under the name: progress, result, failure, or its coworkers. */
  detail: string | null;
  /** The source's own words for a failure, or what to do next. */
  note: string | null;
}

export function initialConnectFlowState(): ConnectFlowState {
  return {
    servers: {
      loaded: false,
      aliases: [],
      connected: [],
      configPresent: false,
      incompleteIncludes: false,
    },
    filter: '',
    manual: false,
    draft: emptyManualDraft(),
    attempt: null,
    failures: {},
    project: null,
    settled: false,
    issues: [],
  };
}

function agentCount(count: number): string {
  return count === 1 ? '1 Agent' : `${count} Agents`;
}

function rowFor(state: ConnectFlowState, alias: string): ServerRow {
  const attempt = state.attempt?.alias === alias ? state.attempt : null;
  if (attempt?.phase.kind === 'testing') {
    return {
      alias,
      state: 'testing',
      detail: CONNECT_STAGE_COPY[attempt.phase.stage],
      note: null,
    };
  }
  if (attempt?.phase.kind === 'ready') {
    const configured = partitionAgents(attempt.phase.agents).configured.length;
    return {
      alias,
      state: 'ready',
      detail: [
        attempt.phase.version ? `OpenClaw ${attempt.phase.version}` : null,
        agentCount(configured),
      ]
        .filter(Boolean)
        .join(' · '),
      note: null,
    };
  }
  const failure = state.failures[alias];
  if (failure) {
    const copy = CONNECT_FAILURE_COPY[failure.failure];
    return {
      alias,
      state: 'failed',
      detail: `${copy.headline}. ${
        failure.released
          ? 'Nothing was saved.'
          : 'It is still saved; remove it in Settings.'
      }`,
      note: nonEmpty(failure.message) ?? copy.nextStep,
    };
  }
  const connected = state.servers.connected.find(
    entry => entry.alias === alias
  );
  if (connected) {
    return {
      alias,
      state: 'connected',
      detail:
        connected.agentNames.length > 0
          ? `Connected · ${connected.agentNames.join(', ')}`
          : 'Connected',
      note: null,
    };
  }
  return { alias, state: 'idle', detail: null, note: null };
}

/**
 * The server list as the operator reads it: every alias from their own
 * configuration, in their order, narrowed by what they typed. A server
 * described by hand that is under test, ready, or failed is listed too, so
 * its result has a row to stand on.
 */
export function visibleServerRows(state: ConnectFlowState): {
  rows: readonly ServerRow[];
  total: number;
} {
  const aliases = state.servers.aliases.map(alias => alias.alias);
  // A described server has no alias to stand on, so its test or its failure
  // is listed after the operator's own servers.
  const authored = [
    ...(state.attempt?.operatorAuthored ? [state.attempt.alias] : []),
    ...Object.keys(state.failures),
  ].filter(
    (alias, index, all) =>
      !aliases.includes(alias) && all.indexOf(alias) === index
  );
  const all = [...aliases, ...authored];
  const needle = state.filter.trim().toLowerCase();
  const shown =
    needle.length === 0
      ? all
      : all.filter(alias => alias.toLowerCase().includes(needle));
  return { rows: shown.map(alias => rowFor(state, alias)), total: all.length };
}

/** True when picking this server would start a test right now. */
export function canTestServer(state: ConnectFlowState, alias: string): boolean {
  if (state.settled || state.attempt?.phase.kind === 'testing') return false;
  if (state.attempt?.alias === alias) return false;
  return !state.servers.connected.some(entry => entry.alias === alias);
}

/**
 * What saving produces, decided once. The reducer reads this same function,
 * which stops the surface and the machine from holding two opinions about
 * whether a mapping was good enough to keep.
 */
export type ConnectSaveOutcome =
  | { ok: false; issues: readonly ConnectIssue[] }
  | {
      ok: true;
      sourceId: string;
      /** The Agent to open once the roster has it. */
      openAgentId: string | null;
      rows: readonly AgentMappingRow[];
    };

export function saveConnectFlow(
  state: ConnectFlowState,
  knownProjectIds: readonly string[],
  defaultProject: ProjectTarget
): ConnectSaveOutcome {
  const attempt = state.attempt;
  if (attempt?.phase.kind !== 'ready') return { ok: false, issues: [] };
  const rows = mappingRowsFor(
    attempt.phase.agents,
    attempt.phase.selected,
    attempt.phase.names,
    state.project ?? defaultProject
  );
  const issues = validateMappingRows(rows, knownProjectIds);
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    sourceId: attempt.sourceId,
    openAgentId: rows[0]?.nativeAgentId ?? null,
    rows,
  };
}

/**
 * What leaving now costs. Nothing on the server and nothing in the roster: the
 * only local effect is releasing the record this flow created. Their own
 * typing comes back with them; an alias they merely clicked leaves nothing.
 */
export function cancelConnectFlow(state: ConnectFlowState): CancelOutcome {
  const authored =
    Boolean(state.attempt?.operatorAuthored) || draftHasContent(state.draft);
  const attempt = state.attempt;
  return {
    savedSource: null,
    releaseSourceId:
      attempt && attempt.owned && !state.settled ? attempt.sourceId : null,
    retainedDraft: authored ? state.draft : null,
  };
}

function draftHasContent(draft: ManualServerDraft): boolean {
  return (
    nonEmpty(draft.label) !== null ||
    nonEmpty(draft.host) !== null ||
    nonEmpty(draft.user) !== null ||
    nonEmpty(draft.identityFile) !== null
  );
}

export function connectFlowReducer(
  state: ConnectFlowState,
  action: ConnectAction
): ConnectFlowState {
  switch (action.type) {
    case 'servers-loaded':
      return {
        ...state,
        servers: {
          loaded: true,
          aliases: action.aliases,
          connected: action.connected,
          configPresent: action.configPresent,
          incompleteIncludes: action.incompleteIncludes,
        },
        // With no configuration to choose from, describing the server is the
        // path, not a fallback the operator has to go looking for.
        manual: state.manual || !action.configPresent,
      };

    case 'filter':
      return { ...state, filter: action.text };

    case 'set-manual':
      if (state.settled) return state;
      return { ...state, issues: [], manual: action.manual };

    case 'edit-manual':
      return {
        ...state,
        issues: [],
        draft: { ...state.draft, ...action.patch },
      };

    case 'test-started': {
      if (state.settled || state.attempt?.phase.kind === 'testing') {
        return state;
      }
      const { [action.alias]: _cleared, ...failures } = state.failures;
      return {
        ...state,
        issues: [],
        failures,
        attempt: {
          alias: action.alias,
          sourceId: action.sourceId,
          owned: action.owned,
          operatorAuthored: action.operatorAuthored,
          phase: { kind: 'testing', stage: 'tunnel' },
        },
      };
    }

    case 'test-stage': {
      const attempt = state.attempt;
      if (attempt?.phase.kind !== 'testing') return state;
      return {
        ...state,
        attempt: {
          ...attempt,
          phase: { kind: 'testing', stage: action.stage },
        },
      };
    }

    case 'test-failed': {
      const attempt = state.attempt;
      if (attempt?.phase.kind !== 'testing') return state;
      // No roster Agent exists and none is created here. The failure keeps the
      // stage it stopped on, so the row names the step that failed.
      return {
        ...state,
        attempt: null,
        failures: {
          ...state.failures,
          [attempt.alias]: {
            stage: attempt.phase.stage,
            failure: action.failure,
            message: action.message,
            released: action.released,
          },
        },
      };
    }

    case 'agents-discovered': {
      const attempt = state.attempt;
      if (attempt?.phase.kind !== 'testing') return state;
      return {
        ...state,
        // A described server that answered is a row now; the form's work is
        // done.
        manual: attempt.operatorAuthored ? false : state.manual,
        attempt: {
          ...attempt,
          phase: {
            kind: 'ready',
            agents: action.agents,
            selected: preselectedAgentIds(action.agents),
            names: {},
            facts: action.facts,
            version: action.version,
          },
        },
      };
    }

    case 'attempt-released':
      if (state.settled) return state;
      return { ...state, attempt: null, issues: [] };

    case 'toggle-agent': {
      const attempt = state.attempt;
      if (attempt?.phase.kind !== 'ready') return state;
      const known = attempt.phase.agents.some(
        agent => agent.nativeAgentId === action.nativeAgentId
      );
      if (!known) return state;
      const selected = new Set(attempt.phase.selected);
      if (selected.has(action.nativeAgentId)) {
        selected.delete(action.nativeAgentId);
      } else {
        // The one way a retired identity is imported: the operator says so.
        selected.add(action.nativeAgentId);
      }
      return {
        ...state,
        issues: [],
        attempt: { ...attempt, phase: { ...attempt.phase, selected } },
      };
    }

    case 'rename-agent': {
      const attempt = state.attempt;
      if (attempt?.phase.kind !== 'ready') return state;
      if (
        !attempt.phase.agents.some(
          agent => agent.nativeAgentId === action.nativeAgentId
        )
      ) {
        return state;
      }
      return {
        ...state,
        issues: [],
        attempt: {
          ...attempt,
          phase: {
            ...attempt.phase,
            names: {
              ...attempt.phase.names,
              [action.nativeAgentId]: normalizeOverride(action.name),
            },
          },
        },
      };
    }

    case 'set-project':
      if (state.settled) return state;
      return { ...state, issues: [], project: action.project };

    case 'save': {
      const outcome = saveConnectFlow(
        state,
        action.knownProjectIds,
        action.project
      );
      if (!outcome.ok) return { ...state, issues: outcome.issues };
      // The screen does not move: the caller opens the coworker and the
      // dialog closes. What changes is custody.
      return { ...state, issues: [], settled: true };
    }

    case 'cancel':
      return initialConnectFlowState();
  }
}

/** An emptied field means "keep the source's own name", not a blank name. */
function normalizeOverride(value: string | null): string | null {
  if (value === null) return null;
  return value.length === 0 ? null : value;
}
