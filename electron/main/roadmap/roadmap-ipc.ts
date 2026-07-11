import { handleTrusted } from '../ipc-security';
import { readRoadmap } from './roadmap-reader';
import { readSessionEvidence } from './roadmap-evidence';
import { unwatchRoadmap, watchRoadmap } from './roadmap-watcher';

/**
 * Roadmap lens IPC (ENG-017). Read-only by design: main never writes a
 * roadmap file. Parsing and link inference happen renderer-side in
 * `@exawatt/core`; main only reads files, watches them, and runs scoped
 * git queries.
 */
export function registerRoadmapIPC(): void {
  handleTrusted('roadmap:read', (_event, projectDir: string) =>
    readRoadmap(projectDir)
  );
  handleTrusted('roadmap:session-evidence', (_event, cwd: string) =>
    readSessionEvidence(cwd)
  );
  handleTrusted('roadmap:watch', (_event, projectDir: string) =>
    watchRoadmap(projectDir)
  );
  handleTrusted('roadmap:unwatch', (_event, projectDir: string) =>
    unwatchRoadmap(projectDir)
  );
}
