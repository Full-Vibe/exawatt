import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PtyHarness } from './session-manager';

export interface HarnessResumeCandidate {
  id: string;
  cwd: string;
  updatedAt: number;
  label: string;
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

async function canonicalDirectory(directory: string): Promise<string> {
  try {
    return await fs.promises.realpath(directory);
  } catch {
    return path.resolve(directory);
  }
}

function userLabel(lines: string[], id: string): string {
  for (const line of lines.slice(1, 250)) {
    try {
      const record = JSON.parse(line);
      const payload = record?.payload;
      if (record?.type !== 'response_item' || payload?.role !== 'user') continue;
      const text = payload.content
        ?.map((item: { text?: string }) => item.text ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) return text.slice(0, 90);
    } catch {
      // Ignore a malformed line; the session metadata may still be usable.
    }
  }
  return id;
}

export async function listResumeCandidates(
  harness: PtyHarness,
  cwd: string,
  sessionsRoot = path.join(os.homedir(), '.codex', 'sessions')
): Promise<HarnessResumeCandidate[]> {
  if (harness !== 'codex') return [];
  const requestedDirectory = await canonicalDirectory(cwd);
  const canonicalDirectories = new Map<string, Promise<string>>();
  const canonical = (directory: string) => {
    let resolved = canonicalDirectories.get(directory);
    if (!resolved) {
      resolved = canonicalDirectory(directory);
      canonicalDirectories.set(directory, resolved);
    }
    return resolved;
  };
  const files = await jsonlFiles(sessionsRoot);
  const stats = await Promise.all(
    files.map(async file => ({ file, stat: await fs.promises.stat(file) }))
  );
  stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const candidates: HarnessResumeCandidate[] = [];
  for (const { file, stat } of stats.slice(0, 300)) {
    const text = await fs.promises.readFile(file, 'utf8');
    const lines = text.split('\n');
    try {
      const first = JSON.parse(lines[0]);
      const meta = first?.type === 'session_meta' ? first.payload : null;
      const id = meta?.session_id ?? meta?.id;
      if (
        !id ||
        typeof meta?.cwd !== 'string' ||
        (await canonical(meta.cwd)) !== requestedDirectory
      ) {
        continue;
      }
      candidates.push({
        id,
        cwd: meta.cwd,
        updatedAt: stat.mtimeMs,
        label: userLabel(lines, id),
      });
    } catch {
      // Ignore unreadable rollout files.
    }
  }
  return candidates;
}
