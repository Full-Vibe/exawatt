/**
 * Disk-backed model-catalog cache (ENG-016 D49).
 *
 * Every composer entry re-probed every installed engine: three login shells,
 * three CLI launches, seconds of latency, on a surface whose whole point is
 * being fast (operator, 2026-08-04 — "these tend to load every single time").
 * The in-memory caches that already existed died with the process, so a
 * restart and often a plain remount paid the full cost again.
 *
 * The policy is stale-while-revalidate, which is what the data actually
 * deserves: installed engines and their model lists change on the order of
 * days, but they DO change, so a cache that never refreshes would be its own
 * bug. A cached catalog is served immediately and marked `cachedAt`; anything
 * older than the freshness window is re-probed in the background and written
 * back. The caller decides what to do with a changed result — the launcher
 * deliberately does NOT reorder under a pointer, so a background refresh
 * lands on the next composer entry.
 *
 * Only a `live-catalog` observation is retained. A probe that failed or
 * returned nothing must stay retryable rather than freeze a degraded view.
 *
 * ## Size class (BUG-033)
 *
 * Staleness used to be a DISPLAY question only: `read()` refused an entry past
 * `CATALOG_MAX_AGE_MS` and left the row on disk forever, `write()` re-
 * serialized the whole file on every refresh, and `clear()` had zero callers.
 * Nothing owned removal, so the file was append-only for the life of the
 * install — 836 KB on the operator's machine, dominated by opencode's 446-
 * model catalog at ~126 KB per (engine, shell, cwd).
 *
 * The key includes `cwd`, and `AGENTS.md` mandates a fresh sibling worktree
 * per agent task, so every landed task mints permanent rows for a directory
 * that is deleted minutes later. The bound is therefore stated and enforced
 * at the WRITE:
 *
 * - an entry older than `CATALOG_MAX_AGE_MS` is deleted, not just refused;
 * - an entry whose `cwd` no longer exists is deleted — this is the retired
 *   worktree, and the only signal that says so;
 * - what remains is trimmed to the newest `CATALOG_MAX_ENTRIES`.
 *
 * The same sweep runs once when the file is loaded, so an install that
 * accumulated rows under the old shape reclaims them without waiting for a
 * probe.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentModelCatalog } from './agent-models';

/**
 * Cached catalogs render immediately, but demand a new source observation
 * after five minutes. Model rollouts can change within a working session, so
 * a multi-hour no-probe window leaves newly available models undiscoverable.
 */
export const CATALOG_FRESH_MS = 5 * 60_000;
/** Past this, a cached catalog is too old to show at all and we wait. */
export const CATALOG_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
/**
 * Retained rows, newest first. A working set of roughly sixteen Projects
 * across every installed engine; beyond that the oldest row is a directory
 * the operator has not opened in weeks.
 */
export const CATALOG_MAX_ENTRIES = 48;
const CACHE_FILE = 'agent-model-catalogs.json';
const SCHEMA_VERSION = 2;
const KEY_SEPARATOR = '\0';

interface CatalogCacheEntry {
  cachedAt: number;
  /**
   * The resolved working directory this catalog was probed in. Stored rather
   * than re-parsed out of the key so eviction can ask the filesystem whether
   * the directory still exists without knowing the key's grammar.
   */
  cwd: string;
  catalog: AgentModelCatalog;
}

interface CatalogCacheFile {
  schemaVersion: number;
  entries: Record<string, CatalogCacheEntry>;
}

export function catalogCacheKey(
  harness: string,
  cwd: string,
  shell: string
): string {
  return [harness, shell, path.resolve(cwd)].join(KEY_SEPARATOR);
}

/** The `cwd` a v1 key encoded. v1 rows carried no explicit `cwd` field. */
function cwdFromKey(key: string): string | null {
  const parts = key.split(KEY_SEPARATOR);
  if (parts.length < 3) return null;
  return parts[parts.length - 1] || null;
}

function emptyFile(): CatalogCacheFile {
  return { schemaVersion: SCHEMA_VERSION, entries: {} };
}

function validCatalog(value: unknown): value is AgentModelCatalog {
  // A cached catalog must still be a catalog. Anything else is discarded
  // rather than handed to the UI as truth.
  if (!value || typeof value !== 'object') return false;
  const catalog = value as AgentModelCatalog;
  return typeof catalog.harness === 'string' && Array.isArray(catalog.models);
}

/** Observation metadata does not make two catalogs meaningfully different. */
function semanticCatalog(catalog: AgentModelCatalog): unknown {
  const {
    observedAt: _observedAt,
    servedFromCache: _servedFromCache,
    catalogProvenance: _catalogProvenance,
    ...semantic
  } = catalog;
  return semantic;
}

function sameSemanticCatalog(
  left: AgentModelCatalog,
  right: AgentModelCatalog
): boolean {
  return (
    JSON.stringify(semanticCatalog(left)) ===
    JSON.stringify(semanticCatalog(right))
  );
}

function parseCacheFile(raw: unknown): CatalogCacheFile {
  if (!raw || typeof raw !== 'object') return emptyFile();
  const candidate = raw as Partial<CatalogCacheFile>;
  // v1 rows are identical apart from a missing `cwd`, which the key carries.
  // Migrating them keeps a working install's cache instead of forcing a cold
  // re-probe of every engine on the first composer entry after an update.
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2) {
    return emptyFile();
  }
  if (!candidate.entries || typeof candidate.entries !== 'object') {
    return emptyFile();
  }
  const entries: Record<string, CatalogCacheEntry> = {};
  for (const [key, value] of Object.entries(candidate.entries)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Partial<CatalogCacheEntry>;
    if (
      typeof entry.cachedAt !== 'number' ||
      !Number.isFinite(entry.cachedAt)
    ) {
      continue;
    }
    if (!validCatalog(entry.catalog)) continue;
    const cwd =
      typeof entry.cwd === 'string' && entry.cwd ? entry.cwd : cwdFromKey(key);
    if (!cwd) continue;
    entries[key] = { cachedAt: entry.cachedAt, cwd, catalog: entry.catalog };
  }
  return { schemaVersion: SCHEMA_VERSION, entries };
}

export interface CatalogEvictionOptions {
  now: number;
  /** Test seam for the retired-worktree probe. */
  directoryExists: (cwd: string) => boolean;
  maxEntries?: number;
  maxAgeMs?: number;
}

/**
 * The eviction owner. Pure over a parsed file so the bound is testable
 * without a disk, and called from every path that WRITES the file.
 *
 * Returns how many rows were removed.
 */
export function evictCatalogEntries(
  file: CatalogCacheFile,
  options: CatalogEvictionOptions
): number {
  const maxEntries = options.maxEntries ?? CATALOG_MAX_ENTRIES;
  const maxAgeMs = options.maxAgeMs ?? CATALOG_MAX_AGE_MS;
  let removed = 0;
  for (const [key, entry] of Object.entries(file.entries)) {
    const age = options.now - entry.cachedAt;
    if (age > maxAgeMs || age < 0 || !options.directoryExists(entry.cwd)) {
      delete file.entries[key];
      removed += 1;
    }
  }
  const surviving = Object.entries(file.entries).sort(
    (left, right) => right[1].cachedAt - left[1].cachedAt
  );
  for (const [key] of surviving.slice(maxEntries)) {
    delete file.entries[key];
    removed += 1;
  }
  return removed;
}

function directoryExists(cwd: string): boolean {
  try {
    return fs.statSync(cwd).isDirectory();
  } catch {
    return false;
  }
}

export class AgentModelCatalogCache {
  private file: CatalogCacheFile | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly observationGenerations = new Map<string, number>();

  constructor(
    private readonly directory: () => string,
    private readonly now: () => number = () => Date.now(),
    private readonly exists: (cwd: string) => boolean = directoryExists
  ) {}

  private filePath(): string {
    return path.join(this.directory(), CACHE_FILE);
  }

  private async load(): Promise<CatalogCacheFile> {
    if (this.file) return this.file;
    let onDiskVersion: unknown;
    try {
      const raw = await fs.promises.readFile(this.filePath(), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      onDiskVersion = (parsed as { schemaVersion?: unknown })?.schemaVersion;
      this.file = parseCacheFile(parsed);
    } catch {
      // No cache yet, or an unreadable one. Either way we start clean.
      this.file = emptyFile();
      return this.file;
    }
    // Reclaim under the bound on first touch: an install carrying rows from
    // before this bound existed should not have to wait for a probe.
    const removed = evictCatalogEntries(this.file, {
      now: this.now(),
      directoryExists: this.exists,
    });
    if (removed > 0 || onDiskVersion !== SCHEMA_VERSION) {
      await this.persist(this.file);
    }
    return this.file;
  }

  /** The cached catalog, plus whether it is fresh enough to skip a probe. */
  async read(
    key: string
  ): Promise<{ catalog: AgentModelCatalog; fresh: boolean } | null> {
    const file = await this.load();
    const entry = file.entries[key];
    if (!entry) return null;
    const age = this.now() - entry.cachedAt;
    if (age > CATALOG_MAX_AGE_MS || age < 0) return null;
    return { catalog: entry.catalog, fresh: age <= CATALOG_FRESH_MS };
  }

  /**
   * Token captured immediately before probing a source. If another context
   * discovers a semantic change while that probe is running, its token becomes
   * stale and the late result cannot recreate an invalidated sibling row.
   */
  captureObservationGeneration(harness: string): number {
    return this.observationGenerations.get(harness) ?? 0;
  }

  async write(
    key: string,
    cwd: string,
    catalog: AgentModelCatalog,
    observationGeneration?: number
  ): Promise<void> {
    if (catalog.catalogMode !== 'live-catalog') return;
    const file = await this.load();
    const currentGeneration = this.captureObservationGeneration(
      catalog.harness
    );
    if (
      observationGeneration !== undefined &&
      observationGeneration !== currentGeneration
    ) {
      return;
    }
    const previous = file.entries[key]?.catalog;
    if (previous && !sameSemanticCatalog(previous, catalog)) {
      // A real change observed in this exact Project is evidence that sibling
      // snapshots for the same source may now be stale. Remove them so each
      // Project re-probes its own context on demand. Never compare sibling
      // catalogs with one another: Project-local policy may legitimately make
      // them different, and cross-comparison would create invalidation ping-pong.
      for (const [siblingKey, entry] of Object.entries(file.entries)) {
        if (siblingKey !== key && entry.catalog.harness === catalog.harness) {
          delete file.entries[siblingKey];
        }
      }
      this.observationGenerations.set(catalog.harness, currentGeneration + 1);
    }
    file.entries[key] = {
      cachedAt: this.now(),
      cwd: path.resolve(cwd),
      catalog,
    };
    evictCatalogEntries(file, {
      now: this.now(),
      directoryExists: this.exists,
    });
    await this.persist(file);
  }

  /** How many rows the cache currently holds. Diagnostics and tests. */
  async size(): Promise<number> {
    return Object.keys((await this.load()).entries).length;
  }

  private persist(file: CatalogCacheFile): Promise<void> {
    const snapshot = JSON.stringify(file);
    const target = this.filePath();
    // Serialize writes and land them atomically: two Projects opening at once
    // must not interleave into a truncated file.
    this.writing = this.writing.then(async () => {
      const temporary = `${target}.${process.pid}.tmp`;
      try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(temporary, snapshot, 'utf8');
        await fs.promises.rename(temporary, target);
      } catch {
        // A cache that cannot be persisted is a slow launcher, not a broken
        // one. The in-memory copy still serves this session.
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
