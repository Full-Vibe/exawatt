/**
 * Renderer-safe Agent Source contract.
 *
 * Declarations describe what an adapter is designed to support. Snapshots
 * describe what Electron main actually observed on this machine. Keeping the
 * two explicit prevents UI copy from turning a declared capability into a
 * successful probe.
 */

export type AgentHarness = 'claude' | 'codex' | 'opencode' | 'grok';
export type PtyHarness = 'shell' | AgentHarness;
export type AgentPermissionMode = 'prompt' | 'auto' | 'unrestricted';

export type AgentSourceAdapterId = AgentHarness | 'openclaw' | 'demo';
export type AgentSourceCatalogId =
  | AgentSourceAdapterId
  | 'hosted-openclaw'
  | 'custom';

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

export type AgentSourceEvidenceBasis = 'observed' | 'declared' | 'simulated';

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

export interface AgentSourceSnapshot extends AgentSourceDeclaration {
  id: string;
  configured: boolean;
  launchable: boolean;
  state: AgentSourceState;
  stateLabel: string;
  summary: string;
  observedAt: number;
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
