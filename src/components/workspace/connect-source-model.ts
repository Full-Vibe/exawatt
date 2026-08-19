/**
 * The Connect existing Agent flow, as a pure state machine (ENG-010 C2).
 *
 * No React, no IO, no clock. The dialog renders whatever step this module
 * hands it and dispatches what the operator did; every product rule from
 * `docs/engineering/projects/connected-openclaw-and-hosted-agents.md` lives
 * here, so the surface can never disagree with the policy:
 *
 * - retired identities are never preselected and only ever join by an
 *   explicit act;
 * - Project mapping is explicit, suggested per imported Agent, and a Gateway
 *   is never turned into a Project;
 * - a display name defaults to the source's own configured name, and a
 *   persona is never promoted to an identity;
 * - cancelling leaves the source and the remote runtime untouched, and a
 *   failed discovery creates no roster Agents;
 * - a partially entered server survives as a draft only when the operator
 *   authored it;
 * - back returns to the previous step with its input intact.
 *
 * Validation reports issues; it never throws. A malformed edit leaves the
 * flow standing on the step it was on with the fault named.
 */

import type {
  AgentSourceAdapterId,
  AgentSourcePlacement,
  SourceAgentDiscoveryState,
  SourceCredentialOwner,
  SourceTransport,
  SourceFailureClass,
  SshHostAlias,
} from '@exawatt/core';

/** The adapters the flow can carry today. Others are not connect targets. */
export const CONNECTABLE_ADAPTER_IDS = ['openclaw'] as const;
export type ConnectableAdapterId = (typeof CONNECTABLE_ADAPTER_IDS)[number];

const CONNECTABLE_ADAPTER_SET: ReadonlySet<string> = new Set(
  CONNECTABLE_ADAPTER_IDS
);

export function isConnectableAdapter(
  adapterId: AgentSourceAdapterId
): adapterId is ConnectableAdapterId {
  return CONNECTABLE_ADAPTER_SET.has(adapterId);
}

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
  'adapter-not-connectable',
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

export type ConnectStep =
  | { kind: 'choose-source' }
  | {
      kind: 'choose-server';
      aliases: readonly SshHostAlias[];
      configPresent: boolean;
      incompleteIncludes: boolean;
      manual: boolean;
      draft: ManualServerDraft;
    }
  | { kind: 'testing'; alias: string; stage: ConnectStage }
  | {
      kind: 'failed';
      alias: string;
      /**
       * The stage the test was standing on when it stopped. Carried so the
       * failure screen can leave the operator looking at the step that
       * failed: "the pairing never completed" and "the server never answered"
       * are different problems with different next actions, and a report that
       * always pointed at the first step would hide which one they have.
       */
      stage: ConnectStage;
      failure: SourceFailureClass;
      message: string;
    }
  | {
      kind: 'choose-agents';
      alias: string;
      sourceId: string;
      agents: readonly DiscoveredAgent[];
      selected: ReadonlySet<string>;
      facts: readonly ConnectionFact[];
    }
  | {
      kind: 'map-projects';
      alias: string;
      sourceId: string;
      rows: readonly AgentMappingRow[];
    };

export interface ConnectFlowState {
  step: ConnectStep;
  /**
   * The resting steps behind the current one, oldest first. `testing` and
   * `failed` never enter it: they are in-flight states, and returning to one
   * would show progress that is not running.
   */
  history: readonly ConnectStep[];
  adapterId: ConnectableAdapterId | null;
  /** The record this flow created, before it is the operator's to keep. */
  pendingSourceId: string | null;
  /** The server that record points at, so a retry reuses it. */
  pendingAlias: string | null;
  /** True when the operator described the server rather than picking one. */
  operatorAuthored: boolean;
  /**
   * The mapping has been handed on and the record belongs to the operator.
   *
   * There is no step for this, because the product closes straight through to
   * the Agent rather than parking on a confirmation nobody asked for. The
   * fact still has to survive the close: it is what tells `cancelConnectFlow`
   * that the source it can see is a connection the operator kept, not a
   * half-finished attempt to release.
   */
  settled: boolean;
  issues: readonly ConnectIssue[];
}

export type ConnectAction =
  | { type: 'choose-adapter'; adapterId: AgentSourceAdapterId }
  | {
      type: 'aliases-loaded';
      aliases: readonly SshHostAlias[];
      configPresent: boolean;
      incompleteIncludes: boolean;
    }
  | { type: 'set-manual'; manual: boolean }
  | { type: 'edit-manual'; patch: Partial<ManualServerDraft> }
  | {
      type: 'test-started';
      alias: string;
      sourceId: string;
      operatorAuthored: boolean;
    }
  | { type: 'test-stage'; stage: ConnectStage }
  | { type: 'test-failed'; failure: SourceFailureClass; message: string }
  | {
      type: 'agents-discovered';
      agents: readonly DiscoveredAgent[];
      facts: readonly ConnectionFact[];
    }
  | { type: 'toggle-agent'; nativeAgentId: string }
  | { type: 'to-mapping' }
  | {
      type: 'edit-mapping';
      nativeAgentId: string;
      patch: { nameOverride?: string | null; project?: ProjectTarget };
    }
  | { type: 'save'; knownProjectIds: readonly string[] }
  | { type: 'back' }
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
 * One suggested Project per imported Agent, named after the Agent, because
 * that is what the first topology looks like. Every row stays editable, and a
 * Gateway is never a Project: the suggestion is per Agent, never per server.
 */
export function mappingRowsFor(
  agents: readonly DiscoveredAgent[],
  selected: ReadonlySet<string>
): readonly AgentMappingRow[] {
  return agents
    .filter(agent => selected.has(agent.nativeAgentId))
    .map(agent => ({
      nativeAgentId: agent.nativeAgentId,
      sourceName: agent.displayName,
      nameOverride: null,
      project: { kind: 'new-project', name: agent.displayName },
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
  const known = new Set(knownProjectIds);
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

    if (row.project.kind === 'new-project') {
      const projectName = nonEmpty(row.project.name);
      if (projectName === null) {
        issues.push(
          issue(
            'project-name-required',
            'Name the Project this Agent belongs to.',
            row.nativeAgentId
          )
        );
      } else if (projectName.length > MAX_NAME_LENGTH) {
        issues.push(
          issue(
            'project-name-too-long',
            `Keep the Project name to ${MAX_NAME_LENGTH} characters.`,
            row.nativeAgentId
          )
        );
      }
    } else if (!known.has(row.project.projectId)) {
      issues.push(
        issue(
          'project-unknown',
          'Choose a Project that still exists.',
          row.nativeAgentId
        )
      );
    }
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
/* Machine                                                                    */
/* -------------------------------------------------------------------------- */

export function initialConnectFlowState(): ConnectFlowState {
  return {
    step: { kind: 'choose-source' },
    history: [],
    adapterId: null,
    pendingSourceId: null,
    pendingAlias: null,
    operatorAuthored: false,
    settled: false,
    issues: [],
  };
}

export function canGoBack(state: ConnectFlowState): boolean {
  return state.history.length > 0 && !state.settled;
}

/**
 * What saving produces, decided once.
 *
 * The flow has no terminal screen: connecting closes through to the coworker,
 * because that is what the operator asked for and a "Connected." page with a
 * Done button on it is a step between them and the person they came to see.
 * So the outcome is a value the caller acts on rather than a state the
 * machine rests in, and the reducer reads this same function, which is what
 * stops the surface and the machine from holding two opinions about whether a
 * mapping was good enough to keep.
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
  knownProjectIds: readonly string[]
): ConnectSaveOutcome {
  if (state.step.kind !== 'map-projects') {
    return { ok: false, issues: [] };
  }
  const issues = validateMappingRows(state.step.rows, knownProjectIds);
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    sourceId: state.step.sourceId,
    openAgentId: state.step.rows[0]?.nativeAgentId ?? null,
    rows: state.step.rows,
  };
}

/**
 * The record a retry should reuse. Adding a second record for the same server
 * because the first attempt failed would leave the operator two sources for
 * one machine.
 */
export function existingSourceIdForAlias(
  state: ConnectFlowState,
  alias: string
): string | null {
  return state.pendingAlias === alias ? state.pendingSourceId : null;
}

/**
 * What leaving now costs. Nothing on the server and nothing in the roster: the
 * only local effect is releasing the record this flow created, so a server the
 * operator walked away from is not left half-connected in Settings. Their own
 * typing comes back with them; an alias they merely clicked leaves nothing to
 * come back to.
 */
export function cancelConnectFlow(state: ConnectFlowState): CancelOutcome {
  const draft = manualDraftOf(state);
  const authored =
    state.operatorAuthored || (draft !== null && draftHasContent(draft));
  return {
    savedSource: null,
    releaseSourceId: state.settled ? null : state.pendingSourceId,
    retainedDraft: authored ? draft : null,
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

function manualDraftOf(state: ConnectFlowState): ManualServerDraft | null {
  const server = [state.step, ...state.history].find(
    (step): step is Extract<ConnectStep, { kind: 'choose-server' }> =>
      step.kind === 'choose-server'
  );
  return server ? server.draft : null;
}

export function connectFlowReducer(
  state: ConnectFlowState,
  action: ConnectAction
): ConnectFlowState {
  switch (action.type) {
    case 'choose-adapter': {
      if (!isConnectableAdapter(action.adapterId)) {
        return {
          ...state,
          issues: [
            issue(
              'adapter-not-connectable',
              'OpenClaw is the source Exawatt connects to today.'
            ),
          ],
        };
      }
      return {
        ...state,
        adapterId: action.adapterId,
        issues: [],
        history: push(state.history, state.step),
        step: {
          kind: 'choose-server',
          aliases: [],
          configPresent: false,
          incompleteIncludes: false,
          manual: false,
          draft: emptyManualDraft(),
        },
      };
    }

    case 'aliases-loaded': {
      if (state.step.kind !== 'choose-server') return state;
      return {
        ...state,
        step: {
          ...state.step,
          aliases: action.aliases,
          configPresent: action.configPresent,
          incompleteIncludes: action.incompleteIncludes,
          // With no configuration to choose from, describing the server is the
          // path, not a fallback the operator has to go looking for.
          manual: state.step.manual || !action.configPresent,
        },
      };
    }

    case 'set-manual': {
      if (state.step.kind !== 'choose-server') return state;
      return {
        ...state,
        issues: [],
        step: { ...state.step, manual: action.manual },
      };
    }

    case 'edit-manual': {
      if (state.step.kind !== 'choose-server') return state;
      const draft = { ...state.step.draft, ...action.patch };
      return {
        ...state,
        issues: [],
        step: { ...state.step, draft },
      };
    }

    case 'test-started': {
      if (state.step.kind !== 'choose-server' && state.step.kind !== 'failed') {
        return state;
      }
      const history =
        state.step.kind === 'choose-server'
          ? push(state.history, state.step)
          : state.history;
      return {
        ...state,
        history,
        pendingSourceId: action.sourceId,
        pendingAlias: action.alias,
        operatorAuthored: action.operatorAuthored,
        issues: [],
        step: { kind: 'testing', alias: action.alias, stage: 'tunnel' },
      };
    }

    case 'test-stage': {
      if (state.step.kind !== 'testing') return state;
      return { ...state, step: { ...state.step, stage: action.stage } };
    }

    case 'test-failed': {
      if (state.step.kind !== 'testing') return state;
      // No roster Agent exists yet and none is created here. The flow keeps
      // the alias so a retry costs one keystroke, and the stage it stopped on
      // so the report names the step that failed rather than the first one.
      return {
        ...state,
        step: {
          kind: 'failed',
          alias: state.step.alias,
          stage: state.step.stage,
          failure: action.failure,
          message: action.message,
        },
      };
    }

    case 'agents-discovered': {
      if (state.step.kind !== 'testing') return state;
      const sourceId = state.pendingSourceId;
      if (sourceId === null) return state;
      return {
        ...state,
        step: {
          kind: 'choose-agents',
          alias: state.step.alias,
          sourceId,
          agents: action.agents,
          selected: preselectedAgentIds(action.agents),
          facts: action.facts,
        },
      };
    }

    case 'toggle-agent': {
      if (state.step.kind !== 'choose-agents') return state;
      const known = state.step.agents.some(
        agent => agent.nativeAgentId === action.nativeAgentId
      );
      if (!known) return state;
      const selected = new Set(state.step.selected);
      if (selected.has(action.nativeAgentId)) {
        selected.delete(action.nativeAgentId);
      } else {
        // The one way a retired identity is imported: the operator says so.
        selected.add(action.nativeAgentId);
      }
      return { ...state, issues: [], step: { ...state.step, selected } };
    }

    case 'to-mapping': {
      if (state.step.kind !== 'choose-agents') return state;
      const rows = mappingRowsFor(state.step.agents, state.step.selected);
      if (rows.length === 0) {
        return {
          ...state,
          issues: [issue('selection-required', 'Choose at least one Agent.')],
        };
      }
      return {
        ...state,
        issues: [],
        history: push(state.history, state.step),
        step: {
          kind: 'map-projects',
          alias: state.step.alias,
          sourceId: state.step.sourceId,
          rows,
        },
      };
    }

    case 'edit-mapping': {
      if (state.step.kind !== 'map-projects') return state;
      const rows = state.step.rows.map(row =>
        row.nativeAgentId === action.nativeAgentId
          ? {
              ...row,
              ...(action.patch.nameOverride !== undefined
                ? { nameOverride: normalizeOverride(action.patch.nameOverride) }
                : {}),
              ...(action.patch.project !== undefined
                ? { project: action.patch.project }
                : {}),
            }
          : row
      );
      return { ...state, issues: [], step: { ...state.step, rows } };
    }

    case 'save': {
      if (state.step.kind !== 'map-projects') return state;
      const outcome = saveConnectFlow(state, action.knownProjectIds);
      if (!outcome.ok) return { ...state, issues: outcome.issues };
      // The step does not move: the caller opens the coworker and the dialog
      // closes. What changes is custody — this source is the operator's now,
      // so leaving no longer releases it.
      return { ...state, issues: [], settled: true };
    }

    case 'back': {
      if (!canGoBack(state)) return state;
      const previous = state.history[state.history.length - 1];
      if (!previous) return state;
      return {
        ...state,
        issues: [],
        history: state.history.slice(0, -1),
        step: previous,
      };
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

function push(
  history: readonly ConnectStep[],
  step: ConnectStep
): readonly ConnectStep[] {
  return [...history, step];
}
