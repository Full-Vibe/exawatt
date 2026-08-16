/**
 * Multi-source scan orchestration. Pure with respect to IO — the filesystem is
 * the injected port, so Demo Mode serves the identical code path.
 */
import { mergeSamples } from './merge';
import { latestPlanWindows } from './parse-codex';
import type {
  ConsumptionFileSystem,
  ConsumptionScanOptions,
  ConsumptionSourceAdapter,
  ConsumptionWatermarks,
} from './ports';
import {
  addDiagnostics,
  emptyDiagnostics,
  type ConsumptionDiagnostics,
  type ConsumptionSample,
  type ConsumptionSourceId,
  type PlanWindow,
} from './types';

export interface ConsumptionScan {
  samples: ConsumptionSample[];
  planWindows: PlanWindow[];
  /** Uncollapsed plan-window observations, for pace history. */
  windowObservations: PlanWindow[];
  diagnostics: ConsumptionDiagnostics;
  perSource: Record<string, ConsumptionDiagnostics>;
  watermarks: ConsumptionWatermarks;
  /** Sources that reported zero files. Explicit absence, not silent zero. */
  emptySources: ConsumptionSourceId[];
  /** Any adapter's pass was aborted; results are valid but partial. */
  aborted: boolean;
}

export async function scanConsumption(
  adapters: readonly ConsumptionSourceAdapter[],
  fs: ConsumptionFileSystem,
  options: ConsumptionScanOptions = {}
): Promise<ConsumptionScan> {
  const rawSamples: ConsumptionSample[] = [];
  const planWindows: PlanWindow[] = [];
  const windowObservations: PlanWindow[] = [];
  const perSource: Record<string, ConsumptionDiagnostics> = {};
  const watermarks: ConsumptionWatermarks = {};
  const emptySources: ConsumptionSourceId[] = [];
  let diagnostics = emptyDiagnostics();
  let aborted = false;

  const results = await Promise.all(
    adapters.map(async adapter => ({
      adapter,
      result: await adapter.scan(fs, options),
    }))
  );

  for (const { adapter, result } of results) {
    // Corpus arrays can exceed V8's function-argument ceiling. Iteration is
    // linear and heap-stable; spreading a real Codex observation history here
    // used to throw `Maximum call stack size exceeded`.
    for (const sample of result.samples) rawSamples.push(sample);
    for (const window of result.planWindows) planWindows.push(window);
    for (const observation of result.windowObservations) {
      windowObservations.push(observation);
    }
    perSource[adapter.source] = result.diagnostics;
    diagnostics = addDiagnostics(diagnostics, result.diagnostics);
    Object.assign(watermarks, result.watermarks);
    if (result.diagnostics.filesSeen === 0) emptySources.push(adapter.source);
    if (result.aborted) aborted = true;
  }

  // Cross-source merge. Claude `requestId`s span parent and subagent
  // transcripts (397 requests do so in the real corpus), so the merge has to be
  // corpus-global rather than per-file or per-adapter.
  const merged = mergeSamples(rawSamples);
  diagnostics.duplicatesMerged += merged.duplicatesMerged;
  diagnostics.samplesEmitted = merged.samples.length;

  const windows = latestPlanWindows(planWindows);
  diagnostics.planWindowsEmitted = windows.length;

  merged.samples.sort((left, right) => (left.at < right.at ? -1 : 1));
  return {
    samples: merged.samples,
    planWindows: windows,
    windowObservations,
    diagnostics,
    perSource,
    watermarks,
    emptySources,
    aborted,
  };
}
