import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PtyHarness } from './session-manager';

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
}

export interface ConversationDraft extends RecentConversation {
  fingerprint: string;
  summaryInput: string[];
}

export interface ConversationCatalogAdapter {
  harness: ConversationHarness;
  list(cwd: string): Promise<ConversationDraft[]>;
}

interface CachedSummary {
  fingerprint: string;
  title: string;
  description: string | null;
}

interface SummaryResponse {
  conversations?: Array<{
    key?: unknown;
    title?: unknown;
    summary?: unknown;
  }>;
}

const MAX_FILES = 300;
const MAX_PREFIX_BYTES = 2 * 1024 * 1024;
const MAX_SUFFIX_BYTES = 1024 * 1024;
const MAX_SUMMARY_CONVERSATIONS = 8;
const MAX_SUMMARY_TURNS = 8;
const MAX_SUMMARY_TURN_CHARS = 700;
const MAX_TITLE_CHARS = 72;
const MAX_DESCRIPTION_CHARS = 220;
const DEFAULT_SUMMARY_ENDPOINT =
  'https://www.exawatt.ai/api/conversations/summarize';

async function canonicalDirectory(directory: string): Promise<string> {
  try {
    return await fs.promises.realpath(directory);
  } catch {
    return path.resolve(directory);
  }
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
    .slice(0, MAX_FILES);
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

function usableNativeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > MAX_TITLE_CHARS) return null;
  return clean;
}

export class CodexConversationAdapter implements ConversationCatalogAdapter {
  readonly harness = 'codex' as const;

  constructor(
    private readonly sessionsRoot = process.env.EXAWATT_CODEX_SESSIONS_ROOT ??
      path.join(os.homedir(), '.codex', 'sessions')
  ) {}

  async list(cwd: string): Promise<ConversationDraft[]> {
    const requestedDirectory = await canonicalDirectory(cwd);
    const files = await recentFiles(this.sessionsRoot);
    const rows: ConversationDraft[] = [];

    for (const { file, stat } of files) {
      try {
        const lines = await readBoundedLines(file, stat.size);
        const first = JSON.parse(lines[0] ?? '{}');
        const meta = first?.type === 'session_meta' ? first.payload : null;
        const id = meta?.session_id ?? meta?.id;
        if (!id || typeof meta?.cwd !== 'string') continue;
        if ((await canonicalDirectory(meta.cwd)) !== requestedDirectory)
          continue;

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
          harness: this.harness,
          cwd,
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
          fingerprint: `${stat.mtimeMs}:${stat.size}`,
          summaryInput: summaryTurns(turns),
        });
      } catch {
        // Harness files can rotate, truncate, or disappear while being read.
      }
    }
    return rows;
  }
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
  readonly harness = 'claude' as const;

  constructor(
    private readonly projectsRoot = process.env.EXAWATT_CLAUDE_PROJECTS_ROOT ??
      path.join(os.homedir(), '.claude', 'projects')
  ) {}

  async list(cwd: string): Promise<ConversationDraft[]> {
    const projectDirectory = path.join(
      this.projectsRoot,
      cwd.replace(/[^a-zA-Z0-9_-]/g, '-')
    );
    const indexed = await this.readIndex(projectDirectory, cwd);
    if (indexed.length > 0) return indexed;
    return this.readTranscripts(projectDirectory, cwd);
  }

  private async readIndex(
    projectDirectory: string,
    cwd: string
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
    const requestedDirectory = await canonicalDirectory(cwd);
    const rows: ConversationDraft[] = [];
    for (const entry of parsed.entries) {
      if (
        typeof entry.sessionId !== 'string' ||
        typeof entry.projectPath !== 'string' ||
        entry.isSidechain === true ||
        (await canonicalDirectory(entry.projectPath)) !== requestedDirectory
      ) {
        continue;
      }
      const first = meaningfulOperatorText(
        typeof entry.firstPrompt === 'string' ? entry.firstPrompt : ''
      );
      const nativeTitle = usableNativeTitle(entry.summary);
      const updatedAt =
        typeof entry.fileMtime === 'number'
          ? entry.fileMtime
          : Date.parse(String(entry.modified ?? ''));
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
        harness: this.harness,
        cwd,
        startedAt: Date.parse(String(entry.created ?? '')) || updatedAt,
        updatedAt,
        title:
          nativeTitle ?? fallbackTitle(first ? [first] : [], entry.sessionId),
        description: first ? truncate(first, MAX_DESCRIPTION_CHARS) : null,
        titleSource: nativeTitle ? 'native' : 'fallback',
        needsSummary: !nativeTitle && !!first,
        fingerprint: `${updatedAt}:${size}`,
        summaryInput: first ? [truncate(first, MAX_SUMMARY_TURN_CHARS)] : [],
      });
    }
    return rows;
  }

  private async readTranscripts(
    projectDirectory: string,
    cwd: string
  ): Promise<ConversationDraft[]> {
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

    for (const { file, stat } of files.slice(0, MAX_FILES)) {
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
          harness: this.harness,
          cwd,
          startedAt,
          updatedAt: stat.mtimeMs,
          title: nativeTitle ?? fallbackTitle(turns, sessionId),
          description: turns[turns.length - 1]
            ? truncate(turns[turns.length - 1], MAX_DESCRIPTION_CHARS)
            : null,
          titleSource: nativeTitle ? 'native' : 'fallback',
          needsSummary: !nativeTitle && turns.length > 0,
          fingerprint: `${stat.mtimeMs}:${stat.size}`,
          summaryInput: summaryTurns(turns),
        });
      } catch {
        // One malformed transcript must not hide the rest of the catalog.
      }
    }
    return rows;
  }
}

export interface ConversationCatalogOptions {
  adapters?: ConversationCatalogAdapter[];
  cacheFile?: string;
  summaryEndpoint?: string;
  fetch?: typeof fetch;
}

export class RecentConversationCatalog {
  private readonly adapters: ConversationCatalogAdapter[];
  private readonly cacheFile: string | null;
  private readonly summaryEndpoint: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: ConversationCatalogOptions = {}) {
    this.adapters = options.adapters ?? [
      new ClaudeConversationAdapter(),
      new CodexConversationAdapter(),
    ];
    this.cacheFile = options.cacheFile ?? null;
    this.summaryEndpoint =
      options.summaryEndpoint ??
      process.env.EXAWATT_CONVERSATION_SUMMARY_URL ??
      DEFAULT_SUMMARY_ENDPOINT;
    this.fetchFn = options.fetch ?? fetch;
  }

  async list(cwd: string): Promise<RecentConversation[]> {
    return (await this.listDrafts(cwd)).map(stripPrivateFields);
  }

  async listForHarness(
    harness: PtyHarness,
    cwd: string
  ): Promise<RecentConversation[]> {
    if (harness === 'shell') return [];
    return (await this.listDrafts(cwd))
      .filter(candidate => candidate.harness === harness)
      .map(stripPrivateFields);
  }

  async enrich(
    cwd: string,
    accessToken: string
  ): Promise<RecentConversation[]> {
    if (!accessToken || accessToken.length > 8_000) {
      throw new Error('A valid Exawatt session is required for summaries.');
    }
    const drafts = await this.listDrafts(cwd);
    const pending = drafts
      .filter(
        candidate => candidate.needsSummary && candidate.summaryInput.length
      )
      .slice(0, MAX_SUMMARY_CONVERSATIONS);
    if (pending.length === 0) return drafts.map(stripPrivateFields);

    const response = await this.fetchFn(this.summaryEndpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversations: pending.map(candidate => ({
          key: cacheKey(candidate),
          turns: candidate.summaryInput,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(
        `Conversation summaries unavailable (${response.status}).`
      );
    }
    const body = (await response.json()) as SummaryResponse;
    const cache = await this.readCache();
    const pendingByKey = new Map(pending.map(item => [cacheKey(item), item]));
    for (const item of body.conversations ?? []) {
      if (typeof item.key !== 'string') continue;
      const candidate = pendingByKey.get(item.key);
      const title = usableNativeTitle(item.title);
      if (!candidate || !title) continue;
      const description =
        typeof item.summary === 'string' && item.summary.trim()
          ? truncate(item.summary, MAX_DESCRIPTION_CHARS)
          : candidate.description;
      cache[item.key] = {
        fingerprint: candidate.fingerprint,
        title,
        description,
      };
    }
    await this.writeCache(cache);
    return (await this.listDrafts(cwd)).map(stripPrivateFields);
  }

  private async listDrafts(cwd: string): Promise<ConversationDraft[]> {
    const settled = await Promise.allSettled(
      this.adapters.map(adapter => adapter.list(cwd))
    );
    const deduped = new Map<string, ConversationDraft>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const candidate of result.value) {
        const key = cacheKey(candidate);
        const existing = deduped.get(key);
        if (!existing || candidate.updatedAt > existing.updatedAt) {
          deduped.set(key, candidate);
        }
      }
    }
    const cache = await this.readCache();
    return [...deduped.values()]
      .map(candidate => {
        const cached = cache[cacheKey(candidate)];
        if (!cached || cached.fingerprint !== candidate.fingerprint) {
          return candidate;
        }
        return {
          ...candidate,
          title: cached.title,
          description: cached.description,
          titleSource: 'generated' as const,
          needsSummary: false,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async readCache(): Promise<Record<string, CachedSummary>> {
    if (!this.cacheFile) return {};
    try {
      const parsed = JSON.parse(
        await fs.promises.readFile(this.cacheFile, 'utf8')
      );
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async writeCache(
    cache: Record<string, CachedSummary>
  ): Promise<void> {
    if (!this.cacheFile) return;
    await fs.promises.mkdir(path.dirname(this.cacheFile), { recursive: true });
    const temporary = `${this.cacheFile}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(cache), {
      mode: 0o600,
    });
    await fs.promises.rename(temporary, this.cacheFile);
  }
}

function cacheKey(
  candidate: Pick<ConversationDraft, 'harness' | 'id'>
): string {
  return `${candidate.harness}:${candidate.id}`;
}

function stripPrivateFields(candidate: ConversationDraft): RecentConversation {
  const {
    fingerprint: _fingerprint,
    summaryInput: _summaryInput,
    ...publicRow
  } = candidate;
  return publicRow;
}
