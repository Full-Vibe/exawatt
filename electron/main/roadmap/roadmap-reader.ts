import * as fs from 'fs';
import * as path from 'path';

/**
 * Roadmap file discovery + read for the roadmap lens (ENG-017).
 *
 * Main stays a dumb, validated file reader: discovery order and byte
 * limits live here; the convention grammar is parsed renderer-side in
 * `@exawatt/core` (decision 0011). Order matches the published spec in
 * `docs/product/reference/roadmap-convention.md`.
 */
export const ROADMAP_DISCOVERY_ORDER = [
  'ROADMAP.md',
  'docs/engineering/roadmap.md',
  'docs/ROADMAP.md',
  'roadmap.md',
] as const;

/** Roadmaps are documents, not databases; 1 MiB is beyond any honest one. */
const MAX_ROADMAP_BYTES = 1024 * 1024;

export type RoadmapReadResult =
  | { status: 'ok'; file: string; text: string; mtimeMs: number }
  | { status: 'none'; checked: string[] }
  | { status: 'error'; error: string };

function assertValidProjectDir(projectDir: string): void {
  if (
    !projectDir ||
    projectDir.includes('\0') ||
    projectDir.length > 4096 ||
    !path.isAbsolute(projectDir)
  ) {
    throw new Error('Invalid project directory');
  }
}

export async function readRoadmap(projectDir: string): Promise<RoadmapReadResult> {
  assertValidProjectDir(projectDir);
  const root = path.resolve(projectDir);
  for (const candidate of ROADMAP_DISCOVERY_ORDER) {
    const resolved = path.resolve(root, candidate);
    if (!resolved.startsWith(root + path.sep)) continue;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(resolved);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_ROADMAP_BYTES) {
      return { status: 'error', error: `${candidate} exceeds the 1 MiB roadmap limit` };
    }
    try {
      const text = await fs.promises.readFile(resolved, 'utf8');
      return { status: 'ok', file: candidate, text, mtimeMs: stat.mtimeMs };
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { status: 'none', checked: [...ROADMAP_DISCOVERY_ORDER] };
}
