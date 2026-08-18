/**
 * Renderer-safe Agent Source contract.
 *
 * Declarations describe what an adapter is designed to support. Snapshots
 * describe what Electron main actually observed on this machine. Keeping the
 * two explicit prevents UI copy from turning a declared capability into a
 * successful probe.
 */

export const AGENT_HARNESSES = ['claude', 'codex', 'opencode', 'grok'] as const;
export type AgentHarness = (typeof AGENT_HARNESSES)[number];
export type PtyHarness = 'shell' | AgentHarness;
export type AgentPermissionMode = 'prompt' | 'auto' | 'unrestricted';

export const AGENT_SOURCE_ADAPTER_IDS = [
  ...AGENT_HARNESSES,
  'openclaw',
  'demo',
] as const;
export type AgentSourceAdapterId = (typeof AGENT_SOURCE_ADAPTER_IDS)[number];

export const AGENT_SOURCE_CATALOG_IDS = [
  ...AGENT_SOURCE_ADAPTER_IDS,
  'custom',
] as const;
export type AgentSourceCatalogId = (typeof AGENT_SOURCE_CATALOG_IDS)[number];

export type AgentSourceState =
  | 'ready'
  | 'connecting'
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

export interface AgentSourceSnapshot extends AgentSourceDeclaration {
  id: string;
  configured: boolean;
  launchable: boolean;
  state: AgentSourceState;
  stateLabel: string;
  summary: string;
  observedAt: number;
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
