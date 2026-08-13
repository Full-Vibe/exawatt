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
    fromByte: number,
    maxBytes?: number
  ): Promise<ConsumptionChunk | null> {
    try {
      const stat = await fsp.stat(path);
      if (fromByte >= stat.size) {
        return { text: '', fromByte, toByte: fromByte };
      }
      // Raw bytes, decoded once at the end: `toByte` must be EXACT so callers
      // can do offset arithmetic, and decoding inside the stream would make a
      // range that splits a multibyte character report the replacement
      // character's byte length instead of the bytes actually read. The
      // replacement character itself is harmless — it can only appear at the
      // very end of a bounded read, after the last newline (a newline is a
      // single byte in UTF-8), so it lands in the unparsed tail.
      const stream = createReadStream(path, {
        start: fromByte,
        // `end` is inclusive.
        ...(maxBytes !== undefined && maxBytes > 0
          ? { end: fromByte + maxBytes - 1 }
          : {}),
      });
      const parts: Buffer[] = [];
      let bytes = 0;
      for await (const part of stream) {
        const buffer = part as Buffer;
        parts.push(buffer);
        bytes += buffer.length;
      }
      return {
        text: Buffer.concat(parts).toString('utf8'),
        fromByte,
        toByte: fromByte + bytes,
      };
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

/**
 * Grok Build's corpus root.
 *
 * `GROK_HOME` is the harness's OWN override and is honored here, so an
 * operator who relocated their Grok state still sees their consumption.
 * Exawatt never SETS it: relocating the home moves auth, config, folder
 * trust, and the whole session corpus with it (ENG-003 S4).
 */
export function defaultGrokConsumptionRoot(
  env: Record<string, string | undefined> = process.env
): string {
  if (env.EXAWATT_GROK_SESSIONS_ROOT) return env.EXAWATT_GROK_SESSIONS_ROOT;
  if (env.GROK_HOME) return join(env.GROK_HOME, 'sessions');
  return join(homedir(), '.grok', 'sessions');
}
