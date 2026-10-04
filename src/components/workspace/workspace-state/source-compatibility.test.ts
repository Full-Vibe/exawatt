import { describe, expect, it } from 'vitest';
import { parsePersisted } from './persisted-layout';
import { restoreLayout, resumeIdentityHints } from './layout-restore';
import { serializeLayout } from './layout-serialize';
import { tabCanResumeAsAgent, tabNeedsReconnection } from './workspace-model';
import { tabCanClone } from '../session-clone';
import { sessionTabSource } from '../harnesses';
import { resolveComposerSlot, resolveStageLayout } from '../split-layout';
import { mergeLocalWorkspaceSessions } from '@/lib/fleet/local-workspace-sessions';

const saved = (id: string, harness: string) => ({
  kind: 'session',
  id,
  durableSessionId: `durable-${id}`,
  harness,
  title: `Purpose of ${id}`,
  titleKind: 'operator',
  cwd: '/repo',
  sessionId: null,
  harnessSessionId: `provider-${id}`,
  roadmapItemId: null,
  lifecycle: 'stopped-clean',
  exitCode: null,
  initialTask: `Task for ${id}`,
});
const document = (tabs: unknown[], v = 7) => ({
  v,
  activeDir: '/repo',
  lastUsedDir: '/repo',
  projects: [{ dir: '/repo', name: 'Project', activeTabId: 'unknown', tabs }],
});
function restore(raw: unknown) {
  const decoded = parsePersisted(raw)!;
  const { restored } = restoreLayout(decoded, [], {
    observedIdentities: new Map(),
    previousRunInterrupted: false,
  });
  return { decoded, restored: restored! };
}
const context = {
  recentProjects: [],
  summaries: {},
  goalVisuals: {},
  attention: {},
  cleanShutdown: false,
  shutdownTargets: new Set<string>(),
};

describe('saved source compatibility (BUG-273)', () => {
  it.each([5, 6, 7])('keeps mixed source records usable in layout v%s', v => {
    const unknown = saved('unknown', 'future-source');
    const raw = document([unknown, saved('known', 'claude')], v);
    if (v === 5) Reflect.deleteProperty(unknown, 'titleKind');
    const { decoded, restored } = restore(raw);
    const [unsupported, known] = restored.projects[0].tabs;
    expect(unsupported).toMatchObject({
      harness: unknown.harness,
      title: unknown.title,
      durableSessionId: unknown.durableSessionId,
      harnessSessionId: unknown.harnessSessionId,
      sessionId: null,
      lifecycle: unknown.lifecycle,
    });
    expect(tabCanResumeAsAgent(unsupported)).toBe(false);
    expect(tabNeedsReconnection(unsupported)).toBe(false);
    expect(tabCanClone(unsupported)).toBe(false);
    expect(tabCanResumeAsAgent(known)).toBe(true);
    expect(
      resumeIdentityHints(decoded).map(row => row.durableSessionId)
    ).toEqual(['durable-known']);
    expect(
      mergeLocalWorkspaceSessions([], decoded).map(row => row.sessionKey)
    ).toEqual(['unknown', 'known']);
  });

  it('round-trips raw identity and JSON extensions without letting them override canonical fields', () => {
    const original = {
      ...saved('unknown', '__proto__'),
      vendorContext: { thread: 'opaque', values: [1, null, true] },
    };
    let raw: unknown = document([original]);
    for (let pass = 0; pass < 2; pass++) {
      const { restored } = restore(raw);
      const tab = restored.projects[0].tabs[0];
      if (tab.kind !== 'session') throw new Error('expected local Session');
      tab.sourceRecordExtensions = {
        ...tab.sourceRecordExtensions,
        harness: 'shell',
        lifecycle: 'running',
        constructor: 'unsafe',
      };
      raw = serializeLayout(restored, context);
      const record = (raw as ReturnType<typeof serializeLayout>).projects[0]
        .tabs[0];
      expect(record).toMatchObject({
        harness: original.harness,
        durableSessionId: original.durableSessionId,
        harnessSessionId: original.harnessSessionId,
        vendorContext: original.vendorContext,
      });
      expect(Object.hasOwn(record, 'constructor')).toBe(false);
      expect(Object.hasOwn(record, 'sourceRecordExtensions')).toBe(false);
    }
  });

  it('retains an unsupported draft choice as saved work rather than a replacement composer', () => {
    const raw = document([
      {
        ...saved('unknown', 'claude'),
        lifecycle: 'draft',
        draftSource: 'retired-source',
        draftTask: 'Keep this exact task',
        draftTouched: false,
      },
    ]);
    const { restored } = restore(raw);
    const tab = restored.projects[0].tabs[0];
    if (tab.kind !== 'session') throw new Error('expected local Session');
    expect(tab.draftSource).toBe('retired-source');
    expect(sessionTabSource(tab).harness).toBeNull();
    const entries = [{ tab, dir: '/repo' }];
    const stage = resolveStageLayout({
      entries,
      activeTabId: tab.id,
      emptyProjectStage: false,
      pinnedTabId: null,
      companionTabId: null,
    });
    expect(
      resolveComposerSlot({
        entries,
        stage,
        activeProjectDir: '/repo',
        draftDiscards: 0,
      })
    ).toBeNull();
    const serialized = serializeLayout(restored, context);
    expect(serialized.projects[0].tabs[0]).toMatchObject({
      draftSource: tab.draftSource,
      draftTask: tab.draftTask,
    });
    expect(mergeLocalWorkspaceSessions([], serialized)[0]).toMatchObject({
      harness: tab.draftSource,
    });
  });

  it('still refuses an unknown workspace schema version', () => {
    expect(
      parsePersisted(document([saved('unknown', 'future-source')], 999))
    ).toBeNull();
  });
});
