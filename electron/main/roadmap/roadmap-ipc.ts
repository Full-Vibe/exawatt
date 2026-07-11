import { handleTrusted } from '../ipc-security';
import { readRoadmap } from './roadmap-reader';
import { readSessionEvidence } from './roadmap-evidence';

/**
 * Roadmap lens IPC (ENG-017). Read-only by design: main never writes a
 * roadmap file. Parsing and link inference happen renderer-side in
 * `@exawatt/core`; main only reads files and runs scoped git queries.
 */
export function registerRoadmapIPC(): void {
  handleTrusted('roadmap:read', (_event, projectDir: string) =>
    readRoadmap(projectDir)
  );
  handleTrusted('roadmap:session-evidence', (_event, cwd: string) =>
    readSessionEvidence(cwd)
  );
}
