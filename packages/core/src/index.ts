export * from './types/index';
export * from './agent-sources';
export * from './agent-projection';
// ENG-010 C1: configured remote sources, their transport candidates, and the
// adapter that turns observed Gateway payloads into projection input.
export * from './sources/connected-source';
// ENG-010 C3: the Demo connected source the lifecycle contract runs against.
export * from './sources/demo-connected-source';
export * from './oc/ssh-config';
export * from './oc/topology-adapter';
export { TypedEmitter } from './events/emitter';
export type { CoreEventMap, CoreEmitter } from './events/emitter';
export {
  generateDeviceKeypair,
  signChallenge,
  buildDeviceAuthPayload,
  signDevicePayload,
  deriveDeviceId,
} from './oc/auth';
export { OCClient } from './oc/client';
export { OCMethods } from './oc/methods';
export type {
  OCClientConfig,
  OCConnectionStatus,
  OCGatewayClient,
  OCGatewayOperatorScope,
} from './oc/client';
export { ChatAdapter } from './adapters/chat-adapter';
export { FleetAdapter } from './adapters/fleet-adapter';
export { FleetManager } from './state/fleet-manager';
export { resolveContextGroups } from './state/context-groups';
// EVAL-ONLY since ENG-027 W2: the simulation engine must not run on product
// surfaces — the Demo Workspace transport below is the only demo source there.
export { MockFleetTransport } from './transports/mock-fleet';
export type { SimulationSpeed, FleetScale } from './transports/mock-fleet';
export {
  DemoWorkspaceTransport,
  demoWorkspaceAgent,
  demoWorkspaceProjectCatalog,
} from './transports/demo-workspace';
export type { DemoWorkspaceTransportOptions } from './transports/demo-workspace';
export {
  LocalSessionsTransport,
  sessionToAgent,
  sessionStatus,
} from './transports/local-sessions';
export type {
  LocalSessionSnapshot,
  LocalSessionsSource,
  LocalSessionsOptions,
} from './transports/local-sessions';
export { parseRoadmap, resolveRoadmapSectionStatus } from './roadmap/parse';
export type { ParseRoadmapOptions } from './roadmap/parse';
export { inferSessionLinks } from './roadmap/link';
export type { SessionLinkCandidate } from './roadmap/link';
export type {
  RoadmapItemStatus,
  RoadmapBacklogMetadata,
  RoadmapSourceRef,
  RoadmapMilestone,
  RoadmapItem,
  RoadmapDiagnostic,
  RoadmapConformance,
  RoadmapConvention,
  RoadmapDoc,
  SessionLinkMethod,
  SessionLinkConfidence,
  SessionLinkEvidence,
  SessionLink,
} from './roadmap/types';
export * from './consumption/index';
export * from './operator-stats/index';
export * from './demo/index';
export * from './launch-configurations';
export * from './launch-recommendation';
export * from './release-provenance';
export * from './surface-names';
export * from './shortcuts/command-verbs';
export * from './shortcuts/accelerator';
export * from './shortcuts/keyboard-overrides';
export * from './distribution/index';
