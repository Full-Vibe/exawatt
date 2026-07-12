import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PtyHarness } from './session-manager';

export interface HarnessResumeCandidate {
  id: string;
  cwd: string;
  /** Provider session creation time, used to associate parallel launches. */
  startedAt: number;
  updatedAt: number;
  label: string;
}

interface CachedRollout {
  mtimeMs: number;
  size: number;
  candidate: Omit<HarnessResumeCandidate, 'label'>;
  label: string;
}

const MAX_ROLLOUTS = 300;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_LABEL_BYTES = 2 * 1024 * 1024;

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

async function canonicalDirectory(directory: string): Promise<string> {
  try {
    return await fs.promises.realpath(directory);
  } catch {
    return path.resolve(directory);
  }
}

async function readFirstLine(file: string): Promise<string> {
  const handle = await fs.promises.open(file, 'r');
  const chunks: Buffer[] = [];
  let offset = 0;
  try {
    while (offset < MAX_METADATA_BYTES) {
      const buffer = Buffer.allocUnsafe(
        Math.min(64 * 1024, MAX_METADATA_BYTES - offset)
      );
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      const newline = chunk.indexOf(0x0a);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline));
        return Buffer.concat(chunks).toString('utf8');
      }
      chunks.push(chunk);
      offset += bytesRead;
    }
  } finally {
    await handle.close();
  }
  throw new Error('Codex rollout metadata exceeds the bounded prefix');
}

async function readLabel(file: string, id: string): Promise<string> {
  const handle = await fs.promises.open(file, 'r');
  const buffer = Buffer.allocUnsafe(MAX_LABEL_BYTES);
  try {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return userLabel(buffer.subarray(0, bytesRead).toString('utf8'), id);
  } finally {
    await handle.close();
  }
}

function userLabel(prefix: string, id: string): string {
  const lines = prefix.split('\n');
  for (const line of lines.slice(1, 250)) {
    try {
      const record = JSON.parse(line);
      const payload = record?.payload;
      if (record?.type !== 'response_item' || payload?.role !== 'user')
        continue;
      const text = payload.content
        ?.map((item: { text?: string }) => item.text ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) return text.slice(0, 90);
    } catch {
      // A partial final line is expected when the provider is still writing.
    }
  }
  return id;
}

export class CodexResumeCatalog {
  private readonly cache = new Map<string, CachedRollout>();

  constructor(private readonly sessionsRoot: string) {}

  async list(cwd: string): Promise<HarnessResumeCandidate[]> {
    const requestedDirectory = await canonicalDirectory(cwd);
    const files = await jsonlFiles(this.sessionsRoot);
    const settled = await Promise.allSettled(
      files.map(async file => ({ file, stat: await fs.promises.stat(file) }))
    );
    const stats = settled
      .filter(
        (
          item
        ): item is PromiseFulfilledResult<{
          file: string;
          stat: fs.Stats;
        }> => item.status === 'fulfilled'
      )
      .map(item => item.value)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, MAX_ROLLOUTS);

    const candidates: HarnessResumeCandidate[] = [];
    for (const { file, stat } of stats) {
      try {
        let cached = this.cache.get(file);
        if (
          !cached ||
          cached.mtimeMs !== stat.mtimeMs ||
          cached.size !== stat.size
        ) {
          const first = JSON.parse(await readFirstLine(file));
          const meta = first?.type === 'session_meta' ? first.payload : null;
          const id = meta?.session_id ?? meta?.id;
          if (!id || typeof meta?.cwd !== 'string') continue;
          const startedAt = Date.parse(meta.timestamp ?? first.timestamp ?? '');
          cached = {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            candidate: {
              id,
              cwd: meta.cwd,
              startedAt: Number.isFinite(startedAt)
                ? startedAt
                : stat.birthtimeMs || stat.mtimeMs,
              updatedAt: stat.mtimeMs,
            },
            label: id,
          };
          this.cache.set(file, cached);
        }
        if (
          (await canonicalDirectory(cached.candidate.cwd)) !==
          requestedDirectory
        ) {
          continue;
        }
        if (cached.label === cached.candidate.id) {
          cached.label = await readLabel(file, cached.candidate.id);
        }
        candidates.push({ ...cached.candidate, cwd, label: cached.label });
      } catch {
        // Rollouts can rotate, truncate, or disappear while Codex writes them.
      }
    }
    return candidates.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

const catalogs = new Map<string, CodexResumeCatalog>();

export async function listResumeCandidates(
  harness: PtyHarness,
  cwd: string,
  sessionsRoot = path.join(os.homedir(), '.codex', 'sessions')
): Promise<HarnessResumeCandidate[]> {
  if (harness !== 'codex') return [];
  let catalog = catalogs.get(sessionsRoot);
  if (!catalog) {
    catalog = new CodexResumeCatalog(sessionsRoot);
    catalogs.set(sessionsRoot, catalog);
  }
  return catalog.list(cwd);
}
