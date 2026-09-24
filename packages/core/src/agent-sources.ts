/**
 * Renderer-safe Agent Source contract.
 *
 * Declarations describe what an adapter is designed to support. Snapshots
 * describe what Electron main actually observed on this machine. Keeping the
 * two explicit prevents UI copy from turning a declared capability into a
 * successful probe.
 */

import {
  AGENT_HARNESSES,
  AGENT_SOURCE_ADAPTER_IDS,
  AGENT_SOURCE_CATALOG_IDS,
} from './generated/agent-source-ids';

/*
 * The id lists are generated from `contracts/agent-sources.json`, so
 * declaring a source there is what adds it to every type and guard below.
 */
export { AGENT_HARNESSES, AGENT_SOURCE_ADAPTER_IDS, AGENT_SOURCE_CATALOG_IDS };

export type AgentHarness = (typeof AGENT_HARNESSES)[number];
export type PtyHarness = 'shell' | AgentHarness;
export type AgentPermissionMode = 'prompt' | 'auto' | 'unrestricted';

export type AgentSourceAdapterId = (typeof AGENT_SOURCE_ADAPTER_IDS)[number];

export type AgentSourceCatalogId = (typeof AGENT_SOURCE_CATALOG_IDS)[number];

const AGENT_HARNESS_SET: ReadonlySet<string> = new Set(AGENT_HARNESSES);
const AGENT_SOURCE_ADAPTER_ID_SET: ReadonlySet<string> = new Set(
  AGENT_SOURCE_ADAPTER_IDS
);

/** A source Exawatt runs as a local CLI. Safe on untrusted IPC input. */
export function isAgentHarness(value: unknown): value is AgentHarness {
  return typeof value === 'string' && AGENT_HARNESS_SET.has(value);
}

/** Any declared Agent Source. Safe on untrusted IPC input. */
export function isAgentSourceAdapterId(
  value: unknown
): value is AgentSourceAdapterId {
  return typeof value === 'string' && AGENT_SOURCE_ADAPTER_ID_SET.has(value);
}

export type AgentSourceState =
  | 'ready'
  /** Renderer-only: a sign-in the operator opened is being reconciled. */
  | 'connecting'
  /**
   * Renderer-only: the first probe of this process is running and nothing
   * has been remembered to paint meanwhile. Distinct from `unknown`, which
   * is what a probe that RAN and did not answer leaves behind (BUG-082:
   * "not yet checked" wore the words of "checked and failed").
   */
  | 'checking'
  | 'action-required'
  | 'degraded'
  | 'unavailable'
  | 'not-installed'
  | 'incompatible'
  | 'unknown';

export type AgentSourceFactState =
  | 'ready'
  | 'action-required'
  | 'degraded'
  | 'unavailable'
  | 'not-installed'
  | 'incompatible'
  | 'unknown'
  | 'simulated';

export const AGENT_SOURCE_EVIDENCE_BASES = [
  'observed',
  'declared',
  'simulated',
] as const;
export type AgentSourceEvidenceBasis =
  (typeof AGENT_SOURCE_EVIDENCE_BASES)[number];

export interface AgentSourceProvenance {
  kind:
    | 'source-command'
    | 'source-config'
    | 'source-protocol'
    | 'adapter-declaration'
    | 'simulation';
  label: string;
  observedAt: number;
}

export interface AgentSourceFact {
  basis: AgentSourceEvidenceBasis;
  state: AgentSourceFactState;
  value: string;
  detail: string;
  provenance: AgentSourceProvenance;
}

export interface AgentSourceCapabilities {
  interactiveLaunch: boolean;
  initialTask: boolean;
  exactResume: boolean;
  modelSelection: 'live-catalog' | 'source-owned' | 'gateway' | 'scenario';
  /**
   * `source-owned` means the source accepts an effort but publishes no
   * enumerable per-model option set to any interface Exawatt can read. The
   * registry fails closed: Exawatt offers no effort control rather than
   * inventing one, and the source's own selector stays the place to change it.
   */
  effortSelection:
    | 'live-catalog'
    | 'configured-value'
    | 'source-owned'
    | 'gateway'
    | 'scenario';
  permissionModes: readonly AgentPermissionMode[];
  delegationObservation: string;
  enforcementOwner: string;
}

export interface AgentSourceDeclaration {
  adapterId: AgentSourceAdapterId;
  harness: AgentHarness | null;
  label: string;
  connectionName: string;
  color: string;
  installationGuideUrl: string | null;
  description: string;
  capabilities: AgentSourceCapabilities;
}

/**
 * A probe that a snapshot's producer started but never got an answer from:
 * the command was killed by its deadline, or it never spawned at all.
 *
 * Names are operator-legible because they reach the Settings surface.
 */
export type AgentSourceProbeName =
  | 'installation'
  | 'version'
  | 'authentication'
  | 'model catalog'
  | 'launch environment'
  | 'gateway';

/**
 * Where a snapshot's facts came from (readiness fact model, BUG-062/BUG-082).
 *
 * - `live`: every fact was produced by a probe in THIS process.
 * - `remembered`: the last complete observation persisted on this machine,
 *   painted while this process revalidates it. `observedAt` is the ORIGINAL
 *   observation time, so the age is honest. `revalidation` is null until
 *   this process has tried; afterwards it names when it tried and which
 *   probes did not answer, which is why the memory is still on screen.
 * - `declared`: nothing on this machine has observed the source at all; the
 *   snapshot is the adapter's declaration (the web fallback with no bridge).
 *
 * Only a `live` negative refuses a launch, on every surface: a remembered
 * negative is a fact with an age, not a present verdict (incident `0021`).
 * `agentSourceLaunchVerdict` is where that is decided.
 */
export type AgentSourceObservation =
  | { origin: 'live' }
  | {
      origin: 'remembered';
      revalidation: null | {
        attemptedAt: number;
        unobservedProbes: readonly AgentSourceProbeName[];
      };
    }
  | { origin: 'declared' };

export interface AgentSourceSnapshot extends AgentSourceDeclaration {
  id: string;
  configured: boolean;
  /**
   * Exawatt would spawn this source: its CLI is present and its version
   * answered. Sign-in is NOT part of this (incident `0021`): a source that
   * reports no account still launches, and runs its own sign-in in the pane.
   */
  launchable: boolean;
  state: AgentSourceState;
  stateLabel: string;
  summary: string;
  observedAt: number;
  /** Required on purpose, exactly like `unobservedProbes` below. */
  observation: AgentSourceObservation;
  /**
   * Coverage, declared by the producer (BUG-063). Every probe listed here was
   * asked and never answered, so the `state` beside it is how far Exawatt got,
   * not what is true of the source. Empty means the observation is complete
   * and `state` is a claim about the world.
   *
   * Required on purpose: a new adapter cannot ship a snapshot that silently
   * passes off an unfinished probe as an observed verdict.
   */
  unobservedProbes: readonly AgentSourceProbeName[];
  facts: {
    installation: AgentSourceFact;
    reachability: AgentSourceFact;
    authentication: AgentSourceFact;
    identity: AgentSourceFact;
    compatibility: AgentSourceFact;
    modelDiscovery: AgentSourceFact;
    /** Runtime observation health; independent of launch and parent turn state. */
    delegation?: AgentSourceFact;
  };
  actions: {
    recheck: boolean;
    authenticate: boolean;
    chooseModel: boolean;
    installGuide: boolean;
  };
}

export interface AgentSourceCatalogEntry {
  adapterId: AgentSourceCatalogId;
  label: string;
  description: string;
  availability: 'configured' | 'not-installed' | 'configure' | 'coming-soon';
}

export interface AgentSourceRegistrySnapshot {
  sources: AgentSourceSnapshot[];
  available: AgentSourceCatalogEntry[];
  comingSoon: AgentSourceCatalogEntry[];
  observedAt: number;
}

/**
 * What Exawatt learned about a source's ability to launch right now.
 *
 * The `known: false` arm carries NO message, by construction. "We did not
 * finish asking" is a fact about Exawatt's own progress, and it has no
 * operator-facing sentence anywhere in the product, so no surface can render
 * one for a source nobody finished probing (BUG-063). That is the same wall
 * `FleetAttentionSignals` puts around attention in BUG-026: the incomplete
 * form exists in the type system and cannot reach the surface that publishes.
 *
 * `agentSourceLaunchReadiness` is the only producer.
 */
export type AgentSourceLaunchReadiness =
  | { known: true; blocked: false }
  | { known: true; blocked: true; message: string }
  | { known: false; unobserved: readonly AgentSourceProbeName[] };

/**
 * How current a painted fact is. Four different things, never one word
 * (BUG-062 / BUG-082: "not yet checked" used to wear the words of "checked
 * and failed").
 *
 * - `checking`: a probe is in flight and nothing fresh is painted yet.
 * - `known`: observed within the fresh window.
 * - `stale`: a complete observation older than the fresh window, either
 *   remembered from an earlier process or a live one that has aged.
 * - `unobserved`: nothing complete has ever been observed and no probe is
 *   running; a launch attempt is the better probe (BUG-063).
 */
export type AgentSourceFactFreshness =
  | 'checking'
  | 'known'
  | 'stale'
  | 'unobserved';

/**
 * A fact is current for five minutes, the same window the model catalog
 * cache uses to decide when to revalidate in the background (BUG-115).
 */
export const AGENT_SOURCE_FACT_FRESH_MS = 5 * 60_000;

/** A snapshot that makes a claim: complete coverage and a stated state. */
export function agentSourceObservationComplete(
  snapshot: AgentSourceSnapshot
): boolean {
  return (
    snapshot.observation.origin !== 'declared' &&
    snapshot.unobservedProbes.length === 0 &&
    snapshot.state !== 'unknown'
  );
}

export function agentSourceFactFreshness(input: {
  snapshot: AgentSourceSnapshot | null | undefined;
  /** A probe for this source is in flight right now. */
  checking: boolean;
  now: number;
}): AgentSourceFactFreshness {
  const { snapshot, checking, now } = input;
  if (!snapshot || !agentSourceObservationComplete(snapshot)) {
    return checking ? 'checking' : 'unobserved';
  }
  const age = now - snapshot.observedAt;
  if (age >= 0 && age <= AGENT_SOURCE_FACT_FRESH_MS) return 'known';
  return checking ? 'checking' : 'stale';
}

/** A fact the source cannot repair by running, so a LIVE one refuses. */
export type AgentSourceBlockingFact =
  | 'not-installed'
  | 'incompatible'
  | 'failed-checks';

/**
 * What a snapshot says about launching, and the ONLY place that decides
 * whether it refuses. Every surface that can refuse a launch reads this: the
 * main-process gate, the composer's Start, saved setups, Clone and the
 * one-click roadmap launch (decision `0043` §7). A second predicate over the
 * same fact is how the composer came to refuse a Start main would allow
 * (BUG-181), so provenance is decided here and nowhere else.
 *
 * - `blocked` names a LIVE fact the source cannot repair by running: no CLI,
 *   a version Exawatt does not support, or checks that failed.
 * - `notice` is the sign-in fact (incident `0021`): the source reports no
 *   account, and running it is how it refreshes or asks. It never blocks.
 * - `unproven`: coverage incomplete, state unknown, or a blocking fact that
 *   is only REMEMBERED (decision `0043` §5). The attempt is the probe
 *   (BUG-063). `remembered` carries the remembered negative so a surface can
 *   still paint it, dated, without it refusing anything.
 */
export type AgentSourceLaunchVerdict =
  | { kind: 'clear' }
  | { kind: 'notice'; fact: 'sign-in-required'; reason: string }
  | { kind: 'blocked'; fact: AgentSourceBlockingFact; reason: string }
  | {
      kind: 'unproven';
      unobserved: readonly AgentSourceProbeName[];
      remembered: null | { fact: AgentSourceBlockingFact; reason: string };
    };

function unprovenVerdict(
  unobserved: readonly AgentSourceProbeName[]
): AgentSourceLaunchVerdict {
  return { kind: 'unproven', unobserved, remembered: null };
}

export function agentSourceLaunchVerdict(
  source: AgentSourceSnapshot | null | undefined
): AgentSourceLaunchVerdict {
  if (!source) return unprovenVerdict(['installation']);
  if (source.observation.origin === 'declared') {
    return unprovenVerdict(source.unobservedProbes);
  }
  // Coverage before state, exactly as the gate has done since BUG-063.
  if (source.unobservedProbes.length > 0 && !source.launchable) {
    return unprovenVerdict(source.unobservedProbes);
  }
  const stated = statedLaunchVerdict(source);
  // A remembered negative is a fact with an age, not a present verdict: this
  // process asked and got no answer, or has not asked yet. It is painted and
  // never refuses (decision `0043` §5). A remembered `ready` or sign-in fact
  // stays what it says, which is what lets ⌘T paint a live Start from memory.
  if (stated.kind === 'blocked' && source.observation.origin === 'remembered') {
    return {
      kind: 'unproven',
      unobserved: source.observation.revalidation?.unobservedProbes ?? [],
      remembered: { fact: stated.fact, reason: stated.reason },
    };
  }
  return stated;
}

/** What the snapshot's state says, before provenance is weighed. */
function statedLaunchVerdict(
  source: AgentSourceSnapshot
): AgentSourceLaunchVerdict {
  const label = source.label;
  switch (source.state) {
    case 'ready':
      return { kind: 'clear' };
    case 'action-required':
      return {
        kind: 'notice',
        fact: 'sign-in-required',
        reason: `${label}: not signed in`,
      };
    case 'not-installed':
      return {
        kind: 'blocked',
        fact: 'not-installed',
        reason: `${label} is not installed.`,
      };
    case 'incompatible':
      return {
        kind: 'blocked',
        fact: 'incompatible',
        reason: `${label} is older than the version Exawatt supports.`,
      };
    case 'degraded':
    case 'unavailable':
      return {
        kind: 'blocked',
        fact: 'failed-checks',
        reason: `${label} is installed, but its checks did not pass.`,
      };
    case 'connecting':
    case 'checking':
    case 'unknown':
      return unprovenVerdict(source.unobservedProbes);
  }
}

/** Sentence-case age for a painted fact: "12s ago", "2h ago", "3d ago". */
export function agentSourceFactAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1_000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** The snapshot states Exawatt will spawn (see `AgentSourceSnapshot.launchable`). */
export function launchableAgentSourceState(state: AgentSourceState): boolean {
  return state === 'ready' || state === 'action-required';
}

export type AgentSourceAction =
  | 'authenticate'
  | 'choose-model'
  | 'install-guide';

export interface AgentSourceActionResult {
  ok: boolean;
  message: string;
}

export type AgentSourceRegistryLoadStatus = 'live' | 'stale' | 'unavailable';

export interface AgentSourceRegistryLoadResult {
  status: AgentSourceRegistryLoadStatus;
  snapshot: AgentSourceRegistrySnapshot;
  error: null | {
    code: 'bridge-unavailable' | 'observation-failed';
    message: string;
  };
}
