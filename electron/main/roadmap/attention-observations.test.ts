import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import type {
  PtySessionRecord,
  RoadmapReadResult,
} from '@exawatt/core/desktop-bridge';
import { AttentionMonitor } from '../pty/attention-monitor';
import type { PtySessionManager } from '../pty/session-manager';
import { RoadmapAttentionObservations } from './attention-observations';

const session: PtySessionRecord = {
  id: 'runtime',
  durableSessionId: 'durable',
  harness: 'codex',
  harnessSessionId: 'provider',
  title: 'Purpose',
  cwd: '/project',
  projectDir: '/project',
  projectName: 'Project',
  cols: 80,
  rows: 24,
  startedAt: 0,
  lastDataAt: 0,
  exited: false,
  exitCode: null,
};
const file = (text: string): RoadmapReadResult => ({
  status: 'ok',
  file: '/project/ROADMAP.md',
  text,
  mtimeMs: 1,
});
function harness() {
  let nextRead = file('blocked');
  const manager = Object.assign(new EventEmitter(), { list: () => [session] });
  const monitor = new AttentionMonitor();
  monitor.attach(manager as unknown as PtySessionManager);
  const alerts: string[] = [];
  monitor.on('alert', (_id, signal) => alerts.push(signal.kind));
  const owner = new RoadmapAttentionObservations({
    read: async () => nextRead,
    sessions: () => [session],
    update: (id, ids) => monitor.updateRoadmapRequests(id, ids),
  });
  const observation = async (itemIds = ['ENG-015']) => {
    const result = await owner.read('/project');
    if (result.status === 'error')
      throw new Error('test needs a successful read');
    return {
      projectDir: '/project',
      observationToken: result.observationToken!,
      sessions: [
        {
          sessionId: session.id,
          durableSessionId: session.durableSessionId,
          itemIds,
        },
      ],
    };
  };
  return {
    owner,
    monitor,
    alerts,
    observation,
    read: (result: RoadmapReadResult) => {
      nextRead = result;
    },
  };
}

describe('roadmap attention custody', () => {
  it('alerts a genuinely new first observation once across mounts and duplicate windows', async () => {
    const h = harness();
    expect(await h.owner.publish(await h.observation())).toBe(true);
    expect(await h.owner.publish(await h.observation())).toBe(true);
    expect(h.alerts).toEqual(['roadmap-blocked']);
    h.monitor.setWindowFocused(true);
    h.monitor.setFocus(session.id);
    await h.owner.publish(await h.observation());
    expect(h.monitor.get(session.id)?.unread).toBe(false);
    expect(h.alerts).toHaveLength(1);
  });

  it('restores source request receipts without suppressing a different newly observed item', async () => {
    const before = harness();
    await before.owner.publish(await before.observation());
    before.monitor.setWindowFocused(true);
    before.monitor.setFocus(session.id);
    const after = harness();
    after.monitor.restore(session.id, before.monitor.get(session.id)!);
    await after.owner.publish(await after.observation());
    expect(after.monitor.get(session.id)?.unread).toBe(false);
    expect(after.alerts).toEqual([]);
    await after.owner.publish(await after.observation(['ENG-036']));
    expect(after.alerts).toEqual(['roadmap-blocked']);
  });

  it('resolves only this producer and alerts a later re-block of the same item', async () => {
    const h = harness();
    h.monitor.noteHarnessBlocked(session.id, 'working', 'question');
    await h.owner.publish(await h.observation());
    h.read(file('clear'));
    await h.owner.publish(await h.observation([]));
    expect(h.monitor.get(session.id)).toMatchObject({
      kind: 'blocked',
      requestId: 'question',
    });
    h.read(file('blocked again'));
    await h.owner.publish(await h.observation());
    expect(h.alerts).toEqual(['blocked', 'roadmap-blocked', 'roadmap-blocked']);
  });

  it('preserves roadmap receipts through harness boundaries and restores operator reminders silently', async () => {
    const h = harness();
    await h.owner.publish(await h.observation());
    h.monitor.setWindowFocused(true);
    h.monitor.setFocus(session.id);
    h.monitor.noteHarnessBlocked(session.id, 'blocking', 'permission');
    h.monitor.noteHarnessTurnStart(session.id);
    h.monitor.noteHarnessUnblocked(session.id);
    h.monitor.noteHarnessTurnUnknown(session.id);
    expect(h.monitor.get(session.id)).toMatchObject({
      kind: 'roadmap-blocked',
      unread: false,
    });
    h.monitor.noteHarnessTurnEnd(session.id);
    expect(
      h.monitor
        .get(session.id)
        ?.records?.some(record => record.source === 'roadmap')
    ).toBe(true);
    const reminder = harness();
    reminder.monitor.markUnread(session.id);
    const restored = harness();
    restored.monitor.restore(session.id, reminder.monitor.get(session.id)!);
    restored.monitor.noteHarnessTurnStart(session.id);
    restored.monitor.noteHarnessUnblocked(session.id);
    expect(restored.monitor.get(session.id)).toMatchObject({
      kind: 'reminder',
      unread: true,
    });
    expect(restored.alerts).toEqual([]);
    restored.monitor.setWindowFocused(true);
    restored.monitor.setFocus(session.id);
    expect(restored.monitor.get(session.id)?.unread).toBe(false);
  });

  it('never resolves a request from omitted coverage, failed reads, or obsolete tokens', async () => {
    const h = harness();
    const old = await h.observation();
    await h.owner.publish(old);
    await h.owner.publish({ ...old, sessions: [] });
    expect(h.monitor.get(session.id)?.kind).toBe('roadmap-blocked');
    h.read({ status: 'error', error: 'unreadable' });
    await h.owner.read('/project');
    expect(
      await h.owner.publish({
        ...old,
        sessions: [{ ...old.sessions[0], itemIds: [] }],
      })
    ).toBe(false);
    expect(h.monitor.get(session.id)?.kind).toBe('roadmap-blocked');
    h.read(file('newer'));
    const newer = await h.observation();
    expect(
      await h.owner.publish({
        ...old,
        sessions: [{ ...old.sessions[0], itemIds: [] }],
      })
    ).toBe(false);
    expect(await h.owner.publish(newer)).toBe(true);
    expect(h.alerts).toHaveLength(1);
  });

  it('refuses the whole observation when any claimed exact Session is wrong', async () => {
    const h = harness();
    const value = await h.observation();
    expect(
      await h.owner.publish({
        ...value,
        sessions: [
          ...value.sessions,
          { sessionId: 'foreign', durableSessionId: 'other', itemIds: [] },
        ],
      })
    ).toBe(false);
    expect(
      await h.owner.publish({
        ...value,
        sessions: [{ ...value.sessions[0], durableSessionId: 'wrong' }],
      })
    ).toBe(false);
    expect(h.alerts).toEqual([]);
  });

  it('withdraws an observation token when the latest read rejects without resolving attention', async () => {
    let reject = false;
    const updates: string[] = [];
    const owner = new RoadmapAttentionObservations({
      read: async () => {
        if (reject) throw new Error('reader unavailable');
        return file('blocked');
      },
      sessions: () => [session],
      update: id => updates.push(id),
    });
    const result = await owner.read('/project');
    if (result.status === 'error') throw new Error('expected source token');
    const observation = {
      projectDir: '/project',
      observationToken: result.observationToken!,
      sessions: [
        {
          sessionId: session.id,
          durableSessionId: session.durableSessionId,
          itemIds: ['ENG-015'],
        },
      ],
    };
    expect(await owner.publish(observation)).toBe(true);
    reject = true;
    await expect(owner.read('/project')).rejects.toThrow('reader unavailable');
    expect(
      await owner.publish({
        ...observation,
        sessions: [{ ...observation.sessions[0], itemIds: [] }],
      })
    ).toBe(false);
    expect(updates).toEqual([session.id]);
  });

  it('accepts equivalent source content from an older reader after a concurrent lens read completes', async () => {
    const pending: Array<(value: RoadmapReadResult) => void> = [];
    const updates: string[] = [];
    const owner = new RoadmapAttentionObservations({
      read: () => new Promise(resolve => pending.push(resolve)),
      sessions: () => [session],
      update: id => updates.push(id),
    });
    const first = owner.read('/project');
    const second = owner.read('/project');
    pending[0](file('same content'));
    const observed = await first;
    if (observed.status === 'error') throw new Error('expected content token');
    const publishing = owner.publish({
      projectDir: '/project',
      observationToken: observed.observationToken!,
      sessions: [
        {
          sessionId: session.id,
          durableSessionId: session.durableSessionId,
          itemIds: ['ENG-015'],
        },
      ],
    });
    expect(updates).toEqual([]);
    pending[1](file('same content'));
    await second;
    expect(await publishing).toBe(true);
    expect(updates).toEqual([session.id]);
  });

  it('does not authorize an older response that finishes after a newer read', async () => {
    const pending: Array<(value: RoadmapReadResult) => void> = [];
    const owner = new RoadmapAttentionObservations({
      read: () => new Promise(resolve => pending.push(resolve)),
      sessions: () => [session],
      update: () => {},
    });
    const first = owner.read('/project');
    const second = owner.read('/project');
    pending[1](file('newer'));
    const latest = await second;
    pending[0](file('older'));
    const obsolete = await first;
    expect('observationToken' in latest).toBe(true);
    if (obsolete.status === 'error') throw new Error('expected content token');
    expect(
      await owner.publish({
        projectDir: '/project',
        observationToken: obsolete.observationToken!,
        sessions: [],
      })
    ).toBe(false);
  });
});
