import { BrowserWindow } from 'electron';
import { checkpointWorkspaceSessionMetadata } from '../workspace-store';
import { broadcastToWindows } from '../window-broadcast';
import { sessionContextSummary } from '../pty-ipc';
import { attentionMonitor } from '../pty/attention-monitor';
import { ptySessions } from '../pty/session-manager';
import { RoadmapAttentionObservations } from './attention-observations';
import { handleTrusted } from '../ipc-security';
import { readRoadmap } from './roadmap-reader';
import { readSessionEvidence } from './roadmap-evidence';
import { readRoadmapActivity } from './roadmap-activity';
import { readRoadmapLandings } from './roadmap-landings';
import { undoRoadmapState, writeRoadmapState } from './roadmap-writer';
import { unwatchRoadmap, watchRoadmap } from './roadmap-watcher';

/**
 * Roadmap lens IPC (ENG-017). Core owns parsing and attribution; main joins current Session evidence.
 * Decision 0035 adds one narrow main-process write boundary for declared
 * roadmaps: sequence and state only, compare-before-write, never git.
 */
export function registerRoadmapIPC(): void {
  const attention = new RoadmapAttentionObservations({
    read: readRoadmap,
    sessions: () =>
      ptySessions.list().map(session => ({
        ...session,
        contextSummary: sessionContextSummary(session.durableSessionId),
        initialTask: ptySessions.initialTask(session.id),
      })),
    update: (id, requestIds) =>
      attentionMonitor.updateRoadmapRequests(id, requestIds),
  });
  handleTrusted('roadmap:read', (_event, projectDir: string) =>
    attention.read(projectDir)
  );
  handleTrusted('roadmap:publish-attention', (_event, observation) =>
    attention.publish(observation)
  );
  handleTrusted(
    'roadmap:assign-session',
    async (_event, id: string, durableSessionId: string, itemId: string) => {
      if (
        typeof id !== 'string' ||
        typeof durableSessionId !== 'string' ||
        typeof itemId !== 'string' ||
        !itemId ||
        itemId.length > 512
      )
        return null;
      const session = ptySessions.assignRoadmapItem(
        id,
        durableSessionId,
        itemId
      );
      if (!session) return null;
      attention.reconcile(session.projectDir, [session.id]);
      await checkpointWorkspaceSessionMetadata();
      const current = ptySessions
        .list()
        .find(
          record =>
            record.id === id && record.durableSessionId === durableSessionId
        );
      if (!current) return null;
      broadcastToWindows(
        BrowserWindow.getAllWindows(),
        'roadmap:session-assigned',
        current
      );
      return current;
    }
  );
  handleTrusted('roadmap:session-evidence', (_event, cwd: string) =>
    readSessionEvidence(cwd)
  );
  // S16: the repository's recent commits and its delivery queue travel on
  // one read; the lens shows a landing state per item from the second.
  handleTrusted('roadmap:activity', async (_event, projectDir: string) => {
    const [changes, landings] = await Promise.all([
      readRoadmapActivity(projectDir),
      readRoadmapLandings(projectDir),
    ]);
    return { changes, landings };
  });
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
