/**
 * Disk-backed last-known-good Agent Source observations (BUG-062 / BUG-082).
 *
 * The registry's in-process cache lasts five seconds, so any ⌘T more than
 * five seconds after the last one re-ran every login-shell probe before the
 * composer would paint a chip or enable Start: thirteen shells and four to
 * five seconds on the operator's machine, in front of a design partner. What
 * the probes answer changes on the order of days. So the last COMPLETE
 * observation of each source is remembered here, the composer paints from it
 * immediately with its honest age, and this process revalidates behind it.
 *
 * Only a complete observation is remembered: one whose every probe answered
 * and whose state is a claim (`agentSourceObservationComplete`). A probe that
 * timed out writes nothing, so the memory stays what it was and ages, which
 * is exactly what "stale" means. Simulated sources are not remembered; they
 * cost nothing to produce.
 *
 * ## Size class (decision `0039`)
 *
 * - shape: one row per adapter id, keyed by adapter id;
 * - bound: at most one row per declared adapter (`AGENT_SOURCE_ADAPTER_IDS`),
 *   each no older than `OBSERVATION_MAX_AGE_MS` behind the NEWEST row
 *   (anchored on the data, not the clock), and every row observed through the
 *   same login shell as the newest write, because a shell change changes the
 *   PATH the facts were read from;
 * - future tolerance (decision `0039` amendment, BUG-182): the anchor is the
 *   newest row clamped to wall time plus a day (`retentionAnchorMs`, the
 *   rule consumption samples use), so one row stamped by a fast clock cannot
 *   evict the others; a row stamped past that is itself evicted, and a row
 *   stamped ahead of wall time never refuses a real observation;
 * - eviction owner: `AgentSourceObservationStore.remember` at every write,
 *   plus one sweep when the file is first loaded.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  AGENT_SOURCE_ADAPTER_IDS,
  agentSourceObservationComplete,
  retentionAnchorMs,
  type AgentSourceAdapterId,
  type AgentSourceSnapshot,
} from '@exawatt/core';

/** A memory older than this behind the newest one is not worth painting. */
export const OBSERVATION_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const STORE_FILE = 'agent-source-observations.json';
const SCHEMA_VERSION = 1;

interface ObservationRow {
  /** The login shell the facts were read through. */
  shell: string;
  observedAt: number;
  snapshot: AgentSourceSnapshot;
}

interface ObservationFile {
  schemaVersion: number;
  rows: Partial<Record<AgentSourceAdapterId, ObservationRow>>;
}

function emptyFile(): ObservationFile {
  return { schemaVersion: SCHEMA_VERSION, rows: {} };
}

function isAdapterId(value: unknown): value is AgentSourceAdapterId {
  return (
    typeof value === 'string' &&
    (AGENT_SOURCE_ADAPTER_IDS as readonly string[]).includes(value)
  );
}

function validSnapshot(value: unknown): value is AgentSourceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<AgentSourceSnapshot>;
  return (
    isAdapterId(snapshot.adapterId) &&
    typeof snapshot.id === 'string' &&
    typeof snapshot.state === 'string' &&
    typeof snapshot.observedAt === 'number' &&
    Number.isFinite(snapshot.observedAt) &&
    Array.isArray(snapshot.unobservedProbes) &&
    snapshot.observation !== undefined &&
    snapshot.facts !== undefined &&
    snapshot.actions !== undefined
  );
}

function parseFile(raw: unknown): ObservationFile {
  if (!raw || typeof raw !== 'object') return emptyFile();
  const candidate = raw as Partial<ObservationFile>;
  if (candidate.schemaVersion !== SCHEMA_VERSION) return emptyFile();
  if (!candidate.rows || typeof candidate.rows !== 'object') {
    return emptyFile();
  }
  const rows: ObservationFile['rows'] = {};
  for (const [key, value] of Object.entries(candidate.rows)) {
    if (!isAdapterId(key) || !value || typeof value !== 'object') continue;
    const row = value as Partial<ObservationRow>;
    if (
      typeof row.shell !== 'string' ||
      typeof row.observedAt !== 'number' ||
      !Number.isFinite(row.observedAt) ||
      !validSnapshot(row.snapshot) ||
      row.snapshot.adapterId !== key
    ) {
      continue;
    }
    rows[key] = {
      shell: row.shell,
      observedAt: row.observedAt,
      snapshot: row.snapshot,
    };
  }
  return { schemaVersion: SCHEMA_VERSION, rows };
}

/**
 * The eviction owner. Pure over a parsed file so the bound is testable
 * without a disk, and called from every path that WRITES the file.
 *
 * `nowMs` is read at every call, never captured: it only bounds how far
 * ahead of wall time the newest row may move the anchor.
 *
 * Returns how many rows were removed.
 */
export function evictObservationRows(
  file: ObservationFile,
  options: { shell: string | null; nowMs: number; maxAgeMs?: number }
): number {
  const maxAgeMs = options.maxAgeMs ?? OBSERVATION_MAX_AGE_MS;
  let removed = 0;
  const rows = Object.entries(file.rows) as Array<
    [AgentSourceAdapterId, ObservationRow]
  >;
  const anchor = retentionAnchorMs(
    rows.reduce((max, [, row]) => Math.max(max, row.observedAt), 0),
    options.nowMs
  );
  for (const [key, row] of rows) {
    // Negative only for a row stamped past the tolerance: a memory that
    // cannot be dated honestly is not worth painting.
    const behind = anchor - row.observedAt;
    if (
      (options.shell !== null && row.shell !== options.shell) ||
      behind > maxAgeMs ||
      behind < 0
    ) {
      delete file.rows[key];
      removed += 1;
    }
  }
  return removed;
}

export class AgentSourceObservationStore {
  private file: ObservationFile | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly directory: () => string,
    private readonly now: () => number = () => Date.now()
  ) {}

  private filePath(): string {
    return path.join(this.directory(), STORE_FILE);
  }

  private async load(): Promise<ObservationFile> {
    if (this.file) return this.file;
    let onDiskVersion: unknown;
    try {
      const raw = await fs.promises.readFile(this.filePath(), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      onDiskVersion = (parsed as { schemaVersion?: unknown })?.schemaVersion;
      this.file = parseFile(parsed);
    } catch {
      // No memory yet, or an unreadable one. Either way we start clean.
      this.file = emptyFile();
      return this.file;
    }
    // Reclaim under the bound on first touch, before any probe has run.
    const removed = evictObservationRows(this.file, {
      shell: null,
      nowMs: this.now(),
    });
    if (removed > 0 || onDiskVersion !== SCHEMA_VERSION) {
      await this.persist(this.file);
    }
    return this.file;
  }

  /**
   * Every remembered observation read through `shell`. A row read through a
   * different shell is not painted: its PATH is not this PATH.
   */
  async read(
    shell: string
  ): Promise<Map<AgentSourceAdapterId, AgentSourceSnapshot>> {
    const file = await this.load();
    const remembered = new Map<AgentSourceAdapterId, AgentSourceSnapshot>();
    for (const [key, row] of Object.entries(file.rows) as Array<
      [AgentSourceAdapterId, ObservationRow]
    >) {
      if (row.shell === shell) remembered.set(key, row.snapshot);
    }
    return remembered;
  }

  /** Remember a complete live observation. Anything else writes nothing. */
  async remember(shell: string, snapshot: AgentSourceSnapshot): Promise<void> {
    if (
      snapshot.observation.origin !== 'live' ||
      snapshot.adapterId === 'demo' ||
      !agentSourceObservationComplete(snapshot)
    ) {
      return;
    }
    const file = await this.load();
    const now = this.now();
    const current = file.rows[snapshot.adapterId];
    // Only a genuinely newer row refuses: two probes of this process that
    // finished out of order. A row stamped ahead of wall time is not newer,
    // it is misdated, and holding it would pin the memory until the clock
    // caught up (BUG-182).
    if (
      current &&
      current.observedAt > snapshot.observedAt &&
      current.observedAt <= now
    ) {
      return;
    }
    file.rows[snapshot.adapterId] = {
      shell,
      observedAt: snapshot.observedAt,
      snapshot,
    };
    evictObservationRows(file, { shell, nowMs: now });
    await this.persist(file);
  }

  /** How many rows the store currently holds. Diagnostics and tests. */
  async size(): Promise<number> {
    return Object.keys((await this.load()).rows).length;
  }

  private persist(file: ObservationFile): Promise<void> {
    const snapshot = JSON.stringify(file);
    const target = this.filePath();
    // Serialize writes and land them atomically: two registry reads finishing
    // together must not interleave into a truncated file.
    this.writing = this.writing.then(async () => {
      const temporary = `${target}.${process.pid}.tmp`;
      try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(temporary, snapshot, 'utf8');
        await fs.promises.rename(temporary, target);
      } catch {
        // A memory that cannot be persisted is a slower next launch, not a
        // broken one. The in-memory copy still serves this process.
        try {
          await fs.promises.unlink(temporary);
        } catch {
          // Nothing to clean up.
        }
      }
    });
    return this.writing;
  }
}
