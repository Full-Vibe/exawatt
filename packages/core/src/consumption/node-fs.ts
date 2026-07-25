/**
 * Node implementation of the `ConsumptionFileSystem` port.
 *
 * This is the ONLY file in `consumption/` that imports `node:*`. It is exported
 * from `@exawatt/core/server`, not from the package root, so the renderer never
 * pulls it in. Everything else in the slice stays environment-free.
 *
 * Reads are strictly read-only: `open(path, 'r')`, never a write, never a
 * mutation of anything under `~/.claude` or `~/.codex`.
 */
import { createReadStream, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import type {
  ConsumptionChunk,
  ConsumptionFileRef,
  ConsumptionFileSystem,
} from './ports';

export interface NodeConsumptionFsOptions {
  /** Only files whose name matches are listed. */
  match?: (fileName: string, fullPath: string) => boolean;
  /** Guard against a pathological tree. */
  maxFiles?: number;
}

const DEFAULT_MAX_FILES = 20_000;

export class NodeConsumptionFileSystem implements ConsumptionFileSystem {
  constructor(private readonly options: NodeConsumptionFsOptions = {}) {}

  async listFiles(root: string): Promise<ConsumptionFileRef[]> {
    const resolved = expandHome(root);
    const out: ConsumptionFileRef[] = [];
    const match =
      this.options.match ?? ((name: string) => name.endsWith('.jsonl'));
    const limit = this.options.maxFiles ?? DEFAULT_MAX_FILES;
    const queue: string[] = [resolved];
    while (queue.length > 0 && out.length < limit) {
      const directory = queue.pop()!;
      let entries;
      try {
        entries = await fsp.readdir(directory, { withFileTypes: true });
      } catch {
        // A root that does not exist means the harness is not installed.
        continue;
      }
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          queue.push(full);
          continue;
        }
        if (!entry.isFile() || !match(entry.name, full)) continue;
        try {
          const stat = await fsp.stat(full);
          out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          // Harness files rotate and disappear mid-scan.
        }
      }
    }
    return out;
  }

  async readFrom(
    path: string,
    fromByte: number
  ): Promise<ConsumptionChunk | null> {
    try {
      const stat = await fsp.stat(path);
      if (fromByte >= stat.size) {
        return { text: '', fromByte, toByte: fromByte };
      }
      const stream = createReadStream(path, {
        start: fromByte,
        encoding: 'utf8',
      });
      const parts: string[] = [];
      let bytes = 0;
      for await (const part of stream) {
        parts.push(part as string);
        bytes += Buffer.byteLength(part as string, 'utf8');
      }
      return { text: parts.join(''), fromByte, toByte: fromByte + bytes };
    } catch {
      return null;
    }
  }
}

export function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith(`~${sep}`) || value.startsWith('~/')) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

/** `EXAWATT_CLAUDE_PROJECTS_ROOT` mirrors the conversation-catalog override. */
export function defaultClaudeConsumptionRoot(
  env: Record<string, string | undefined> = process.env
): string {
  return env.EXAWATT_CLAUDE_PROJECTS_ROOT ?? join(homedir(), '.claude', 'projects');
}

/** `EXAWATT_CODEX_SESSIONS_ROOT` mirrors the conversation-catalog override. */
export function defaultCodexConsumptionRoot(
  env: Record<string, string | undefined> = process.env
): string {
  return env.EXAWATT_CODEX_SESSIONS_ROOT ?? join(homedir(), '.codex', 'sessions');
}
