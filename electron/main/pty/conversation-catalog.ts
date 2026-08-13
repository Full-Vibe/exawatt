import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PtyHarness } from './session-manager';
import type { ClosedSessionEntry } from './closed-session-ledger';
import { listProjectWorktrees } from './project-resolve';
import {
  recordHostedCallHttpFailure,
  recordHostedCallTransportFailure,
} from '../analytics-bridge';
import {
  GROK_SESSION_FILES,
  decodeGrokCwdDirname,
  encodeGrokCwdDirname,
} from '@exawatt/core';

const execFileAsync = promisify(execFile);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export type ConversationHarness = Exclude<PtyHarness, 'shell'>;

export interface RecentConversation {
  id: string;
  harness: ConversationHarness;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  title: string;
  description: string | null;
  titleSource: 'native' | 'generated' | 'fallback';
  needsSummary: boolean;
  /** Exact provider identity when one is known. Kept separate from the row ID
   * because retained Exawatt Sessions may not have captured it yet. */
  providerSessionId: string | null;
  continuation:
    | { kind: 'provider' }
    | { kind: 'exawatt-session'; durableSessionId: string };
}

export interface ConversationDraft extends RecentConversation {
  fingerprint: string;
  summaryInput: string[];
  /** Exact provider identity when this adapter has one. Project Session rows
   * can be temporarily identity-less even when a matching harness file exists. */
  providerIdentity: string | null;
  /** Conservative secondary reconciliation key within one Project+harness. */
  correlationKey: string | null;
}

export interface ConversationCatalogAdapter {
  /** Sources served by this adapter. This is the registration seam for future
   * harnesses; Project Session history deliberately serves every launchable
   * Agent harness. */
  readonly harnesses: readonly ConversationHarness[];
  list(cwd: string): Promise<ConversationDraft[]>;
}

interface CachedSummary {
  fingerprint: string;
  title: string;
  description: string | null;
  storedAt: number;
}

interface SummaryResponse {
  conversations?: Array<{
    key?: unknown;
    title?: unknown;
    summary?: unknown;
  }>;
}

const MAX_LEGACY_METADATA_FILES = 1_000;
const MAX_PROJECT_RESULTS = 100;
const MAX_CACHED_SUMMARIES = 500;
const LIST_CACHE_TTL_MS = 10_000;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_PREFIX_BYTES = 2 * 1024 * 1024;
const MAX_SUFFIX_BYTES = 1024 * 1024;
const MAX_SUMMARY_CONVERSATIONS = 8;
const MAX_SUMMARY_TURNS = 8;
const MAX_SUMMARY_TURN_CHARS = 700;
const MAX_TITLE_CHARS = 72;
const MAX_DESCRIPTION_CHARS = 220;
const MAX_GENERATED_TITLE_WORDS = 6;
const MAX_GENERATED_DESCRIPTION_WORDS = 18;
const DEFAULT_SUMMARY_ENDPOINT =
  'https://www.exawatt.ai/api/conversations/summarize';
const DEFAULT_CODEX_SESSIONS_ROOT = path.join(
  os.homedir(),
  '.codex',
  'sessions'
);
const DEFAULT_CODEX_STATE_DATABASE = path.join(
  os.homedir(),
  '.codex',
  'state_5.sqlite'
);

async function canonicalDirectory(directory: string): Promise<string> {
  try {
    return await fs.promises.realpath(directory);
  } catch {
    return path.resolve(directory);
  }
}

function directoryIsWithin(directory: string, root: string): boolean {
  if (directory === root) return true;
  const relative = path.relative(root, directory);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * One Project membership calculation per catalog load. Provider records can
 * live under the primary checkout, a nested package, or any live worktree.
 * Resolving that set up front avoids spawning git once per candidate.
 */
class ProjectDirectoryScope {
  private constructor(readonly roots: readonly string[]) {}

  static async create(
    projectDirectory: string,
    worktrees: (projectDir: string) => Promise<string[]> = listProjectWorktrees
  ): Promise<ProjectDirectoryScope> {
    const directories = [
      projectDirectory,
      ...(await worktrees(projectDirectory)),
    ];
    const canonical = await Promise.all(directories.map(canonicalDirectory));
    return new ProjectDirectoryScope([...new Set(canonical)]);
  }

  async launchDirectory(directory: string): Promise<string | null> {
    const candidate = await canonicalDirectory(directory);
    if (!this.roots.some(root => directoryIsWithin(candidate, root)))
      return null;
    try {
      const stat = await fs.promises.stat(candidate);
      return stat.isDirectory() ? candidate : null;
    } catch {
      return null;
    }
  }
}

/**
 * Project membership is wider than cwd equality: commands can begin in a
 * nested package or linked worktree while still belonging to one canonical
 * Project. Path containment handles ordinary folders; resolveProject handles
 * live git worktrees through their common git directory.
 */
export async function directoryBelongsToProject(
  directory: string,
  projectDirectory: string
): Promise<boolean> {
  const scope = await ProjectDirectoryScope.create(projectDirectory);
  return (await scope.launchDirectory(directory)) !== null;
}

async function jsonlFiles(directory: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(entry => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return jsonlFiles(entryPath);
      return Promise.resolve(entry.name.endsWith('.jsonl') ? [entryPath] : []);
    })
  );
  return nested.flat();
}

async function recentFiles(directory: string): Promise<
  Array<{
    file: string;
    stat: fs.Stats;
  }>
> {
  const files = await jsonlFiles(directory);
  const settled = await Promise.allSettled(
    files.map(async file => ({ file, stat: await fs.promises.stat(file) }))
  );
  return settled
    .filter(
      (
        item
      ): item is PromiseFulfilledResult<{ file: string; stat: fs.Stats }> =>
        item.status === 'fulfilled'
    )
    .map(item => item.value)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, MAX_LEGACY_METADATA_FILES);
}

async function readFirstLine(file: string, size: number): Promise<string> {
  const prefix = await readRange(file, 0, Math.min(size, MAX_METADATA_BYTES));
  return prefix.split('\n', 1)[0] ?? '';
}

async function readRange(
  file: string,
  start: number,
  length: number
): Promise<string> {
  const handle = await fs.promises.open(file, 'r');
  const buffer = Buffer.allocUnsafe(length);
  try {
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function readBoundedLines(file: string, size: number): Promise<string[]> {
  const prefixLength = Math.min(size, MAX_PREFIX_BYTES);
  const prefix = await readRange(file, 0, prefixLength);
  if (size <= prefixLength) return prefix.split('\n').filter(Boolean);
  const suffixStart = Math.max(prefixLength, size - MAX_SUFFIX_BYTES);
  const suffix = await readRange(file, suffixStart, size - suffixStart);
  const suffixLines = suffix.split('\n');
  // The suffix normally begins in the middle of a JSONL record.
  suffixLines.shift();
  return [...prefix.split('\n'), ...suffixLines].filter(Boolean);
}

function recordText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(item => {
      if (!item || typeof item !== 'object') return '';
      const candidate = item as { text?: unknown; type?: unknown };
      return typeof candidate.text === 'string' ? candidate.text : '';
    })
    .join(' ');
}

const ENVELOPE_PREFIXES = [
  '# AGENTS.md instructions',
  '<environment_context>',
  '<permissions instructions>',
  '<skills_instructions>',
  '<skill_listing>',
  '<apps_instructions>',
  '<plugins_instructions>',
  '<user_shell_command>',
  '<system-reminder>',
];

export function meaningfulOperatorText(value: string): string | null {
  let text = value.replace(/\s+/g, ' ').trim();
  if (!text || ENVELOPE_PREFIXES.some(prefix => text.startsWith(prefix))) {
    return null;
  }
  text = text
    .replace(/<image\b[^>]*>\s*<\/image>/gi, '[Image]')
    .replace(/<image\b[^>]*\/>/gi, '[Image]')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text === '[Request interrupted by user]') return null;
  return text;
}

function truncate(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const prefix = clean.slice(0, maxChars - 1);
  const word = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, word > maxChars / 2 ? word : prefix.length)}…`;
}

function fallbackTitle(turns: string[], id: string): string {
  const first = turns[0];
  if (!first) return id;
  return truncate(first.replace(/^\[Image\]\s*/i, ''), MAX_TITLE_CHARS);
}

function summaryTurns(turns: string[]): string[] {
  if (turns.length <= MAX_SUMMARY_TURNS) {
    return turns.map(turn => truncate(turn, MAX_SUMMARY_TURN_CHARS));
  }
  return [...turns.slice(0, 3), ...turns.slice(-5)].map(turn =>
    truncate(turn, MAX_SUMMARY_TURN_CHARS)
  );
}

/** Defense-in-depth before any excerpt crosses the hosted-summary boundary.
 * The visible Settings control remains the privacy authority; this prevents
 * common credentials from being disclosed even when the feature is enabled. */
export function redactHostedSummaryText(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
      '[REDACTED PRIVATE KEY]'
    )
    .replace(
      /\b(?:sk|sk-ant|xox[baprs])-[_A-Za-z0-9-]{12,}\b/g,
      '[REDACTED TOKEN]'
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})\b/g,
      '[REDACTED TOKEN]'
    )
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED AWS KEY]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      '[REDACTED JWT]'
    )
    .replace(
      /\b(?:authorization|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      match => {
        const separator = match.match(/\s*[:=]\s*/)?.[0] ?? '=';
        return `${match.slice(0, match.indexOf(separator))}${separator}[REDACTED]`;
      }
    );
}

export function conversationCorrelationKey(
  harness: ConversationHarness,
  firstOperatorTurn: string | null | undefined
): string | null {
  if (!firstOperatorTurn) return null;
  const normalized = firstOperatorTurn
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return normalized ? `${harness}:${normalized}` : null;
}

const FIRST_PERSON_NARRATION =
  /\b(?:i(?:'m| am|'ve| have|'ll| will| found)|we(?:'re| are|'ve| have|'ll| will| found))\b/i;
const LEADING_FIRST_PERSON_NARRATION =
  /^(?:i(?:'m| am|'ve| have|'ll| will| found)|we(?:'re| are|'ve| have|'ll| will| found))\b/i;
const MODEL_PREAMBLE =
  /^(?:based on (?:my|the) (?:analysis|exploration|review|context)|here(?:'s| is)|this (?:conversation|task|request))\b/i;

function looksLikeModelNarration(value: string): boolean {
  const clean = value.replace(/\s+/g, ' ').trim();
  return (
    LEADING_FIRST_PERSON_NARRATION.test(clean) || MODEL_PREAMBLE.test(clean)
  );
}

function usableNativeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (
    !clean ||
    clean.length > MAX_TITLE_CHARS ||
    looksLikeModelNarration(clean)
  ) {
    return null;
  }
  return clean;
}

function usableGeneratedText(
  value: unknown,
  maxChars: number,
  maxWords: number
): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (
    !clean ||
    clean.length > maxChars ||
    clean.split(/\s+/).length > maxWords ||
    FIRST_PERSON_NARRATION.test(clean) ||
    MODEL_PREAMBLE.test(clean)
  ) {
    return null;
  }
  return clean;
}

function usableGeneratedTitle(value: unknown): string | null {
  return usableGeneratedText(value, MAX_TITLE_CHARS, MAX_GENERATED_TITLE_WORDS);
}

function usableGeneratedDescription(value: unknown): string | null {
  return usableGeneratedText(
    value,
    MAX_DESCRIPTION_CHARS,
    MAX_GENERATED_DESCRIPTION_WORDS
  );
}

/** Provider indexes can expose a model preview as though it were a title or
 * operator turn. Normalize those records before cache/enrichment so rejected
 * narration never remains visible as the fallback presentation. */
function normalizeDraftPresentation(
  candidate: ConversationDraft
): ConversationDraft {
  const summaryInput = candidate.summaryInput.filter(
    turn => !looksLikeModelNarration(turn)
  );
  const description =
    candidate.description && !looksLikeModelNarration(candidate.description)
      ? candidate.description
      : summaryInput[summaryInput.length - 1]
        ? truncate(summaryInput[summaryInput.length - 1], MAX_DESCRIPTION_CHARS)
        : null;
  if (!looksLikeModelNarration(candidate.title)) {
    return { ...candidate, description, summaryInput };
  }
  const titleSource = description
    ? [description]
    : summaryInput.length > 0
      ? summaryInput
      : [];
  return {
    ...candidate,
    title: fallbackTitle(titleSource, candidate.id),
    description,
    titleSource: 'fallback',
    needsSummary: summaryInput.length > 0,
    summaryInput,
  };
}

export class CodexConversationAdapter implements ConversationCatalogAdapter {
  readonly harnesses = ['codex'] as const;

  constructor(
    private readonly sessionsRoot = process.env.EXAWATT_CODEX_SESSIONS_ROOT ??
      DEFAULT_CODEX_SESSIONS_ROOT,
    private readonly stateDatabase = process.env.EXAWATT_CODEX_STATE_DB ??
      (sessionsRoot === DEFAULT_CODEX_SESSIONS_ROOT
        ? DEFAULT_CODEX_STATE_DATABASE
        : null),
    private readonly projectDirectories: (
      projectDir: string
    ) => Promise<string[]> = listProjectWorktrees
  ) {}

  async list(cwd: string): Promise<ConversationDraft[]> {
    const scope = await ProjectDirectoryScope.create(
      cwd,
      this.projectDirectories
    );
    const indexed = await this.readIndexed(scope);
    if (indexed) return indexed;
    return this.readLegacyTranscripts(scope);
  }

  /** Codex already maintains an indexed thread catalog. Querying that source
   * by Project is both faster and more accurate than rediscovering metadata by
   * walking every rollout file. */
  private async readIndexed(
    scope: ProjectDirectoryScope
  ): Promise<ConversationDraft[] | null> {
    if (!this.stateDatabase) return null;
    let database: import('node:sqlite').DatabaseSync | null = null;
    try {
      // Runtime require keeps this Electron/Node-only capability out of the
      // renderer-oriented Vite transform used by the shared test suite.
      const { DatabaseSync } =
        require('node:sqlite') as typeof import('node:sqlite');
      database = new DatabaseSync(this.stateDatabase, { readOnly: true });
      const predicates = scope.roots.map(
        () => `(cwd = ? OR cwd LIKE ? ESCAPE '\\')`
      );
      const parameters = scope.roots.flatMap(root => [
        root,
        `${escapeSqlLike(`${root}${path.sep}`)}%`,
      ]);
      const statement = database.prepare(`
        SELECT id, cwd, rollout_path, title, first_user_message, preview,
               created_at_ms, updated_at_ms, recency_at_ms
          FROM threads
         WHERE archived = 0 AND (${predicates.join(' OR ')})
         ORDER BY recency_at_ms DESC
         LIMIT ?
      `);
      const records = statement.all(
        ...parameters,
        MAX_PROJECT_RESULTS
      ) as Array<Record<string, unknown>>;
      const rows: ConversationDraft[] = [];
      for (const record of records) {
        if (typeof record.id !== 'string' || typeof record.cwd !== 'string') {
          continue;
        }
        const launchDirectory = await scope.launchDirectory(record.cwd);
        if (!launchDirectory) continue;
        const first = meaningfulOperatorText(
          typeof record.first_user_message === 'string'
            ? record.first_user_message
            : ''
        );
        const preview = meaningfulOperatorText(
          typeof record.preview === 'string' ? record.preview : ''
        );
        const turns = [
          first,
          preview && preview !== first ? preview : null,
        ].filter((turn): turn is string => !!turn);
        const nativeTitle = usableNativeTitle(record.title);
        const startedAt = finiteTimestamp(record.created_at_ms, Date.now());
        const updatedAt = finiteTimestamp(
          record.recency_at_ms,
          finiteTimestamp(record.updated_at_ms, startedAt)
        );
        rows.push({
          id: record.id,
          harness: 'codex',
          cwd: launchDirectory,
          startedAt,
          updatedAt,
          title: nativeTitle ?? fallbackTitle(turns, record.id),
          description: turns[turns.length - 1]
            ? truncate(turns[turns.length - 1], MAX_DESCRIPTION_CHARS)
            : null,
          titleSource: nativeTitle ? 'native' : 'fallback',
          needsSummary: !nativeTitle && turns.length > 0,
          providerSessionId: record.id,
          continuation: { kind: 'provider' },
          fingerprint: `index:${updatedAt}:${String(record.title ?? '').length}:${turns.join('').length}`,
          summaryInput: summaryTurns(turns),
          providerIdentity: record.id,
          correlationKey: conversationCorrelationKey('codex', turns[0]),
        });
      }
      return rows;
    } catch {
      return null;
    } finally {
      database?.close();
    }
  }

  /** Compatibility path for older Codex installations without state_5.sqlite.
   * Only the first metadata record is read globally; transcript excerpts are
   * opened after Project membership is established. */
  private async readLegacyTranscripts(
    scope: ProjectDirectoryScope
  ): Promise<ConversationDraft[]> {
    const files = await recentFiles(this.sessionsRoot);
    const rows: ConversationDraft[] = [];

    for (const { file, stat } of files) {
      if (rows.length >= MAX_PROJECT_RESULTS) break;
      try {
        const first = JSON.parse(await readFirstLine(file, stat.size));
        const meta = first?.type === 'session_meta' ? first.payload : null;
        const id = meta?.session_id ?? meta?.id;
        if (!id || typeof meta?.cwd !== 'string') continue;
        const launchDirectory = await scope.launchDirectory(meta.cwd);
        if (!launchDirectory) continue;
        const lines = await readBoundedLines(file, stat.size);

        const turns: string[] = [];
        for (const line of lines.slice(1)) {
          try {
            const record = JSON.parse(line);
            const payload = record?.payload;
            if (record?.type !== 'response_item' || payload?.role !== 'user') {
              continue;
            }
            const text = meaningfulOperatorText(recordText(payload.content));
            if (text) turns.push(text);
          } catch {
            // A partial line is expected at either bounded slice edge.
          }
        }

        const startedAt = Date.parse(meta.timestamp ?? first.timestamp ?? '');
        rows.push({
          id,
          harness: 'codex',
          cwd: launchDirectory,
          startedAt: Number.isFinite(startedAt)
            ? startedAt
            : stat.birthtimeMs || stat.mtimeMs,
          updatedAt: stat.mtimeMs,
          title: fallbackTitle(turns, id),
          description: turns[turns.length - 1]
            ? truncate(turns[turns.length - 1], MAX_DESCRIPTION_CHARS)
            : null,
          titleSource: 'fallback',
          needsSummary: turns.length > 0,
          providerSessionId: id,
          continuation: { kind: 'provider' },
          fingerprint: `${stat.mtimeMs}:${stat.size}`,
          summaryInput: summaryTurns(turns),
          providerIdentity: id,
          correlationKey: conversationCorrelationKey('codex', turns[0]),
        });
      } catch {
        // Harness files can rotate, truncate, or disappear while being read.
      }
    }
    return rows;
  }
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

interface ClaudeIndexEntry {
  sessionId?: unknown;
  fullPath?: unknown;
  fileMtime?: unknown;
  firstPrompt?: unknown;
  summary?: unknown;
  created?: unknown;
  modified?: unknown;
  projectPath?: unknown;
  isSidechain?: unknown;
}

export class ClaudeConversationAdapter implements ConversationCatalogAdapter {
  readonly harnesses = ['claude'] as const;

  constructor(
    private readonly projectsRoot = process.env.EXAWATT_CLAUDE_PROJECTS_ROOT ??
      path.join(os.homedir(), '.claude', 'projects'),
    private readonly projectDirectories: (
      projectDir: string
    ) => Promise<string[]> = listProjectWorktrees
  ) {}

  async list(cwd: string): Promise<ConversationDraft[]> {
    const workingDirectories = await this.projectDirectories(cwd);
    const scope = await ProjectDirectoryScope.create(
      cwd,
      async () => workingDirectories
    );
    const projectDirectories = [cwd, ...workingDirectories].map(directory => ({
      launchDirectory: directory,
      historyDirectory: path.join(
        this.projectsRoot,
        directory.replace(/[^a-zA-Z0-9_-]/g, '-')
      ),
    }));
    const rows = await Promise.all(
      [
        ...new Map(
          projectDirectories.map(item => [item.historyDirectory, item])
        ).values(),
      ].map(async ({ historyDirectory, launchDirectory }) => {
        const indexed = await this.readIndex(historyDirectory, scope);
        if (indexed.length > 0) return indexed;
        return this.readTranscripts(historyDirectory, launchDirectory, scope);
      })
    );
    return rows
      .flat()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_PROJECT_RESULTS);
  }

  private async readIndex(
    projectDirectory: string,
    scope: ProjectDirectoryScope
  ): Promise<ConversationDraft[]> {
    let parsed: { entries?: ClaudeIndexEntry[] };
    try {
      parsed = JSON.parse(
        await fs.promises.readFile(
          path.join(projectDirectory, 'sessions-index.json'),
          'utf8'
        )
      );
    } catch {
      return [];
    }
    if (!Array.isArray(parsed.entries)) return [];
    const rows: ConversationDraft[] = [];
    for (const entry of parsed.entries) {
      if (
        typeof entry.sessionId !== 'string' ||
        typeof entry.projectPath !== 'string' ||
        entry.isSidechain === true
      ) {
        continue;
      }
      const launchDirectory = await scope.launchDirectory(entry.projectPath);
      if (!launchDirectory) continue;
      const first = meaningfulOperatorText(
        typeof entry.firstPrompt === 'string' ? entry.firstPrompt : ''
      );
      const nativeTitle = usableNativeTitle(entry.summary);
      const parsedUpdatedAt =
        typeof entry.fileMtime === 'number'
          ? entry.fileMtime
          : Date.parse(String(entry.modified ?? ''));
      const updatedAt = finiteTimestamp(parsedUpdatedAt, Date.now());
      let size = 0;
      if (typeof entry.fullPath === 'string') {
        try {
          size = (await fs.promises.stat(entry.fullPath)).size;
        } catch {
          // Index metadata remains usable if a transcript rotates after read.
        }
      }
      rows.push({
        id: entry.sessionId,
        harness: 'claude',
        cwd: launchDirectory,
        startedAt: finiteTimestamp(
          Date.parse(String(entry.created ?? '')),
          updatedAt
        ),
        updatedAt,
        title:
          nativeTitle ?? fallbackTitle(first ? [first] : [], entry.sessionId),
        description: first ? truncate(first, MAX_DESCRIPTION_CHARS) : null,
        titleSource: nativeTitle ? 'native' : 'fallback',
        needsSummary: !nativeTitle && !!first,
        providerSessionId: entry.sessionId,
        continuation: { kind: 'provider' },
        fingerprint: `${updatedAt}:${size}`,
        summaryInput: first ? [truncate(first, MAX_SUMMARY_TURN_CHARS)] : [],
        providerIdentity: entry.sessionId,
        correlationKey: conversationCorrelationKey('claude', first),
      });
    }
    return rows;
  }

  private async readTranscripts(
    projectDirectory: string,
    sourceDirectory: string,
    scope: ProjectDirectoryScope
  ): Promise<ConversationDraft[]> {
    const launchDirectory = await scope.launchDirectory(sourceDirectory);
    if (!launchDirectory) return [];
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(projectDirectory, {
        withFileTypes: true,
      });
    } catch {
      return [];
    }
    const files = await Promise.all(
      entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map(async entry => {
          const file = path.join(projectDirectory, entry.name);
          return { file, stat: await fs.promises.stat(file) };
        })
    );
    files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const rows: ConversationDraft[] = [];

    for (const { file, stat } of files.slice(0, MAX_PROJECT_RESULTS)) {
      try {
        const lines = await readBoundedLines(file, stat.size);
        const turns: string[] = [];
        let sessionId = path.basename(file, '.jsonl');
        let nativeTitle: string | null = null;
        let startedAt = stat.birthtimeMs || stat.mtimeMs;
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (typeof record.sessionId === 'string') {
              sessionId = record.sessionId;
            }
            if (record.type === 'ai-title') {
              nativeTitle = usableNativeTitle(record.aiTitle) ?? nativeTitle;
            } else if (record.type === 'agent-name') {
              nativeTitle = nativeTitle ?? usableNativeTitle(record.agentName);
            } else if (
              record.type === 'user' &&
              record.message?.role === 'user'
            ) {
              const text = meaningfulOperatorText(
                recordText(record.message.content)
              );
              if (text) turns.push(text);
            }
            const timestamp = Date.parse(record.timestamp ?? '');
            if (Number.isFinite(timestamp)) {
              startedAt = Math.min(startedAt, timestamp);
            }
          } catch {
            // A partial line is expected at either bounded slice edge.
          }
        }
        rows.push({
          id: sessionId,
          harness: 'claude',
          cwd: launchDirectory,
          startedAt,
          updatedAt: stat.mtimeMs,
          title: nativeTitle ?? fallbackTitle(turns, sessionId),
          description: turns[turns.length - 1]
            ? truncate(turns[turns.length - 1], MAX_DESCRIPTION_CHARS)
            : null,
          titleSource: nativeTitle ? 'native' : 'fallback',
          needsSummary: !nativeTitle && turns.length > 0,
          providerSessionId: sessionId,
          continuation: { kind: 'provider' },
          fingerprint: `${stat.mtimeMs}:${stat.size}`,
          summaryInput: summaryTurns(turns),
          providerIdentity: sessionId,
          correlationKey: conversationCorrelationKey('claude', turns[0]),
        });
      } catch {
        // One malformed transcript must not hide the rest of the catalog.
      }
    }
    return rows;
  }
}

/**
 * Exawatt's Recently-closed ledger is itself a source of conversation truth.
 * It supplies Project ownership, semantic goals, and the ability to restore a
 * logical Session with retained history. Provider identity remains the row ID
 * when known so the catalog can reconcile both records without duplication.
 */
export class ProjectSessionConversationAdapter implements ConversationCatalogAdapter {
  readonly harnesses = ['claude', 'codex', 'opencode', 'grok'] as const;

  constructor(private readonly listSessions: () => ClosedSessionEntry[]) {}

  async list(projectDir: string): Promise<ConversationDraft[]> {
    const scope = await ProjectDirectoryScope.create(projectDir);
    const rows: ConversationDraft[] = [];
    for (const entry of this.listSessions()) {
      if (
        entry.harness !== 'claude' &&
        entry.harness !== 'codex' &&
        entry.harness !== 'opencode' &&
        entry.harness !== 'grok'
      ) {
        continue;
      }
      const launchDirectory = await scope.launchDirectory(entry.cwd);
      if (!launchDirectory) continue;
      const initialTask = meaningfulOperatorText(entry.initialTask ?? '');
      const goal = meaningfulOperatorText(entry.goal ?? '');
      const title = goal
        ? truncate(goal, MAX_TITLE_CHARS)
        : initialTask
          ? truncate(initialTask, MAX_TITLE_CHARS)
          : entry.title;
      rows.push({
        id: entry.harnessSessionId ?? entry.durableSessionId,
        harness: entry.harness,
        cwd: launchDirectory,
        startedAt: entry.closedAt,
        updatedAt: entry.closedAt,
        title,
        description:
          initialTask && initialTask !== title
            ? truncate(initialTask, MAX_DESCRIPTION_CHARS)
            : goal && goal !== title
              ? truncate(goal, MAX_DESCRIPTION_CHARS)
              : null,
        titleSource: goal ? 'generated' : 'fallback',
        needsSummary: !goal && !!initialTask,
        providerSessionId: entry.harnessSessionId,
        continuation: {
          kind: 'exawatt-session',
          durableSessionId: entry.durableSessionId,
        },
        fingerprint: `closed:${entry.closedAt}:${entry.initialTask?.length ?? 0}:${entry.goal?.length ?? 0}`,
        summaryInput: initialTask
          ? [truncate(initialTask, MAX_SUMMARY_TURN_CHARS)]
          : [],
        providerIdentity: entry.harnessSessionId,
        correlationKey: conversationCorrelationKey(entry.harness, initialTask),
      });
    }
    return rows;
  }
}

export function parseOpencodeSessionList(raw: string): Array<{
  id: string;
  title: string;
  directory: string;
  created: number;
  updated: number;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (
        entry
      ): entry is {
        id: string;
        title: string;
        directory: string;
        created: number;
        updated: number;
      } =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        /^[A-Za-z0-9_-]{8,128}$/.test(entry.id) &&
        typeof entry.title === 'string' &&
        typeof entry.directory === 'string' &&
        Boolean(entry.directory) &&
        typeof entry.created === 'number' &&
        Number.isFinite(entry.created) &&
        typeof entry.updated === 'number' &&
        Number.isFinite(entry.updated)
    )
    .slice(0, 200);
}

export class OpenCodeConversationAdapter implements ConversationCatalogAdapter {
  readonly harnesses = ['opencode'] as const;

  constructor(
    private readonly resolveShell: () => Promise<string> = async () =>
      process.env.SHELL || '/bin/zsh'
  ) {}

  async list(projectDir: string): Promise<ConversationDraft[]> {
    const shell = await this.resolveShell();
    const testExecutable =
      process.env.EXAWATT_TEST === '1' &&
      process.env.EXAWATT_TEST_HARNESS_BIN &&
      path.isAbsolute(process.env.EXAWATT_TEST_HARNESS_BIN)
        ? path.join(process.env.EXAWATT_TEST_HARNESS_BIN, 'opencode')
        : null;
    const invocation = testExecutable ? shellQuote(testExecutable) : 'opencode';
    const result = await execFileAsync(
      shell,
      [
        '-l',
        '-c',
        `${invocation} --pure session list --format json --max-count 200`,
      ],
      {
        cwd: projectDir,
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      }
    );
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('OpenCode session catalog returned invalid JSON');
    }
    const scope = await ProjectDirectoryScope.create(projectDir);
    const rows = await Promise.all(
      parseOpencodeSessionList(result.stdout).map(async session => ({
        session,
        launchDirectory: await scope.launchDirectory(session.directory),
      }))
    );
    return rows
      .filter(
        (row): row is typeof row & { launchDirectory: string } =>
          row.launchDirectory !== null
      )
      .map(({ session, launchDirectory }): ConversationDraft => {
        const nativeTitle = usableNativeTitle(session.title);
        return {
          id: session.id,
          harness: 'opencode',
          cwd: launchDirectory,
          startedAt: session.created,
          updatedAt: session.updated,
          title: nativeTitle ?? 'OpenCode session',
          description: null,
          titleSource: nativeTitle ? 'native' : 'fallback',
          needsSummary: false,
          providerSessionId: session.id,
          continuation: { kind: 'provider' },
          fingerprint: `opencode:${session.updated}`,
          summaryInput: [],
          providerIdentity: session.id,
          correlationKey: null,
        };
      });
  }
}

/** Session rows read from Grok Build's own `summary.json` files. */
export interface GrokSessionSummary {
  id: string;
  cwd: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  hidden: boolean;
  /** `fork`, `subagent`, `worktree`, … — absent for an operator's own session. */
  sessionKind: string | null;
}

export function parseGrokSessionSummary(
  raw: string,
  fallbackId: string,
  fallbackCwd: string | null
): GrokSessionSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as {
    info?: { id?: unknown; cwd?: unknown };
    session_summary?: unknown;
    generated_title?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    last_active_at?: unknown;
    hidden?: unknown;
    session_kind?: unknown;
  };
  const id =
    typeof record.info?.id === 'string' && record.info.id
      ? record.info.id
      : fallbackId;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return null;
  const cwd =
    typeof record.info?.cwd === 'string' && record.info.cwd
      ? record.info.cwd
      : fallbackCwd;
  if (!cwd) return null;
  const createdAt = Date.parse(String(record.created_at ?? ''));
  const activeAt = Date.parse(String(record.last_active_at ?? ''));
  const updatedAt = Date.parse(String(record.updated_at ?? ''));
  const title =
    usableNativeTitle(record.generated_title) ??
    usableNativeTitle(record.session_summary);
  return {
    id,
    cwd,
    title,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    updatedAt: Number.isFinite(activeAt)
      ? activeAt
      : Number.isFinite(updatedAt)
        ? updatedAt
        : 0,
    // `hidden` is the source's own visibility override; its own pickers honor
    // it, so Exawatt does too rather than surfacing rows Grok Build hides.
    hidden: record.hidden === true,
    sessionKind:
      typeof record.session_kind === 'string' && record.session_kind
        ? record.session_kind
        : null,
  };
}

/**
 * Grok Build conversations, read straight from its own session directories.
 *
 * No subprocess: the harness writes `summary.json` per session under
 * `<grok home>/sessions/<encoded cwd>/<uuid>/`, so the catalog is a directory
 * read rather than a CLI round trip. The cwd component is derived with the
 * harness's own encoding, and the slug+hash form (a cwd whose encoded name
 * would exceed 255 bytes) is resolved through the `.cwd` file the harness
 * writes for exactly that purpose — the encoded name is never recomputed
 * from a hash Exawatt owns.
 *
 * Subagent and fork sessions are excluded: they are the source's internal
 * children, not conversations the operator started, and offering them as
 * resume targets would put another Agent's transcript in a tab.
 */
export class GrokConversationAdapter implements ConversationCatalogAdapter {
  readonly harnesses = ['grok'] as const;

  constructor(
    private readonly sessionsRoot = grokSessionsRoot(),
    private readonly maxSessions = 200
  ) {}

  async list(projectDir: string): Promise<ConversationDraft[]> {
    const scope = await ProjectDirectoryScope.create(projectDir);
    const directories = new Set<string>();
    for (const root of [projectDir, ...scope.roots]) {
      const encoded = encodeGrokCwdDirname(root);
      if (encoded) directories.add(path.join(this.sessionsRoot, encoded));
    }
    // Long-cwd (slug+hash) directories cannot be derived, only recognized, so
    // the corpus is enumerated once and matched through each directory's own
    // `.cwd` record. Bounded by the same list the derived path uses.
    for (const entry of await this.longFormDirectories()) {
      if (await scope.launchDirectory(entry.cwd)) directories.add(entry.path);
    }
    const rows: ConversationDraft[] = [];
    for (const directory of directories) {
      for (const summary of await this.readSummaries(directory)) {
        if (summary.hidden || summary.sessionKind) continue;
        const launchDirectory = await scope.launchDirectory(summary.cwd);
        if (!launchDirectory) continue;
        rows.push({
          id: summary.id,
          harness: 'grok',
          cwd: launchDirectory,
          startedAt: summary.createdAt,
          updatedAt: summary.updatedAt,
          title: summary.title ?? 'Grok Build session',
          description: null,
          titleSource: summary.title ? 'native' : 'fallback',
          needsSummary: false,
          providerSessionId: summary.id,
          continuation: { kind: 'provider' },
          fingerprint: `grok:${summary.updatedAt}`,
          summaryInput: [],
          providerIdentity: summary.id,
          correlationKey: null,
        });
        if (rows.length >= this.maxSessions) return rows;
      }
    }
    return rows;
  }

  private async longFormDirectories(): Promise<
    Array<{ path: string; cwd: string }>
  > {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(this.sessionsRoot);
    } catch {
      return [];
    }
    const out: Array<{ path: string; cwd: string }> = [];
    for (const entry of entries.slice(0, 5_000)) {
      if (decodeGrokCwdDirname(entry)) continue;
      const directory = path.join(this.sessionsRoot, entry);
      let contents: string;
      try {
        contents = await fs.promises.readFile(
          path.join(directory, GROK_SESSION_FILES.cwd),
          'utf8'
        );
      } catch {
        continue;
      }
      const cwd = decodeGrokCwdDirname(entry, contents);
      if (cwd) out.push({ path: directory, cwd });
    }
    return out;
  }

  private async readSummaries(directory: string): Promise<GrokSessionSummary[]> {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(directory);
    } catch {
      return [];
    }
    const fallbackCwd = decodeGrokCwdDirname(
      path.basename(directory),
      await fs.promises
        .readFile(path.join(directory, GROK_SESSION_FILES.cwd), 'utf8')
        .catch(() => null)
    );
    const rows = await Promise.all(
      entries.slice(0, this.maxSessions).map(async entry => {
        const file = path.join(directory, entry, GROK_SESSION_FILES.summary);
        let raw: string;
        try {
          raw = await fs.promises.readFile(file, 'utf8');
        } catch {
          return null;
        }
        if (raw.length > MAX_METADATA_BYTES * 4) return null;
        return parseGrokSessionSummary(raw, entry, fallbackCwd);
      })
    );
    return rows
      .filter((row): row is GrokSessionSummary => row !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
}

/** `GROK_HOME` is the harness's own override; Exawatt reads it, never sets it. */
export function grokSessionsRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  if (env.EXAWATT_GROK_SESSIONS_ROOT) return env.EXAWATT_GROK_SESSIONS_ROOT;
  if (env.GROK_HOME) return path.join(env.GROK_HOME, 'sessions');
  return path.join(os.homedir(), '.grok', 'sessions');
}

export interface ConversationCatalogOptions {
  adapters?: ConversationCatalogAdapter[];
  projectSessions?: () => ClosedSessionEntry[];
  cacheFile?: string;
  summaryEndpoint?: string;
  fetch?: typeof fetch;
  hostedSummariesEnabled?: () => boolean;
  now?: () => number;
  openCodeShell?: () => Promise<string>;
}

export class RecentConversationCatalog {
  private readonly adapters: ConversationCatalogAdapter[];
  private readonly cacheFile: string | null;
  private readonly summaryEndpoint: string;
  private readonly fetchFn: typeof fetch;
  private readonly hostedSummariesEnabled: () => boolean;
  private readonly now: () => number;
  private cacheGeneration = 0;
  private cacheMutation = Promise.resolve();
  private readonly listCache = new Map<
    string,
    { expiresAt: number; drafts: ConversationDraft[] }
  >();
  private readonly listInFlight = new Map<
    string,
    Promise<ConversationDraft[]>
  >();

  constructor(options: ConversationCatalogOptions = {}) {
    this.adapters = options.adapters ?? [
      new ClaudeConversationAdapter(),
      new CodexConversationAdapter(),
      new OpenCodeConversationAdapter(options.openCodeShell),
      new GrokConversationAdapter(),
      ...(options.projectSessions
        ? [new ProjectSessionConversationAdapter(options.projectSessions)]
        : []),
    ];
    this.cacheFile = options.cacheFile ?? null;
    this.summaryEndpoint =
      options.summaryEndpoint ??
      process.env.EXAWATT_CONVERSATION_SUMMARY_URL ??
      DEFAULT_SUMMARY_ENDPOINT;
    this.fetchFn = options.fetch ?? fetch;
    this.hostedSummariesEnabled =
      options.hostedSummariesEnabled ?? (() => true);
    this.now = options.now ?? Date.now;
  }

  async list(cwd: string): Promise<RecentConversation[]> {
    return (await this.listDrafts(cwd)).map(stripPrivateFields);
  }

  async listForHarness(
    harness: PtyHarness,
    cwd: string
  ): Promise<RecentConversation[]> {
    if (harness === 'shell') return [];
    return (await this.listDrafts(cwd, harness))
      .filter(candidate => candidate.harness === harness)
      .map(stripPrivateFields);
  }

  /**
   * Return every provider identity whose first meaningful operator turn is an
   * exact semantic match for the supplied task. Callers must still enforce a
   * one-to-one match across logical Sessions before adopting any identity.
   */
  async providerIdentityCandidates(
    harness: ConversationHarness,
    cwd: string,
    initialTask: string
  ): Promise<string[]> {
    const correlationKey = conversationCorrelationKey(
      harness,
      meaningfulOperatorText(initialTask)
    );
    if (!correlationKey) return [];
    const identities = (await this.listDrafts(cwd, harness))
      .filter(
        candidate =>
          candidate.correlationKey === correlationKey &&
          !!candidate.providerIdentity
      )
      .map(candidate => candidate.providerIdentity!);
    return [...new Set(identities)];
  }

  /** Ledger mutations and provider launches invalidate the short-lived shared
   * Project view. Visible panes still deduplicate concurrent requests. */
  invalidate(_cwd?: string): void {
    this.cacheGeneration += 1;
    this.listCache.clear();
  }

  async enrich(
    cwd: string,
    accessToken: string
  ): Promise<RecentConversation[]> {
    if (!accessToken || accessToken.length > 8_000) {
      throw new Error('A valid Exawatt session is required for summaries.');
    }
    if (!this.hostedSummariesEnabled()) {
      throw new Error(
        'Hosted conversation summaries are disabled in Settings.'
      );
    }
    const drafts = await this.listDrafts(cwd);
    const pending = drafts
      .filter(
        candidate => candidate.needsSummary && candidate.summaryInput.length
      )
      .slice(0, MAX_SUMMARY_CONVERSATIONS);
    if (pending.length === 0) return drafts.map(stripPrivateFields);

    // Failures below are genuine attempt-and-fail and are counted (ENG-030
    // OS1.5b): the disabled-in-Settings and missing-token cases already threw
    // above, before any request existed, so they can never be reported.
    let response: Response;
    try {
      response = await this.fetchFn(this.summaryEndpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          conversations: pending.map(candidate => ({
            key: cacheKey(candidate),
            turns: candidate.summaryInput.map(redactHostedSummaryText),
          })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      recordHostedCallTransportFailure('conversation_summary', error);
      throw error;
    }
    if (!response.ok) {
      recordHostedCallHttpFailure('conversation_summary', response.status);
      throw new Error(
        `Conversation summaries unavailable (${response.status}).`
      );
    }
    const body = (await response.json()) as SummaryResponse;
    const pendingByKey = new Map(pending.map(item => [cacheKey(item), item]));
    await this.mutateCache(cache => {
      for (const item of body.conversations ?? []) {
        if (typeof item.key !== 'string') continue;
        const candidate = pendingByKey.get(item.key);
        const title = usableGeneratedTitle(item.title);
        const description = usableGeneratedDescription(item.summary);
        if (!candidate || !title || !description) continue;
        cache[item.key] = {
          fingerprint: candidate.fingerprint,
          title,
          description,
          storedAt: this.now(),
        };
      }
    });
    this.invalidate(cwd);
    return (await this.listDrafts(cwd)).map(stripPrivateFields);
  }

  private async listDrafts(
    cwd: string,
    harness?: ConversationHarness
  ): Promise<ConversationDraft[]> {
    const generation = this.cacheGeneration;
    const key = `${generation}:${path.resolve(cwd)}:${harness ?? 'all'}`;
    const cached = this.listCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.drafts;
    const existing = this.listInFlight.get(key);
    if (existing) return existing;
    const request = this.loadDrafts(cwd, harness).finally(() => {
      this.listInFlight.delete(key);
    });
    this.listInFlight.set(key, request);
    const drafts = await request;
    if (generation === this.cacheGeneration) {
      this.listCache.set(key, {
        expiresAt: this.now() + LIST_CACHE_TTL_MS,
        drafts,
      });
    }
    return drafts;
  }

  private async mutateCache(
    mutation: (cache: Record<string, CachedSummary>) => void
  ): Promise<void> {
    const operation = this.cacheMutation.then(async () => {
      const cache = await this.readCache();
      mutation(cache);
      await this.writeCache(cache);
    });
    this.cacheMutation = operation.catch(() => undefined);
    await operation;
  }

  private async loadDrafts(
    cwd: string,
    harness?: ConversationHarness
  ): Promise<ConversationDraft[]> {
    const adapters = harness
      ? this.adapters.filter(adapter => adapter.harnesses.includes(harness))
      : this.adapters;
    const settled = await Promise.allSettled(
      adapters.map(adapter => adapter.list(cwd))
    );
    const deduped = new Map<string, ConversationDraft>();
    for (const [index, result] of settled.entries()) {
      if (result.status !== 'fulfilled') {
        console.warn(
          `[conversation-catalog] ${adapters[index].constructor.name} failed`,
          result.reason instanceof Error ? result.reason.message : result.reason
        );
        continue;
      }
      for (const candidate of result.value) {
        const normalized = normalizeDraftPresentation(candidate);
        const key = cacheKey(normalized);
        const existing = deduped.get(key);
        deduped.set(
          key,
          existing ? mergeConversationDrafts(existing, normalized) : normalized
        );
      }
    }
    this.reconcileIdentitylessProjectSessions(deduped);
    const cache = await this.readCache();
    return [...deduped.values()]
      .map(candidate => {
        const cached = cache[cacheKey(candidate)];
        const cachedTitle = usableGeneratedTitle(cached?.title);
        if (
          !cached ||
          cached.fingerprint !== candidate.fingerprint ||
          !cachedTitle
        ) {
          return candidate;
        }
        return {
          ...candidate,
          title: cachedTitle,
          description:
            usableGeneratedDescription(cached.description) ??
            candidate.description,
          titleSource: 'generated' as const,
          needsSummary: false,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private reconcileIdentitylessProjectSessions(
    conversations: Map<string, ConversationDraft>
  ): void {
    const rows = [...conversations.values()];
    const identitylessGroups = new Map<string, ConversationDraft[]>();
    const providerGroups = new Map<string, ConversationDraft[]>();
    for (const row of rows) {
      if (!row.correlationKey) continue;
      const target =
        row.continuation.kind === 'exawatt-session' && !row.providerIdentity
          ? identitylessGroups
          : row.providerIdentity
            ? providerGroups
            : null;
      if (!target) continue;
      target.set(row.correlationKey, [
        ...(target.get(row.correlationKey) ?? []),
        row,
      ]);
    }
    for (const [correlationKey, projectSessions] of identitylessGroups) {
      const providers = providerGroups.get(correlationKey) ?? [];
      // Reconciliation is one-to-one on both sides. Two retained Sessions with
      // the same opening task must never claim one provider conversation.
      if (projectSessions.length !== 1 || providers.length !== 1) continue;
      const projectSession = projectSessions[0];
      const provider = providers[0];
      conversations.delete(cacheKey(projectSession));
      conversations.set(
        cacheKey(provider),
        mergeConversationDrafts(provider, projectSession)
      );
    }
  }

  private async readCache(): Promise<Record<string, CachedSummary>> {
    if (!this.cacheFile) return {};
    try {
      const parsed = JSON.parse(
        await fs.promises.readFile(this.cacheFile, 'utf8')
      );
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return {};
      const validated: Record<string, CachedSummary> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;
        const candidate = value as Partial<CachedSummary>;
        const title = usableNativeTitle(candidate.title);
        const description =
          candidate.description === null
            ? null
            : typeof candidate.description === 'string' &&
                candidate.description.length <= MAX_DESCRIPTION_CHARS
              ? candidate.description
              : undefined;
        if (
          !title ||
          description === undefined ||
          typeof candidate.fingerprint !== 'string' ||
          !candidate.fingerprint ||
          typeof candidate.storedAt !== 'number' ||
          !Number.isFinite(candidate.storedAt)
        ) {
          continue;
        }
        validated[key] = {
          title,
          description,
          fingerprint: candidate.fingerprint,
          storedAt: candidate.storedAt,
        };
      }
      return Object.fromEntries(
        Object.entries(validated)
          .sort(([, left], [, right]) => right.storedAt - left.storedAt)
          .slice(0, MAX_CACHED_SUMMARIES)
      );
    } catch {
      return {};
    }
  }

  private async writeCache(
    cache: Record<string, CachedSummary>
  ): Promise<void> {
    if (!this.cacheFile) return;
    await fs.promises.mkdir(path.dirname(this.cacheFile), { recursive: true });
    const pruned = Object.fromEntries(
      Object.entries(cache)
        .sort(([, left], [, right]) => right.storedAt - left.storedAt)
        .slice(0, MAX_CACHED_SUMMARIES)
    );
    const temporary = `${this.cacheFile}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(pruned), {
        mode: 0o600,
        flag: 'wx',
      });
      await fs.promises.rename(temporary, this.cacheFile);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }
}

function cacheKey(
  candidate: Pick<ConversationDraft, 'harness' | 'id'>
): string {
  return `${candidate.harness}:${candidate.id}`;
}

const TITLE_SOURCE_RANK: Record<RecentConversation['titleSource'], number> = {
  fallback: 0,
  generated: 1,
  native: 2,
};

/**
 * Reconcile two adapters describing the same exact provider identity. The
 * strongest label provenance owns the presentation, while Exawatt Session
 * continuation wins independently because it restores more state than a bare
 * provider process.
 */
function mergeConversationDrafts(
  left: ConversationDraft,
  right: ConversationDraft
): ConversationDraft {
  const leftRank = TITLE_SOURCE_RANK[left.titleSource];
  const rightRank = TITLE_SOURCE_RANK[right.titleSource];
  const presentation =
    rightRank > leftRank ||
    (rightRank === leftRank && right.updatedAt > left.updatedAt)
      ? right
      : left;
  const other = presentation === left ? right : left;
  const exawattContinuation = [left.continuation, right.continuation].find(
    continuation => continuation.kind === 'exawatt-session'
  );
  return {
    ...presentation,
    id: left.providerIdentity ?? right.providerIdentity ?? presentation.id,
    providerSessionId: left.providerIdentity ?? right.providerIdentity,
    startedAt: Math.min(left.startedAt, right.startedAt),
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
    description: presentation.description ?? other.description,
    continuation: exawattContinuation ?? presentation.continuation,
    providerIdentity: left.providerIdentity ?? right.providerIdentity,
    correlationKey: presentation.correlationKey ?? other.correlationKey,
  };
}

function stripPrivateFields(candidate: ConversationDraft): RecentConversation {
  const {
    fingerprint: _fingerprint,
    summaryInput: _summaryInput,
    providerIdentity: _providerIdentity,
    correlationKey: _correlationKey,
    ...publicRow
  } = candidate;
  return publicRow;
}
