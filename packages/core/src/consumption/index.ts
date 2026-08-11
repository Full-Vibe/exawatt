/**
 * Consumption (ENG-008) — read-only local parse over harness logs.
 *
 * Pure TypeScript. The Node filesystem implementation lives in `./node-fs` and
 * is exported from `@exawatt/core/server` only.
 */
export * from './types';
export {
  localLogAssurance,
  planWindowAssurance,
  intersectAssurance,
  assuranceLevel,
} from './assurance';
export {
  MODEL_WEIGHTS,
  FALLBACK_WEIGHT,
  TIER_INPUT_WEIGHT,
  DECODE_MULTIPLIER,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  resolveModelWeight,
  weightUsage,
} from './model-weights';
export type { ModelTier, ModelWeight, ResolvedModelWeight } from './model-weights';
export {
  splitCompleteLines,
  parseJsonObject,
  toIso,
} from './lines';
export type { LineSplit } from './lines';
export {
  mergeSamples,
  maxUsage,
  addUsage,
  subtractUsage,
  totalTokens,
} from './merge';
export type { MergeResult } from './merge';
export { parseClaudeTranscript } from './parse-claude';
export type {
  ClaudeParseContext,
  ClaudeParseResult,
  ClaudeDelegationMeta,
} from './parse-claude';
export {
  parseCodexRollout,
  emptyCodexContext,
  latestPlanWindows,
  CODEX_PLAN_WINDOW_ASSURANCE,
} from './parse-codex';
export type {
  CodexParseContext,
  CodexParseResult,
  CodexSessionContext,
} from './parse-codex';
export {
  rollupBy,
  rollupBySession,
  rollupByProject,
  rollupByDay,
  rollupByModel,
  rollupBySource,
  rollupByRoadmapItem,
  rollupWorkspace,
  directoryProjectResolver,
  ownTotals,
  ownWeightedTokens,
  SUPPORTED_ROLLUP_KINDS,
} from './rollup';
export type { ProjectResolver, RollupOptions, RollupResult } from './rollup';
export {
  ClaudeConsumptionAdapter,
  CodexConsumptionAdapter,
  sessionIdFromClaudePath,
  sessionIdFromCodexPath,
} from './adapters';
export type {
  ConsumptionChunk,
  ConsumptionFileRef,
  ConsumptionFileSystem,
  ConsumptionScanOptions,
  ConsumptionSourceAdapter,
  ConsumptionSourceScan,
  ConsumptionWatermark,
  ConsumptionWatermarks,
} from './ports';
export { scanConsumption } from './scan';
export type { ConsumptionScan } from './scan';
export {
  LIVE_CONSUMPTION_SNAPSHOT_VERSION,
  emptyLiveConsumptionSnapshot,
  idleScanState,
} from './live-snapshot';
export type {
  ConsumptionScanPhase,
  ConsumptionScanProgress,
  ConsumptionScanState,
  ConsumptionUpdatedEvent,
  LiveConsumptionSnapshot,
  LiveConsumptionSnapshotRequest,
  LiveSessionIdentityLink,
  PlanWindowObservation,
} from './live-snapshot';
