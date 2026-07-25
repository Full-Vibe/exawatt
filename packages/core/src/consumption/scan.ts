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
  diagnostics: ConsumptionDiagnostics;
  perSource: Record<string, ConsumptionDiagnostics>;
  watermarks: ConsumptionWatermarks;
  /** Sources that reported zero files. Explicit absence, not silent zero. */
  emptySources: ConsumptionSourceId[];
}

export async function scanConsumption(
  adapters: readonly ConsumptionSourceAdapter[],
  fs: ConsumptionFileSystem,
  options: ConsumptionScanOptions = {}
): Promise<ConsumptionScan> {
  const rawSamples: ConsumptionSample[] = [];
  const planWindows: PlanWindow[] = [];
  const perSource: Record<string, ConsumptionDiagnostics> = {};
  const watermarks: ConsumptionWatermarks = {};
  const emptySources: ConsumptionSourceId[] = [];
  let diagnostics = emptyDiagnostics();

  const results = await Promise.all(
    adapters.map(async adapter => ({
      adapter,
      result: await adapter.scan(fs, options),
    }))
  );

  for (const { adapter, result } of results) {
    rawSamples.push(...result.samples);
    planWindows.push(...result.planWindows);
    perSource[adapter.source] = result.diagnostics;
    diagnostics = addDiagnostics(diagnostics, result.diagnostics);
    Object.assign(watermarks, result.watermarks);
    if (result.diagnostics.filesSeen === 0) emptySources.push(adapter.source);
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
    diagnostics,
    perSource,
    watermarks,
    emptySources,
  };
}
