/**
 * The Demo Workspace fixture (ENG-027 W3/W4): Voltaic Grid Systems, an
 * AI-native virtual power plant startup, authored as versioned, resettable
 * data. See `./types` for the honesty boundaries the fixture encodes.
 *
 * Consumers: W2's demo source (fleet transport + pane content source) and
 * ENG-004 V3.1's demo-scale rendering. This module is data only.
 */

export * from './types';
export {
  DEMO_WORKSPACE,
  DEMO_WORKSPACE_NOW_MS,
  DEMO_INITIATIVES,
} from './startup';
export {
  DEMO_PROJECTS,
  DEMO_PROJECTS_BY_KEY,
  DEMO_CODING_PROJECT_KEYS,
  DEMO_PREVIEW_PROJECT_KEYS,
} from './projects';
export {
  DEMO_ROADMAP_MARKDOWN,
  demoProjectRoadmap,
  demoRoadmapItemIds,
} from './roadmaps';
export { DEMO_BASE_AGENTS } from './agents';
export { DEMO_TRANSCRIPTS } from './transcripts';
export { demoWorkLog } from './work-log';
export {
  demoFleetAgents,
  demoDelegatedRunCount,
  rebuildScaleTierForTest,
  type DemoFleetOptions,
} from './scale';
export { demoAgentBurn, type DemoAgentBurn } from './burn';
export {
  DEMO_CONSUMPTION_WINDOW_DAYS,
  demoWorkspaceConsumption,
  demoWorkspacePlanWindows,
  demoWorkspaceProjectResolver,
  demoAgentSessionId,
  rebuildConsumptionForTest,
  type DemoConsumptionOptions,
  type DemoWorkspaceConsumption,
} from './consumption';
