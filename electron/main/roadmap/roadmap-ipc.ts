import { handleTrusted } from '../ipc-security';
import { readRoadmap } from './roadmap-reader';

/**
 * Roadmap lens IPC (ENG-017). Read-only by design: main never writes a
 * roadmap file. Parsing happens renderer-side in `@exawatt/core`.
 */
export function registerRoadmapIPC(): void {
  handleTrusted('roadmap:read', (_event, projectDir: string) =>
    readRoadmap(projectDir)
  );
}
