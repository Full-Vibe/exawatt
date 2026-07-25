/**
 * Source adapters. Discovery + framing + incremental watermarks; all parsing
 * delegates to the pure parsers.
 */
import { splitCompleteLines } from './lines';
import { mergeSamples } from './merge';
import { parseClaudeTranscript } from './parse-claude';
import {
  emptyCodexContext,
  latestPlanWindows,
  parseCodexRollout,
  type CodexSessionContext,
} from './parse-codex';
import type {
  ConsumptionFileRef,
  ConsumptionFileSystem,
  ConsumptionScanOptions,
  ConsumptionSourceAdapter,
  ConsumptionSourceScan,
  ConsumptionWatermark,
  ConsumptionWatermarks,
} from './ports';
import {
  addDiagnostics,
  emptyDiagnostics,
  type ConsumptionDiagnostics,
  type ConsumptionSample,
  type PlanWindow,
} from './types';

function selectFiles(
  files: ConsumptionFileRef[],
  options: ConsumptionScanOptions
): ConsumptionFileRef[] {
  // Both harnesses write sidecar files (`sessions-index.json`,
  // `agent-*.meta.json`) into the same trees. Only transcripts are parsed here.
  let selected = files.filter(file => file.path.endsWith('.jsonl'));
  if (options.sinceMs) {
    selected = selected.filter(file => file.mtimeMs >= options.sinceMs!);
  }
  selected = [...selected].sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (options.maxFiles && options.maxFiles > 0) {
    selected = selected.slice(0, options.maxFiles);
  }
  return selected;
}

/**
 * Decide where to resume reading a file.
 *
 * A file that shrank, or whose mtime moved backwards, was rotated or replaced —
 * the old watermark is meaningless and the file is re-read from zero. A file
 * whose size and mtime are unchanged has nothing new and is skipped entirely,
 * which is what makes a warm scan cheap.
 */
function resumePoint(
  file: ConsumptionFileRef,
  watermark: ConsumptionWatermark | undefined
): { fromByte: number; skip: boolean; carry: unknown } {
  if (!watermark) return { fromByte: 0, skip: false, carry: undefined };
  if (file.size < watermark.consumedBytes || file.mtimeMs < watermark.mtimeMs) {
    return { fromByte: 0, skip: false, carry: undefined };
  }
  if (file.size === watermark.size && file.mtimeMs === watermark.mtimeMs) {
    return { fromByte: watermark.consumedBytes, skip: true, carry: watermark.sessionContext };
  }
  return {
    fromByte: watermark.consumedBytes,
    skip: false,
    carry: watermark.sessionContext,
  };
}

const DEFAULT_CLAUDE_ROOT = '~/.claude/projects';
const DEFAULT_CODEX_ROOT = '~/.codex/sessions';

/**
 * Claude Code.
 *
 * Reads BOTH the top-level `<slug>/<sessionId>.jsonl` transcripts and the
 * nested `<slug>/<sessionId>/subagents/**\/agent-*.jsonl` transcripts. The
 * nested files hold 39% of all usage records in the operator's real corpus;
 * omitting them under-reports consumption by that much.
 */
export class ClaudeConsumptionAdapter implements ConsumptionSourceAdapter {
  readonly source = 'claude-code' as const;

  constructor(
    readonly root: string = DEFAULT_CLAUDE_ROOT,
    /**
     * Read the `agent-<agentId>.meta.json` beside each delegated transcript.
     * It only adds `spawnDepth` and `parentAgentId` (agentType already arrives
     * on the transcript line), so a caller that wants a cheaper scan can turn it
     * off and accept `spawnDepth: null`.
     */
    private readonly readDelegationMeta = true
  ) {}

  private metaCache = new Map<string, Record<string, unknown> | null>();

  private async delegationMeta(
    fs: ConsumptionFileSystem,
    transcriptPath: string
  ): Promise<Record<string, unknown> | null> {
    if (!this.readDelegationMeta) return null;
    if (!/[/\\]subagents[/\\]/.test(transcriptPath)) return null;
    const metaPath = transcriptPath.replace(/\.jsonl$/, '.meta.json');
    const cached = this.metaCache.get(metaPath);
    if (cached !== undefined) return cached;
    const chunk = await fs.readFrom(metaPath, 0);
    let parsed: Record<string, unknown> | null = null;
    if (chunk && chunk.text.trim().length > 0) {
      try {
        const value: unknown = JSON.parse(chunk.text);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>;
        }
      } catch {
        // Spawn metadata is enrichment. A damaged one costs `spawnDepth`, not
        // the sample, and is counted as `delegationMetaMissing`.
      }
    }
    this.metaCache.set(metaPath, parsed);
    return parsed;
  }

  async scan(
    fs: ConsumptionFileSystem,
    options: ConsumptionScanOptions = {}
  ): Promise<ConsumptionSourceScan> {
    const diagnostics = emptyDiagnostics();
    const rawSamples: ConsumptionSample[] = [];
    const watermarks: ConsumptionWatermarks = {};

    const files = selectFiles(await fs.listFiles(this.root), options);
    for (const file of files) {
      diagnostics.filesSeen += 1;
      const previous = options.watermarks?.[file.path];
      const { fromByte, skip } = resumePoint(file, previous);
      if (skip) {
        watermarks[file.path] = previous!;
        continue;
      }
      const chunk = await fs.readFrom(file.path, fromByte);
      if (!chunk) {
        diagnostics.filesUnreadable += 1;
        if (previous) watermarks[file.path] = previous;
        continue;
      }
      diagnostics.bytesRead += Math.max(0, chunk.toByte - chunk.fromByte);
      const split = splitCompleteLines(chunk.text);
      if (split.truncatedTail) diagnostics.truncatedFinalLines += 1;
      const isDelegated = /[/\\]subagents[/\\]/.test(file.path);
      const meta = await this.delegationMeta(fs, file.path);
      if (isDelegated && !meta) diagnostics.delegationMetaMissing += 1;
      const parsed = parseClaudeTranscript(split.lines, {
        sourceFile: file.path,
        fallbackSessionId: sessionIdFromClaudePath(file.path),
        delegationMeta: meta,
      });
      rawSamples.push(...parsed.samples);
      mergeInto(diagnostics, parsed.diagnostics);
      watermarks[file.path] = {
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        consumedBytes: fromByte + split.consumedBytes,
      };
    }

    const merged = mergeSamples(rawSamples);
    diagnostics.duplicatesMerged += merged.duplicatesMerged;
    diagnostics.samplesEmitted = merged.samples.length;
    return {
      samples: merged.samples,
      planWindows: [],
      diagnostics,
      watermarks,
    };
  }
}

/**
 * Codex.
 *
 * Session context (cwd, session id, model) is established by the rollout's
 * first lines and carried in the watermark, so a tail-only incremental read
 * still attributes correctly.
 */
export class CodexConsumptionAdapter implements ConsumptionSourceAdapter {
  readonly source = 'codex' as const;

  constructor(readonly root: string = DEFAULT_CODEX_ROOT) {}

  async scan(
    fs: ConsumptionFileSystem,
    options: ConsumptionScanOptions = {}
  ): Promise<ConsumptionSourceScan> {
    const diagnostics = emptyDiagnostics();
    const rawSamples: ConsumptionSample[] = [];
    const planWindows: PlanWindow[] = [];
    const watermarks: ConsumptionWatermarks = {};

    const files = selectFiles(await fs.listFiles(this.root), options);
    for (const file of files) {
      diagnostics.filesSeen += 1;
      const previous = options.watermarks?.[file.path];
      const { fromByte, skip, carry } = resumePoint(file, previous);
      if (skip) {
        watermarks[file.path] = previous!;
        continue;
      }
      const chunk = await fs.readFrom(file.path, fromByte);
      if (!chunk) {
        diagnostics.filesUnreadable += 1;
        if (previous) watermarks[file.path] = previous;
        continue;
      }
      diagnostics.bytesRead += Math.max(0, chunk.toByte - chunk.fromByte);
      const split = splitCompleteLines(chunk.text);
      if (split.truncatedTail) diagnostics.truncatedFinalLines += 1;
      const parsed = parseCodexRollout(split.lines, {
        sourceFile: file.path,
        fallbackSessionId: sessionIdFromCodexPath(file.path),
        session: (carry as CodexSessionContext | undefined) ?? emptyCodexContext(),
      });
      rawSamples.push(...parsed.samples);
      planWindows.push(...parsed.planWindows);
      mergeInto(diagnostics, parsed.diagnostics);
      watermarks[file.path] = {
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        consumedBytes: fromByte + split.consumedBytes,
        sessionContext: parsed.session,
      };
    }

    const merged = mergeSamples(rawSamples);
    diagnostics.duplicatesMerged += merged.duplicatesMerged;
    diagnostics.samplesEmitted = merged.samples.length;
    const latest = latestPlanWindows(planWindows);
    diagnostics.planWindowsEmitted = latest.length;
    return {
      samples: merged.samples,
      planWindows: latest,
      diagnostics,
      watermarks,
    };
  }
}

function mergeInto(
  target: ConsumptionDiagnostics,
  source: ConsumptionDiagnostics
): void {
  const merged = addDiagnostics(target, source);
  for (const key of Object.keys(merged) as Array<
    keyof ConsumptionDiagnostics
  >) {
    target[key] = merged[key];
  }
}

/** `<slug>/<sessionId>.jsonl` or `<slug>/<sessionId>/subagents/...`. */
export function sessionIdFromClaudePath(path: string): string | null {
  const segments = path.split(/[/\\]/).filter(Boolean);
  const subagentsAt = segments.lastIndexOf('subagents');
  if (subagentsAt > 0) return segments[subagentsAt - 1] ?? null;
  const file = segments[segments.length - 1] ?? '';
  return file.endsWith('.jsonl') ? file.slice(0, -'.jsonl'.length) : null;
}

/** `rollout-2026-07-24T12-04-51-<uuid>.jsonl`. */
export function sessionIdFromCodexPath(path: string): string | null {
  const file = (path.split(/[/\\]/).pop() ?? '').replace(/\.jsonl$/, '');
  const match = /rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)$/.exec(file);
  return match?.[1] ?? null;
}
