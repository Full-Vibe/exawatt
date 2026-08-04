export * from './types/index';
export * from './agent-sources';
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
export type { OCClientConfig, OCConnectionStatus } from './oc/client';
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
