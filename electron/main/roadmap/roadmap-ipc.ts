import { handleTrusted } from '../ipc-security';
import { readRoadmap } from './roadmap-reader';
import { readSessionEvidence } from './roadmap-evidence';
import { readRoadmapActivity } from './roadmap-activity';
import { undoRoadmapState, writeRoadmapState } from './roadmap-writer';
import { unwatchRoadmap, watchRoadmap } from './roadmap-watcher';

/**
 * Roadmap lens IPC (ENG-017). Reads remain parser-owned in the renderer.
 * Decision 0035 adds one narrow main-process write boundary for declared
 * roadmaps: sequence and state only, compare-before-write, never git.
 */
export function registerRoadmapIPC(): void {
  handleTrusted('roadmap:read', (_event, projectDir: string) =>
    readRoadmap(projectDir)
  );
  handleTrusted('roadmap:session-evidence', (_event, cwd: string) =>
    readSessionEvidence(cwd)
  );
  handleTrusted('roadmap:activity', (_event, projectDir: string) =>
    readRoadmapActivity(projectDir)
  );
  handleTrusted('roadmap:write-state', (_event, request: unknown) =>
    writeRoadmapState(request)
  );
  handleTrusted('roadmap:undo-state', (_event, token: string) =>
    undoRoadmapState(token)
  );
  handleTrusted('roadmap:watch', (_event, projectDir: string) =>
    watchRoadmap(projectDir)
  );
  handleTrusted('roadmap:unwatch', (_event, projectDir: string) =>
    unwatchRoadmap(projectDir)
  );
}
