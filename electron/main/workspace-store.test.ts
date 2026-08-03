import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergeHarnessIdentities, WorkspaceStore } from './workspace-store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(root => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe('WorkspaceStore', () => {
  it('persists overlapping saves in invocation order with private permissions', async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'exawatt-workspace-')
    );
    roots.push(root);
    const file = path.join(root, 'workspace.json');
    const store = new WorkspaceStore(file);

    const older = store.save({ revision: 1, payload: 'x'.repeat(2_000_000) });
    const newer = store.save({ revision: 2 });
    const loaded = store.load();
    await Promise.all([older, newer]);

    await expect(loaded).resolves.toEqual({ revision: 2 });
    expect((await fs.promises.stat(file)).mode & 0o777).toBe(0o600);
    expect(
      (await fs.promises.readdir(root)).some(name => name.includes('.tmp-'))
    ).toBe(false);
  });
});

/**
 * ENG-027 W1 review fixes (finding 4): when no renderer owns workspace state
 * at quit (scope-gated tenant, /settings, Fleet altitude), main merges the
 * settled harness identities into the persisted store itself. The merge must
 * touch only `projects[].tabs[].harnessSessionId`, defensively.
 */
describe('mergeHarnessIdentities', () => {
  const live = new Map([
    ['durable-a', 'harness-a-new'],
    ['durable-b', 'harness-b'],
  ]);

  it('updates stale harness ids and reports change', () => {
    const state = {
      version: 3,
      projects: [
        {
          tabs: [
            {
              durableSessionId: 'durable-a',
              harnessSessionId: 'harness-a-old',
            },
            { durableSessionId: 'durable-b', harnessSessionId: 'harness-b' },
          ],
        },
      ],
    };
    expect(mergeHarnessIdentities(state, live)).toBe(true);
    expect(state.projects[0].tabs[0].harnessSessionId).toBe('harness-a-new');
    expect(state.projects[0].tabs[1].harnessSessionId).toBe('harness-b');
  });

  it('fills a missing harness id for a live durable session', () => {
    const state = {
      projects: [{ tabs: [{ durableSessionId: 'durable-b' }] }],
    };
    expect(mergeHarnessIdentities(state, live)).toBe(true);
    expect(
      (state.projects[0].tabs[0] as { harnessSessionId?: string })
        .harnessSessionId
    ).toBe('harness-b');
  });

  it('reports no change when identities already match or nothing maps', () => {
    const state = {
      projects: [
        {
          tabs: [
            { durableSessionId: 'durable-b', harnessSessionId: 'harness-b' },
            { durableSessionId: 'durable-unknown', harnessSessionId: 'x' },
          ],
        },
      ],
    };
    expect(mergeHarnessIdentities(state, live)).toBe(false);
    expect(state.projects[0].tabs[1].harnessSessionId).toBe('x');
  });

  it('tolerates every malformed shape without throwing', () => {
    expect(mergeHarnessIdentities(null, live)).toBe(false);
    expect(mergeHarnessIdentities('junk', live)).toBe(false);
    expect(mergeHarnessIdentities({}, live)).toBe(false);
    expect(mergeHarnessIdentities({ projects: 'junk' }, live)).toBe(false);
    expect(
      mergeHarnessIdentities({ projects: [null, { tabs: 'junk' }] }, live)
    ).toBe(false);
    expect(
      mergeHarnessIdentities(
        { projects: [{ tabs: [null, { durableSessionId: 7 }] }] },
        live
      )
    ).toBe(false);
  });

  it('preserves everything else of the renderer-owned shape', () => {
    const state = {
      version: 3,
      activeProjectId: 'p1',
      projects: [
        {
          id: 'p1',
          layout: { split: 0.4 },
          tabs: [
            {
              durableSessionId: 'durable-a',
              harnessSessionId: 'stale',
              title: 'keep me',
            },
          ],
        },
      ],
    };
    mergeHarnessIdentities(state, live);
    expect(state.version).toBe(3);
    expect(state.activeProjectId).toBe('p1');
    expect(state.projects[0].layout).toEqual({ split: 0.4 });
    expect(state.projects[0].tabs[0].title).toBe('keep me');
  });
});
