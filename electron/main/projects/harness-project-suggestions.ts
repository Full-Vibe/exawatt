/**
 * Harness project suggestions (ENG-046 O1): the folders Claude Code, Codex
 * and Antigravity already work in, read from each harness's own store and
 * offered before any of them is an Exawatt Project.
 *
 * The contract (docs/engineering/projects/first-run-on-ramp.md):
 *
 * - Stores are read, never written. SQLite stores are read from a private
 *   copy (`readSqliteSnapshot`), because opening a WAL database in place
 *   writes beside it (BUG-287).
 * - Suggestions, not import. Nothing here creates a Project; opening a row
 *   goes through `projects:resolve` exactly as Browse does, and `path` is
 *   already the folder that call returns, because both use the one join rule
 *   (`joinProjectFolder`).
 * - Absence is not an answer. Every store reports `read`, `missing` (the
 *   harness never wrote it) or `unreadable` with a named reason; a store
 *   that could not be read never looks like a store with nothing in it.
 * - The filter is strict and explainable: exists; not the home directory,
 *   `Downloads`, a temporary path or anything under `Library`; a git
 *   repository or a folder carrying a project marker; not merely a non-git
 *   parent of other suggestions. Activity within 30 days is `recent`; older
 *   rows are kept for "Show older".
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  asConfigObject,
  describeUnreadableConfig,
  readConfigFile,
  withoutByteOrderMark,
  type ConfigFileGrammar,
  type ConfigFileRead,
} from '@exawatt/core/server';
import type {
  HarnessProjectEvidence,
  HarnessProjectStore,
  HarnessProjectSuggestion,
  HarnessStoreRead,
  ProjectSuggestionHarness,
  ProjectSuggestionsRequest,
  ProjectSuggestionsResult,
} from '@exawatt/core/desktop-bridge';
import { parseCodexConfigText } from '../pty/agent-models';
import {
  antigravityHome,
  antigravitySummariesFile,
  readAntigravityConversationSummaries,
} from '../pty/antigravity-source';
import {
  claudeConfigDir,
  codexHome,
  codexStateDatabase,
  datedEntries,
  newestFirst,
  readHead,
} from '../pty/conversation-catalog';
import {
  FOLD_WORKTREES,
  joinProjectFolder,
  type ProjectFolder,
} from '../pty/project-resolve';
import { readSqliteSnapshot } from '../pty/sqlite-snapshot';

/** ENG-046: activity older than this sits behind "Show older". */
export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The project doc's markers. A git repository needs none. */
const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
] as const;

/** Where a machine keeps scratch directories. `os.tmpdir()` is added. */
const TEMPORARY_ROOTS = [
  '/tmp',
  '/private/tmp',
  '/var/tmp',
  '/private/var/tmp',
  '/var/folders',
  '/private/var/folders',
] as const;

/** Bound on concurrent filesystem and git work per read. */
const CONCURRENCY = 8;
/** A transcript's own `cwd` sits in its first few records. */
const TRANSCRIPT_HEAD_BYTES = 256 * 1024;
/** Newest transcripts tried per Claude Code directory before giving up. */
const TRANSCRIPTS_PER_DIRECTORY = 3;
/** Newest Codex rollouts read when the state database is unavailable. */
const MAX_ROLLOUTS = 400;
const ROLLOUT_HEAD_BYTES = 64 * 1024;
/** Antigravity conversations consulted for activity. */
const MAX_ANTIGRAVITY_CONVERSATIONS = 500;
/** `~/.claude.json` grows with every directory Claude Code has run in. */
const CLAUDE_CONFIG_MAX_BYTES = 64 * 1024 * 1024;

const HARNESS_ORDER: readonly ProjectSuggestionHarness[] = [
  'claude',
  'codex',
  'antigravity',
];

export interface HarnessProjectSuggestionOptions {
  /** The environment the harnesses resolve their homes from. */
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: number;
  /** The two-way door (operator, 2026-10-15). Defaults to the product's. */
  foldWorktrees?: boolean;
  /** The join rule. Tests may wrap it; production never replaces it. */
  join?: typeof joinProjectFolder;
  /** Replaces the default temporary roots (tests build fixtures there). */
  temporaryRoots?: readonly string[];
}

export interface HarnessProjectSuggestions {
  suggestions: HarnessProjectSuggestion[];
  stores: HarnessStoreRead[];
  readAt: number;
}

interface ReadContext {
  env: NodeJS.ProcessEnv;
  home: string;
}

interface StoreOutcome {
  status: HarnessStoreRead['status'];
  reason?: string;
  evidence: HarnessProjectEvidence[];
}

interface StoreReader {
  harness: ProjectSuggestionHarness;
  store: HarnessProjectStore;
  read(context: ReadContext): Promise<StoreOutcome>;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

function isWithin(directory: string, root: string): boolean {
  if (directory === root) return true;
  const relative = path.relative(root, directory);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function errorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isMissingError(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** A reason an operator can act on. Never a file's text. */
function describeError(error: unknown): string {
  const code = errorCode(error);
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
  if (code) return `read failed (${code})`;
  return 'could not be read';
}

function missing(): StoreOutcome {
  return { status: 'missing', evidence: [] };
}

function unreadable(reason: string): StoreOutcome {
  return { status: 'unreadable', reason, evidence: [] };
}

function fromConfigRead<T>(
  read: ConfigFileRead<T>,
  evidence: (value: T) => StoreOutcome
): StoreOutcome {
  if (read.status === 'missing') return missing();
  if (read.status === 'unreadable') {
    return unreadable(describeUnreadableConfig(read.cause));
  }
  return evidence(read.value);
}

const JSON_OBJECT: ConfigFileGrammar<Record<string, unknown>> = {
  name: 'JSON',
  parse: text => asConfigObject(JSON.parse(withoutByteOrderMark(text))),
};

/** Epoch milliseconds from a store's number; seconds are scaled. */
function epochMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value < 100_000_000_000 ? value * 1000 : value;
}

function fileUriPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('file://')) return null;
  try {
    return fileURLToPath(value);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* One reader per store                                                       */
/* -------------------------------------------------------------------------- */

function claudeUserConfigFile({ env, home }: ReadContext): string {
  // With CLAUDE_CONFIG_DIR set, Claude Code keeps `.claude.json` inside it.
  return env.CLAUDE_CONFIG_DIR
    ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(home, '.claude.json');
}

const claudeConfigReader: StoreReader = {
  harness: 'claude',
  store: 'claude-code-config',
  async read(context) {
    const read = await readConfigFile(claudeUserConfigFile(context), {
      ...JSON_OBJECT,
      maxBytes: CLAUDE_CONFIG_MAX_BYTES,
    });
    return fromConfigRead(read, config => {
      const projects = config.projects;
      if (projects === undefined) return { status: 'read', evidence: [] };
      const map = asConfigObject(projects);
      if (!map) return unreadable('the projects entry is not a map');
      const evidence: HarnessProjectEvidence[] = [];
      for (const [directory, entry] of Object.entries(map)) {
        evidence.push({
          harness: 'claude',
          store: 'claude-code-config',
          directory,
          observedAt: epochMs(asConfigObject(entry)?.lastStartTime),
          label: null,
        });
      }
      return { status: 'read', evidence };
    });
  },
};

/** The transcript's own working directory, from its first complete records.
 *  The directory name is a lossy encoding and is never decoded. */
async function transcriptCwd(file: string): Promise<string | null> {
  const head = await readHead(file, TRANSCRIPT_HEAD_BYTES);
  for (const line of head.split('\n')) {
    if (!line.includes('"cwd"')) continue;
    try {
      const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd;
      if (typeof cwd === 'string' && path.isAbsolute(cwd)) return cwd;
    } catch {
      // A record cut by the head bound, or not JSON.
    }
  }
  return null;
}

const claudeTranscriptsReader: StoreReader = {
  harness: 'claude',
  store: 'claude-code-transcripts',
  async read({ env, home }) {
    const root = path.join(claudeConfigDir(env, home), 'projects');
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch (error) {
      return isMissingError(error)
        ? missing()
        : unreadable(describeError(error));
    }
    const directories = entries.filter(entry => entry.isDirectory());
    const found = await mapLimit(directories, CONCURRENCY, async entry => {
      let files;
      try {
        files = newestFirst(
          await datedEntries(path.join(root, entry.name), name =>
            name.endsWith('.jsonl') ? name : null
          )
        );
      } catch {
        return null;
      }
      for (const file of files.slice(0, TRANSCRIPTS_PER_DIRECTORY)) {
        const cwd = await transcriptCwd(file.file).catch(() => null);
        if (cwd) {
          return {
            harness: 'claude' as const,
            store: 'claude-code-transcripts' as const,
            directory: cwd,
            observedAt: files[0].mtimeMs,
            label: null,
          };
        }
      }
      return null;
    });
    return {
      status: 'read',
      evidence: found.filter(
        (item): item is NonNullable<typeof item> => item !== null
      ),
    };
  },
};

const codexConfigReader: StoreReader = {
  harness: 'codex',
  store: 'codex-config',
  async read({ env, home }) {
    const read = await readConfigFile(
      path.join(codexHome(env, home), 'config.toml'),
      { name: 'TOML', parse: parseCodexConfigText }
    );
    return fromConfigRead(read, config => {
      const projects = config.projects;
      if (projects === undefined) return { status: 'read', evidence: [] };
      const table = asConfigObject(projects);
      if (!table) return unreadable('the projects entry is not a table');
      return {
        status: 'read',
        evidence: Object.keys(table).map(directory => ({
          harness: 'codex' as const,
          store: 'codex-config' as const,
          directory,
          observedAt: null,
          label: null,
        })),
      };
    });
  },
};

function codexThreadEvidence(
  directory: string,
  observedAt: number | null
): HarnessProjectEvidence {
  return {
    harness: 'codex',
    store: 'codex-sessions',
    directory,
    observedAt,
    label: null,
  };
}

/** The newest rollout files, walking `YYYY/MM/DD` newest first. */
async function newestRollouts(root: string): Promise<string[]> {
  const files: string[] = [];
  const descend = async (directory: string, depth: number): Promise<void> => {
    if (files.length >= MAX_ROLLOUTS) return;
    let names: string[];
    try {
      names = await fs.promises.readdir(directory);
    } catch (error) {
      if (depth === 0) throw error;
      return;
    }
    names.sort().reverse();
    if (depth < 3) {
      for (const name of names) {
        if (files.length >= MAX_ROLLOUTS) return;
        if (/^\d+$/.test(name))
          await descend(path.join(directory, name), depth + 1);
      }
      return;
    }
    for (const name of names) {
      if (files.length >= MAX_ROLLOUTS) return;
      if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
        files.push(path.join(directory, name));
      }
    }
  };
  await descend(root, 0);
  return files;
}

/** `session_meta.payload.cwd` from a rollout's first line. The line also
 *  carries the base instructions and can exceed the head bound, so a cut
 *  line falls back to the first `"cwd"` field, which precedes them. */
async function rolloutCwd(file: string): Promise<string | null> {
  const head = await readHead(file, ROLLOUT_HEAD_BYTES);
  const line = head.split('\n', 1)[0] ?? '';
  try {
    const record = JSON.parse(line) as { payload?: { cwd?: unknown } };
    const cwd = record.payload?.cwd;
    if (typeof cwd === 'string' && path.isAbsolute(cwd)) return cwd;
  } catch {
    const match = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(line);
    if (match) {
      try {
        const cwd = JSON.parse(match[1]) as unknown;
        if (typeof cwd === 'string' && path.isAbsolute(cwd)) return cwd;
      } catch {
        // Not a JSON string.
      }
    }
  }
  return null;
}

async function readCodexRollouts(
  root: string
): Promise<HarnessProjectEvidence[]> {
  const files = await newestRollouts(root);
  const found = await mapLimit(files, CONCURRENCY, async file => {
    try {
      const [cwd, stat] = await Promise.all([
        rolloutCwd(file),
        fs.promises.stat(file),
      ]);
      return cwd ? codexThreadEvidence(cwd, stat.mtimeMs) : null;
    } catch {
      return null;
    }
  });
  return found.filter((item): item is HarnessProjectEvidence => item !== null);
}

const codexSessionsReader: StoreReader = {
  harness: 'codex',
  store: 'codex-sessions',
  async read({ env, home }) {
    const database = codexStateDatabase(env, home);
    if (fs.existsSync(database)) {
      try {
        const rows = readSqliteSnapshot(database, db =>
          db
            .prepare(
              'SELECT cwd, MAX(updated_at_ms) AS at FROM threads ' +
                'WHERE cwd IS NOT NULL GROUP BY cwd'
            )
            .all()
        ) as Array<Record<string, unknown>>;
        return {
          status: 'read',
          evidence: rows.flatMap(row =>
            typeof row.cwd === 'string' && row.cwd
              ? [codexThreadEvidence(row.cwd, epochMs(row.at))]
              : []
          ),
        };
      } catch {
        // A database Codex changed the shape of; its rollouts still say
        // where it ran.
      }
    }
    try {
      return {
        status: 'read',
        evidence: await readCodexRollouts(
          path.join(codexHome(env, home), 'sessions')
        ),
      };
    } catch (error) {
      return isMissingError(error)
        ? missing()
        : unreadable(describeError(error));
    }
  },
};

const antigravityProjectsReader: StoreReader = {
  harness: 'antigravity',
  store: 'antigravity-projects',
  async read({ home }) {
    // Antigravity's own project files. `~/.gemini/projects.json` and
    // `trustedFolders.json` belong to Gemini CLI and are never read here.
    const directory = path.join(home, '.gemini', 'config', 'projects');
    let names: string[];
    try {
      names = (await fs.promises.readdir(directory)).filter(name =>
        name.endsWith('.json')
      );
    } catch (error) {
      return isMissingError(error)
        ? missing()
        : unreadable(describeError(error));
    }
    const reads = await mapLimit(names, CONCURRENCY, name =>
      readConfigFile(path.join(directory, name), JSON_OBJECT)
    );
    const failed = reads.filter(read => read.status === 'unreadable');
    if (names.length > 0 && failed.length === names.length) {
      const first = failed[0];
      return unreadable(
        first.status === 'unreadable'
          ? describeUnreadableConfig(first.cause)
          : 'could not be read'
      );
    }
    const evidence: HarnessProjectEvidence[] = [];
    for (const read of reads) {
      if (read.status !== 'ok') continue;
      const name = read.value.name;
      const resources = asConfigObject(read.value.projectResources)?.resources;
      if (!Array.isArray(resources)) continue;
      for (const resource of resources) {
        const folder = fileUriPath(asConfigObject(resource)?.folderUri);
        if (!folder) continue;
        evidence.push({
          harness: 'antigravity',
          store: 'antigravity-projects',
          directory: folder,
          observedAt: null,
          label: typeof name === 'string' && name.trim() ? name.trim() : null,
        });
      }
    }
    return { status: 'read', evidence };
  },
};

const antigravityConversationsReader: StoreReader = {
  harness: 'antigravity',
  store: 'antigravity-conversations',
  async read({ home }) {
    const file = antigravitySummariesFile(antigravityHome(home));
    if (!fs.existsSync(file)) return missing();
    try {
      const summaries = readAntigravityConversationSummaries(
        file,
        MAX_ANTIGRAVITY_CONVERSATIONS
      );
      return {
        status: 'read',
        evidence: summaries.flatMap(summary =>
          summary.workspacePaths.map(directory => ({
            harness: 'antigravity' as const,
            store: 'antigravity-conversations' as const,
            directory,
            observedAt: summary.updatedAt,
            label: null,
          }))
        ),
      };
    } catch (error) {
      return unreadable(describeError(error));
    }
  },
};

const STORE_READERS: readonly StoreReader[] = [
  claudeConfigReader,
  claudeTranscriptsReader,
  codexConfigReader,
  codexSessionsReader,
  antigravityProjectsReader,
  antigravityConversationsReader,
];

/** One row per (store, directory), keeping the newest observation. */
function collapseEvidence(
  evidence: readonly HarnessProjectEvidence[]
): HarnessProjectEvidence[] {
  const byKey = new Map<string, HarnessProjectEvidence>();
  for (const item of evidence) {
    if (!path.isAbsolute(item.directory)) continue;
    const directory = path.resolve(item.directory);
    const key = `${item.store}\0${directory}`;
    const previous = byKey.get(key);
    if (
      !previous ||
      (item.observedAt ?? -Infinity) > (previous.observedAt ?? -Infinity)
    ) {
      byKey.set(key, {
        ...item,
        directory,
        label: item.label ?? previous?.label ?? null,
      });
    }
  }
  return [...byKey.values()];
}

/* -------------------------------------------------------------------------- */
/* The filter and the join                                                    */
/* -------------------------------------------------------------------------- */

interface Filter {
  home: string;
  temporaryRoots: readonly string[];
}

/** Home, Downloads, a temporary path, or anything under Library. */
function isExcludedDirectory(directory: string, filter: Filter): boolean {
  if (directory === filter.home) return true;
  if (directory === path.join(filter.home, 'Downloads')) return true;
  if (isWithin(directory, path.join(filter.home, 'Library'))) return true;
  return filter.temporaryRoots.some(root => isWithin(directory, root));
}

async function hasProjectMarker(directory: string): Promise<boolean> {
  try {
    const names = new Set(await fs.promises.readdir(directory));
    return PROJECT_MARKERS.some(marker => names.has(marker));
  } catch {
    return false;
  }
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function harnessOrder(
  evidence: readonly HarnessProjectEvidence[]
): ProjectSuggestionHarness[] {
  const newest = new Map<ProjectSuggestionHarness, number>();
  for (const item of evidence) {
    const at = item.observedAt ?? -Infinity;
    newest.set(
      item.harness,
      Math.max(newest.get(item.harness) ?? -Infinity, at)
    );
  }
  return [...newest.keys()].sort(
    (a, b) =>
      newest.get(b)! - newest.get(a)! ||
      HARNESS_ORDER.indexOf(a) - HARNESS_ORDER.indexOf(b)
  );
}

function rankSuggestions(
  a: HarnessProjectSuggestion,
  b: HarnessProjectSuggestion
): number {
  return (
    (b.lastActivityAt ?? -Infinity) - (a.lastActivityAt ?? -Infinity) ||
    a.name.localeCompare(b.name) ||
    a.path.localeCompare(b.path)
  );
}

/* -------------------------------------------------------------------------- */
/* The read                                                                   */
/* -------------------------------------------------------------------------- */

export async function readHarnessProjectSuggestions(
  options: HarnessProjectSuggestionOptions = {}
): Promise<HarnessProjectSuggestions> {
  const env = options.env ?? process.env;
  const home = path.resolve(options.home ?? os.homedir());
  const now = options.now ?? Date.now();
  const foldWorktrees = options.foldWorktrees ?? FOLD_WORKTREES;
  const join = options.join ?? joinProjectFolder;
  const filter: Filter = {
    home,
    temporaryRoots: options.temporaryRoots ?? [...TEMPORARY_ROOTS, os.tmpdir()],
  };

  const context: ReadContext = { env, home };
  const outcomes = await Promise.all(
    STORE_READERS.map(reader =>
      reader
        .read(context)
        .catch(error => unreadable(describeError(error)))
        .then(outcome => ({
          reader,
          outcome: {
            ...outcome,
            evidence: collapseEvidence(outcome.evidence),
          },
        }))
    )
  );
  const stores: HarnessStoreRead[] = outcomes.map(({ reader, outcome }) => ({
    harness: reader.harness,
    store: reader.store,
    status: outcome.status,
    entries: outcome.evidence.length,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  }));
  const evidence = outcomes.flatMap(({ outcome }) => outcome.evidence);

  // Each distinct directory is checked and joined once, however many stores
  // name it; excluded paths never reach git.
  const directories = [...new Set(evidence.map(item => item.directory))];
  const joined = new Map<string, ProjectFolder>();
  await mapLimit(directories, CONCURRENCY, async directory => {
    if (isExcludedDirectory(directory, filter)) return;
    if (!(await isDirectory(directory))) return;
    const folder = await join(directory, { foldWorktrees });
    if (isExcludedDirectory(folder.projectDir, filter)) return;
    if (
      folder.commonDir === null &&
      !(await hasProjectMarker(folder.projectDir))
    )
      return;
    joined.set(directory, folder);
  });

  const rows = new Map<
    string,
    { folder: ProjectFolder; evidence: HarnessProjectEvidence[] }
  >();
  for (const item of evidence) {
    const folder = joined.get(item.directory);
    if (!folder) continue;
    const row = rows.get(folder.projectDir) ?? { folder, evidence: [] };
    row.evidence.push(item);
    rows.set(folder.projectDir, row);
  }

  const folders = [...rows.keys()];
  const suggestions: HarnessProjectSuggestion[] = [];
  for (const { folder, evidence: rowEvidence } of rows.values()) {
    // A folder outside git that merely contains other suggestions is a
    // parent of projects, not one.
    if (
      folder.commonDir === null &&
      folders.some(
        other =>
          other !== folder.projectDir && isWithin(other, folder.projectDir)
      )
    ) {
      continue;
    }
    const times = rowEvidence
      .map(item => item.observedAt)
      .filter((at): at is number => at !== null);
    const lastActivityAt = times.length > 0 ? Math.max(...times) : null;
    suggestions.push({
      path: folder.projectDir,
      commonDir: folder.commonDir,
      name: folder.projectName,
      harnesses: harnessOrder(rowEvidence),
      lastActivityAt,
      recent:
        lastActivityAt !== null && now - lastActivityAt <= RECENT_WINDOW_MS,
      evidence: [...rowEvidence].sort(
        (a, b) =>
          (b.observedAt ?? -Infinity) - (a.observedAt ?? -Infinity) ||
          a.store.localeCompare(b.store)
      ),
    });
  }
  suggestions.sort(rankSuggestions);
  return { suggestions, stores, readAt: now };
}

/* -------------------------------------------------------------------------- */
/* The answer the IPC gives                                                   */
/* -------------------------------------------------------------------------- */

/** How long a read answers a plain request; a refresh always re-reads. */
export const SUGGESTIONS_FRESH_MS = 30_000;

/**
 * The stores are read when a surface asks and on an explicit refresh; nothing
 * watches them (decision 0013). Surfaces that open together (the Start screen
 * and the chooser) share one read, and a read in flight answers everyone,
 * a refresh included, because it is already fresh.
 */
export function createSuggestionsSource(
  read: () => Promise<HarnessProjectSuggestions> = () =>
    readHarnessProjectSuggestions(),
  clock: () => number = Date.now
): (request?: ProjectSuggestionsRequest) => Promise<ProjectSuggestionsResult> {
  let last: {
    at: number;
    settled: boolean;
    result: Promise<ProjectSuggestionsResult>;
  } | null = null;
  return request => {
    const now = clock();
    if (
      last &&
      (!last.settled ||
        (request?.refresh !== true && now - last.at < SUGGESTIONS_FRESH_MS))
    ) {
      return last.result;
    }
    const entry: NonNullable<typeof last> = {
      at: now,
      settled: false,
      result: read().then(
        value => ({ ok: true as const, ...value }),
        error => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        })
      ),
    };
    void entry.result.then(() => {
      entry.settled = true;
    });
    last = entry;
    return entry.result;
  };
}
