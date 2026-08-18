import {
  AGENT_SOURCE_EVIDENCE_BASES,
  type AgentSourceAdapterId,
  type AgentSourceEvidenceBasis,
} from '../agent-sources';
import {
  AGENT_SOURCE_PLACEMENTS,
  type AgentSourcePlacement,
  type AgentSourceTopologySnapshot,
  type SourceAgentRecord,
  type SourceContextKind,
  type SourceContextRecord,
  type SourceContextRef,
  type SourceContextRole,
} from '../agent-projection';

/**
 * OpenClaw Gateway topology adapter (ENG-010 C1).
 *
 * Converts raw, untrusted `agents.list` and `sessions.list` JSON into the
 * source-neutral `AgentSourceTopologySnapshot` the projection kernel consumes.
 *
 * Pure by construction: no network, no filesystem, no clock. `observedAt` is an
 * input so that adapting the same bytes twice yields an identical snapshot,
 * which is what lets reconnect diffing compare snapshots by value.
 *
 * The kernel fails closed on structurally invalid input (orphan contexts,
 * ambiguous primaries), so this adapter must never hand it a record it would
 * reject. Every degradation here therefore drops the offending record and
 * reports an issue rather than passing the problem downstream.
 */

const OPENCLAW_ADAPTER_ID: AgentSourceAdapterId = 'openclaw';

/** Mirrors the kernel's own bounds so a snapshot that adapts also validates. */
const MAX_ID_LENGTH = 4096;
const MAX_LABEL_LENGTH = 512;

/*
 * Bounds exist because the Gateway is a remote peer: a compromised or buggy
 * Gateway must not be able to make Exawatt allocate without limit.
 */
const MAX_AGENTS = 500;
const MAX_CONTEXTS_PER_AGENT = 2_000;
const MAX_CONTEXTS_TOTAL = 20_000;

/** Session keys are `agent:<nativeAgentId>:<discriminator>[:<rest>]`. */
const SESSION_KEY_PREFIX = 'agent';
const SESSION_KEY_MIN_SEGMENTS = 3;

/** Placeholder for a session payload that declares no `kind` of its own. */
const UNKNOWN_NATIVE_KIND = 'unknown';

const PRIMARY_CONVERSATION_ROLE: SourceContextRole = 'primary-conversation';
const NO_ROLES: readonly SourceContextRole[] = [];

const AGENT_SOURCE_PLACEMENT_SET: ReadonlySet<string> = new Set(
  AGENT_SOURCE_PLACEMENTS
);
const AGENT_SOURCE_EVIDENCE_BASIS_SET: ReadonlySet<string> = new Set(
  AGENT_SOURCE_EVIDENCE_BASES
);

/*
 * Classification is driven ONLY by the third key segment. A live Gateway probe
 * showed a cron session reporting `kind: "direct"` and a human-readable label
 * of `Cron: <job>`, so both the payload's own kind and its label are unusable
 * as evidence of what a context is. The key is the only field the Gateway
 * derives structurally.
 */
const CONTEXT_KIND_BY_KEY_SEGMENT: ReadonlyMap<string, SourceContextKind> =
  new Map<string, SourceContextKind>([
    ['main', 'main'],
    ['cron', 'cron'],
    ['subagent', 'spawned'],
    ['channel', 'channel'],
  ]);

/** Any segment Exawatt does not recognise is a helper thread, not an unknown. */
const FALLBACK_CONTEXT_KIND: SourceContextKind = 'helper';

export interface OpenClawTopologyInput {
  configuredSourceId: string;
  gatewayId: string;
  placement: AgentSourcePlacement;
  evidenceBasis: AgentSourceEvidenceBasis;
  observedAt: number;
  /** Raw `agents.list` result. */
  agentsList: unknown;
  /** Raw `sessions.list` results, one entry per configured Agent. */
  sessionLists: readonly { nativeAgentId: string; payload: unknown }[];
  /** Native Agent ids the operator explicitly kept as retired history. */
  retiredNativeAgentIds?: readonly string[];
}

export type OpenClawTopologyIssueCode =
  | 'invalid-agents-payload'
  | 'invalid-agent-entry'
  | 'duplicate-agent'
  | 'invalid-sessions-payload'
  | 'invalid-session-entry'
  | 'duplicate-context'
  | 'orphan-session-agent'
  | 'session-key-agent-mismatch'
  | 'multiple-main-contexts'
  | 'context-cap-exceeded'
  | 'agent-cap-exceeded'
  /*
   * Not a Gateway-payload fault: the caller's own source identity is unusable.
   * Reported separately so a configuration bug is never mistaken for a bad
   * remote payload — the operator fixes these two in completely different
   * places.
   */
  | 'invalid-source-identity';

export interface OpenClawTopologyIssue {
  severity: 'warning' | 'error';
  code: OpenClawTopologyIssueCode;
  /** Stable structural location; never a serialized record. */
  path: string;
  /** Never includes a workspace path, model id, or label verbatim. */
  message: string;
}

export type OpenClawTopologyResult =
  | {
      ok: true;
      snapshot: AgentSourceTopologySnapshot;
      issues: readonly OpenClawTopologyIssue[];
    }
  | { ok: false; issues: readonly OpenClawTopologyIssue[] };

export interface SessionKeyClassification {
  nativeAgentId: string;
  kind: SourceContextKind;
  /** Everything after `agent:<nativeAgentId>:`, kept whole and lossless. */
  nativeSuffix: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validText(value: unknown, maxLength = MAX_ID_LENGTH): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !value.includes('\0')
  );
}

/** Gateway timestamps are unix ms; zero and negatives are "never active". */
function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(
  severity: OpenClawTopologyIssue['severity'],
  code: OpenClawTopologyIssueCode,
  path: string,
  message: string
): OpenClawTopologyIssue {
  return { severity, code, path, message };
}

function sortedIssues(
  issues: readonly OpenClawTopologyIssue[]
): OpenClawTopologyIssue[] {
  return [...issues].sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.code, right.code) ||
      compareText(left.severity, right.severity) ||
      compareText(left.message, right.message)
  );
}

/**
 * Pick a human label without ever adopting a value that could carry a path or
 * a credential: only the Gateway's own name fields are candidates, and the
 * native id is the guaranteed fallback.
 */
function pickDisplayName(entry: Record<string, unknown>, id: string): string {
  const candidates = [entry.identityName, entry.name, id];
  for (const candidate of candidates) {
    if (!validText(candidate, Number.MAX_SAFE_INTEGER)) continue;
    const label = candidate.trim().slice(0, MAX_LABEL_LENGTH).trim();
    if (label.length > 0) return label;
  }
  // `id` is validated non-empty before this is called, so this is unreachable.
  return id;
}

/**
 * Classify one session key. Returns null when the key is not a structurally
 * addressable Agent session, in which case the caller must drop the session
 * rather than guess which Agent it belongs to.
 *
 * Note that a native Agent id containing `:` is not addressable by this scheme;
 * such an Agent simply projects with no contexts instead of stealing another
 * Agent's sessions.
 */
export function classifySessionKey(
  key: string
): SessionKeyClassification | null {
  if (!validText(key)) return null;

  const segments = key.split(':');
  if (segments.length < SESSION_KEY_MIN_SEGMENTS) return null;
  if (segments[0] !== SESSION_KEY_PREFIX) return null;

  const nativeAgentId = segments[1] ?? '';
  const discriminator = segments[2] ?? '';
  if (!validText(nativeAgentId) || !validText(discriminator)) return null;

  return {
    nativeAgentId,
    kind:
      CONTEXT_KIND_BY_KEY_SEGMENT.get(discriminator) ?? FALLBACK_CONTEXT_KIND,
    nativeSuffix: segments.slice(2).join(':'),
  };
}

/** A context in flight, before roles and lineage are resolved. */
interface DraftContext {
  nativeAgentId: string;
  nativeContextId: string;
  kind: SourceContextKind;
  nativeKind: string;
  nativeRunId: string | null;
  /** Absent when the session payload declared nothing readable. */
  hasActiveRun?: boolean;
  /** Unresolved parent key; resolved only after capping decides what survives. */
  parentContextId: string | null;
  createdAt?: number;
  lastActiveAt?: number;
}

/** Missing activity sorts last without pretending the context is from 1970. */
function recencyOf(context: DraftContext): number {
  return context.lastActiveAt ?? -1;
}

/**
 * Cap ordering: the main context is never evicted (it is the one context an
 * operator will always look for), then most recently active wins, then the
 * context id keeps the tie deterministic.
 */
function compareForRetention(left: DraftContext, right: DraftContext): number {
  const leftMain = left.kind === 'main' ? 0 : 1;
  const rightMain = right.kind === 'main' ? 0 : 1;
  return (
    leftMain - rightMain ||
    recencyOf(right) - recencyOf(left) ||
    compareText(left.nativeAgentId, right.nativeAgentId) ||
    compareText(left.nativeContextId, right.nativeContextId)
  );
}

function readParentKey(entry: Record<string, unknown>): string | null {
  const declared = validText(entry.parentKey)
    ? entry.parentKey
    : validText(entry.parentSessionKey)
      ? entry.parentSessionKey
      : null;
  return declared;
}

/**
 * Adapt one Gateway observation into a projection-ready snapshot.
 *
 * Fails closed (`ok: false`) only when nothing usable survives: the payload is
 * not shaped like `agents.list`, or no Agent validates. Everything else
 * degrades — the offending record is dropped and an issue explains where.
 */
export function adaptOpenClawTopology(
  input: OpenClawTopologyInput
): OpenClawTopologyResult {
  const issues: OpenClawTopologyIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        issue(
          'error',
          'invalid-source-identity',
          'input',
          'Adapter input must be a record.'
        ),
      ],
    };
  }

  const {
    configuredSourceId,
    gatewayId,
    placement,
    evidenceBasis,
    observedAt,
  } = input;
  const identityValid =
    validText(configuredSourceId) &&
    validText(gatewayId) &&
    typeof placement === 'string' &&
    AGENT_SOURCE_PLACEMENT_SET.has(placement) &&
    typeof evidenceBasis === 'string' &&
    AGENT_SOURCE_EVIDENCE_BASIS_SET.has(evidenceBasis) &&
    typeof observedAt === 'number' &&
    Number.isFinite(observedAt) &&
    observedAt >= 0;
  if (!identityValid) {
    return {
      ok: false,
      issues: [
        issue(
          'error',
          'invalid-source-identity',
          'input',
          'Configured source identity, placement, Gateway, evidence basis, or observation time is invalid.'
        ),
      ],
    };
  }

  const agentsList: unknown = input.agentsList;
  if (!isRecord(agentsList) || !Array.isArray(agentsList.agents)) {
    return {
      ok: false,
      issues: [
        issue(
          'error',
          'invalid-agents-payload',
          'agentsList',
          'Gateway Agent listing must be a record containing an agents array.'
        ),
      ],
    };
  }

  // ---- Agents -------------------------------------------------------------

  const configuredById = new Map<string, SourceAgentRecord>();
  const rawAgents: readonly unknown[] = agentsList.agents;

  for (const [index, candidate] of rawAgents.entries()) {
    if (!isRecord(candidate)) {
      issues.push(
        issue(
          'warning',
          'invalid-agent-entry',
          `agentsList.agents.${index}`,
          'Agent entry must be a record.'
        )
      );
      continue;
    }
    if (!validText(candidate.id)) {
      issues.push(
        issue(
          'warning',
          'invalid-agent-entry',
          `agentsList.agents.${index}`,
          'Agent entry declares no usable native identity.'
        )
      );
      continue;
    }
    const nativeAgentId = candidate.id;
    if (configuredById.has(nativeAgentId)) {
      issues.push(
        issue(
          'warning',
          'duplicate-agent',
          `agentsList.agents.${nativeAgentId}`,
          'Native Agent identity appears more than once; the first entry wins.'
        )
      );
      continue;
    }
    configuredById.set(nativeAgentId, {
      configuredSourceId,
      nativeAgentId,
      // Only the Gateway's name fields are read; workspace, model, and runtime
      // are deliberately never copied — the snapshot has no field for them and
      // they carry filesystem paths.
      displayName: pickDisplayName(candidate, nativeAgentId),
      discoveryState: 'configured',
    });
  }

  /*
   * Retired ids let an operator keep history for an Agent the Gateway no longer
   * lists. A retired id that is still configured is not a conflict: the live
   * roster is simply the better evidence, so it wins silently.
   */
  const retiredIds = new Set<string>();
  const rawRetired: readonly unknown[] = Array.isArray(
    input.retiredNativeAgentIds
  )
    ? input.retiredNativeAgentIds
    : [];
  if (
    input.retiredNativeAgentIds !== undefined &&
    !Array.isArray(input.retiredNativeAgentIds)
  ) {
    issues.push(
      issue(
        'warning',
        'invalid-agent-entry',
        'retiredNativeAgentIds',
        'Retired Agent identities must be an array.'
      )
    );
  }
  for (const [index, candidate] of rawRetired.entries()) {
    if (!validText(candidate)) {
      issues.push(
        issue(
          'warning',
          'invalid-agent-entry',
          `retiredNativeAgentIds.${index}`,
          'Retired Agent identity is not usable text.'
        )
      );
      continue;
    }
    if (configuredById.has(candidate)) continue;
    // Operator-supplied set semantics: repeating an id is not a payload fault.
    retiredIds.add(candidate);
  }

  const agentRecords: SourceAgentRecord[] = [...configuredById.values()].sort(
    (left, right) => compareText(left.nativeAgentId, right.nativeAgentId)
  );
  const retiredRecords: SourceAgentRecord[] = [...retiredIds]
    .sort(compareText)
    .map(nativeAgentId => ({
      configuredSourceId,
      nativeAgentId,
      displayName: nativeAgentId.slice(0, MAX_LABEL_LENGTH),
      discoveryState: 'retired' as const,
    }));

  /*
   * Configured Agents claim the budget first: a live coworker matters more than
   * retired history when the roster is implausibly large.
   */
  let keptAgents = agentRecords.slice(0, MAX_AGENTS);
  const retiredBudget = Math.max(0, MAX_AGENTS - keptAgents.length);
  keptAgents = [...keptAgents, ...retiredRecords.slice(0, retiredBudget)];
  if (agentRecords.length + retiredRecords.length > MAX_AGENTS) {
    issues.push(
      issue(
        'warning',
        'agent-cap-exceeded',
        'agents',
        `Gateway reported more than ${MAX_AGENTS} Agents; the remainder is not projected.`
      )
    );
  }

  if (keptAgents.length === 0) {
    issues.push(
      issue(
        'error',
        'invalid-agents-payload',
        'agentsList.agents',
        'Gateway Agent listing contained no usable Agent.'
      )
    );
    return { ok: false, issues: sortedIssues(issues) };
  }

  /*
   * Orphan detection is against the live roster only. A context can only be
   * attributed to an Agent the Gateway currently lists; retired Agents keep
   * their record but gain no contexts.
   */
  const configuredAgentIds = new Set(
    keptAgents
      .filter(agent => agent.discoveryState === 'configured')
      .map(agent => agent.nativeAgentId)
  );

  // ---- Contexts -----------------------------------------------------------

  const draftsByAgent = new Map<string, Map<string, DraftContext>>();
  const rawSessionLists: readonly unknown[] = Array.isArray(input.sessionLists)
    ? input.sessionLists
    : [];
  if (!Array.isArray(input.sessionLists)) {
    issues.push(
      issue(
        'warning',
        'invalid-sessions-payload',
        'sessionLists',
        'Gateway session listings must be an array.'
      )
    );
  }

  for (const [index, listEntry] of rawSessionLists.entries()) {
    if (!isRecord(listEntry) || !validText(listEntry.nativeAgentId)) {
      issues.push(
        issue(
          'warning',
          'invalid-sessions-payload',
          `sessionLists.${index}`,
          'Session listing must name the native Agent it was fetched for.'
        )
      );
      continue;
    }
    const fetchedForId = listEntry.nativeAgentId;
    if (!configuredAgentIds.has(fetchedForId)) {
      issues.push(
        issue(
          'warning',
          'orphan-session-agent',
          `sessionLists.${fetchedForId}`,
          'Session listing names an Agent absent from the Gateway roster; its sessions are dropped.'
        )
      );
      continue;
    }
    const payload: unknown = listEntry.payload;
    if (!isRecord(payload) || !Array.isArray(payload.sessions)) {
      issues.push(
        issue(
          'warning',
          'invalid-sessions-payload',
          `sessionLists.${fetchedForId}`,
          'Session listing must be a record containing a sessions array.'
        )
      );
      continue;
    }

    const drafts =
      draftsByAgent.get(fetchedForId) ?? new Map<string, DraftContext>();
    draftsByAgent.set(fetchedForId, drafts);

    const rawSessions: readonly unknown[] = payload.sessions;
    for (const [sessionIndex, candidate] of rawSessions.entries()) {
      const sessionPath = `sessionLists.${fetchedForId}.sessions.${sessionIndex}`;
      if (!isRecord(candidate) || !validText(candidate.key)) {
        issues.push(
          issue(
            'warning',
            'invalid-session-entry',
            sessionPath,
            'Session entry must be a record with a usable key.'
          )
        );
        continue;
      }
      const key = candidate.key;
      const classification = classifySessionKey(key);
      if (!classification) {
        issues.push(
          issue(
            'warning',
            'invalid-session-entry',
            sessionPath,
            'Session key is not an addressable Agent session key.'
          )
        );
        continue;
      }
      /*
       * Neither side of a disagreement is trustworthy: the key could belong to
       * another Agent, or the listing could be misattributed. Dropping is the
       * only answer that cannot invent a coworker relationship.
       */
      if (classification.nativeAgentId !== fetchedForId) {
        issues.push(
          issue(
            'warning',
            'session-key-agent-mismatch',
            `${sessionPath}.key`,
            'Session key names a different Agent than the listing it arrived in.'
          )
        );
        continue;
      }
      if (!configuredAgentIds.has(classification.nativeAgentId)) {
        issues.push(
          issue(
            'warning',
            'orphan-session-agent',
            `${sessionPath}.key`,
            'Session key names an Agent absent from the Gateway roster.'
          )
        );
        continue;
      }
      if (drafts.has(key)) {
        issues.push(
          issue(
            'warning',
            'duplicate-context',
            `contexts.${fetchedForId}.${key}`,
            'Session key appears more than once for this Agent; the first entry wins.'
          )
        );
        continue;
      }

      const nativeKind = validText(candidate.kind, MAX_LABEL_LENGTH)
        ? candidate.kind
        : UNKNOWN_NATIVE_KIND;
      const draft: DraftContext = {
        nativeAgentId: fetchedForId,
        nativeContextId: key,
        kind: classification.kind,
        nativeKind,
        nativeRunId: validText(candidate.sessionId)
          ? candidate.sessionId
          : null,
        parentContextId: readParentKey(candidate),
      };
      /*
       * `sessions.list` reports a run in flight per session. A Gateway that
       * omits the field, or answers with something other than a boolean, has
       * told Exawatt nothing: the fact stays absent rather than becoming
       * `false`, because "not running" and "never said" are different claims
       * and neither may be coerced into the other. Truthiness is deliberately
       * not accepted, so a string can never promote a coworker to working.
       */
      if (typeof candidate.hasActiveRun === 'boolean') {
        draft.hasActiveRun = candidate.hasActiveRun;
      }
      if (validTimestamp(candidate.createdAt)) {
        draft.createdAt = candidate.createdAt;
      }
      if (validTimestamp(candidate.updatedAt)) {
        draft.lastActiveAt = candidate.updatedAt;
      }
      drafts.set(key, draft);
    }
  }

  // ---- Bounds -------------------------------------------------------------

  const survivors: DraftContext[] = [];
  for (const [nativeAgentId, drafts] of [...draftsByAgent.entries()].sort(
    ([left], [right]) => compareText(left, right)
  )) {
    const ordered = [...drafts.values()].sort(compareForRetention);
    if (ordered.length > MAX_CONTEXTS_PER_AGENT) {
      issues.push(
        issue(
          'warning',
          'context-cap-exceeded',
          `contexts.${nativeAgentId}`,
          `Agent reported more than ${MAX_CONTEXTS_PER_AGENT} sessions; only the most recently active are projected.`
        )
      );
    }
    survivors.push(...ordered.slice(0, MAX_CONTEXTS_PER_AGENT));
  }

  let keptContexts = survivors;
  if (survivors.length > MAX_CONTEXTS_TOTAL) {
    issues.push(
      issue(
        'warning',
        'context-cap-exceeded',
        'contexts',
        `Gateway reported more than ${MAX_CONTEXTS_TOTAL} sessions; only the most recently active are projected.`
      )
    );
    keptContexts = [...survivors]
      .sort(compareForRetention)
      .slice(0, MAX_CONTEXTS_TOTAL);
  }

  // ---- Lineage and roles --------------------------------------------------

  const keptByAgent = new Map<string, DraftContext[]>();
  for (const context of keptContexts) {
    const bucket = keptByAgent.get(context.nativeAgentId) ?? [];
    bucket.push(context);
    keptByAgent.set(context.nativeAgentId, bucket);
  }
  const keptKeysByAgent = new Map<string, Set<string>>();
  for (const [nativeAgentId, bucket] of keptByAgent) {
    keptKeysByAgent.set(
      nativeAgentId,
      new Set(bucket.map(context => context.nativeContextId))
    );
  }

  /*
   * A single main context is the only thing that can carry the primary role. No
   * main is normal (an Agent driven purely by automations has never been
   * conversed with), so it is neither an error nor a warning here — the kernel
   * already warns once, at the point where a coworker gets no primary.
   */
  const primaryByAgent = new Map<string, string>();
  for (const [nativeAgentId, bucket] of [...keptByAgent.entries()].sort(
    ([left], [right]) => compareText(left, right)
  )) {
    const mains = bucket.filter(context => context.kind === 'main');
    if (mains.length === 1) {
      primaryByAgent.set(nativeAgentId, mains[0]!.nativeContextId);
    } else if (mains.length > 1) {
      issues.push(
        issue(
          'warning',
          'multiple-main-contexts',
          `contexts.${nativeAgentId}`,
          'Agent declares more than one main session; no primary conversation is assigned.'
        )
      );
    }
  }

  const contextRecords: SourceContextRecord[] = keptContexts.map(context => {
    const siblings = keptKeysByAgent.get(context.nativeAgentId);
    /*
     * A parent is only meaningful inside the same source and Agent, and only if
     * it actually survived. Anything else becomes null instead of a lineage the
     * kernel would reject.
     */
    let parent: SourceContextRef | null = null;
    if (context.parentContextId && siblings) {
      const parentClass = classifySessionKey(context.parentContextId);
      const sameAgent = parentClass?.nativeAgentId === context.nativeAgentId;
      const present = siblings.has(context.parentContextId);
      const notSelf = context.parentContextId !== context.nativeContextId;
      if (sameAgent && present && notSelf) {
        parent = {
          configuredSourceId,
          nativeAgentId: context.nativeAgentId,
          nativeContextId: context.parentContextId,
        };
      }
    }
    return {
      configuredSourceId,
      nativeAgentId: context.nativeAgentId,
      nativeContextId: context.nativeContextId,
      kind: context.kind,
      nativeKind: context.nativeKind,
      parent,
      roles:
        primaryByAgent.get(context.nativeAgentId) === context.nativeContextId
          ? [PRIMARY_CONVERSATION_ROLE]
          : NO_ROLES,
      nativeRunId: context.nativeRunId,
      ...(context.hasActiveRun === undefined
        ? {}
        : { hasActiveRun: context.hasActiveRun }),
      ...(context.createdAt === undefined
        ? {}
        : { createdAt: context.createdAt }),
      ...(context.lastActiveAt === undefined
        ? {}
        : { lastActiveAt: context.lastActiveAt }),
    };
  });

  contextRecords.sort(
    (left, right) =>
      compareText(left.nativeContextId, right.nativeContextId) ||
      compareText(left.nativeAgentId, right.nativeAgentId)
  );

  const snapshot: AgentSourceTopologySnapshot = {
    configuredSourceId,
    adapterId: OPENCLAW_ADAPTER_ID,
    placement,
    gatewayId,
    observedAt,
    evidenceBasis,
    agents: keptAgents
      .slice()
      .sort((left, right) =>
        compareText(left.nativeAgentId, right.nativeAgentId)
      ),
    contexts: contextRecords,
  };

  return { ok: true, snapshot, issues: sortedIssues(issues) };
}
