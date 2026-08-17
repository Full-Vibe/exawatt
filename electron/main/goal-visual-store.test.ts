import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ContentStore } from './content-store';
import {
  MAX_GOAL_VISUALS,
  hydrateGoalVisual,
  migrateInlineGoalVisuals,
  referencedGoalVisualKeys,
  retainGoalVisual,
  setGoalVisualStore,
} from './goal-visual-store';
import type { GoalVisual } from './pty/context-summarizer';

/**
 * BUG-031 — the layout is a small-object record and must stay one.
 *
 * The fixture below is the operator's on-disk shape, at his scale: nineteen
 * tabs each carrying a ~265 KB `data:image/jpeg;base64,…` inline in the
 * persisted tab, inside a 4.84 MB `workspace.json`.
 */

const DATA_URL_BYTES = 265_183;

function dataUrl(seed: string): string {
  const base = 'data:image/jpeg;base64,';
  const body = Buffer.from(seed.repeat(64), 'utf8')
    .toString('base64')
    .replace(/[^A-Za-z0-9+/=]/g, 'A');
  return (
    base +
    body
      .repeat(Math.ceil((DATA_URL_BYTES - base.length) / body.length))
      .slice(0, DATA_URL_BYTES - base.length)
  );
}

function visual(seed: string, revision = 2): GoalVisual {
  return {
    identityKey: `identity-${seed}`,
    revision,
    state: 'ready',
    dataUrl: dataUrl(seed),
  };
}

/** A layout in the shape `use-workspace-state.serializeWorkspace` writes. */
function layout(tabs: number, options: { inline: boolean }) {
  return {
    v: 6,
    lastUsedDir: '/w/acme',
    activeDir: '/w/acme',
    pinnedTabId: null,
    recentProjects: [],
    projects: [
      {
        dir: '/w/acme',
        name: 'acme',
        color: '#fff',
        activeTabId: 'tab-0',
        tabs: Array.from({ length: tabs }, (_unused, index) => {
          const image = visual(`v${index}`);
          return {
            id: `tab-${index}`,
            durableSessionId: `durable-${index}`,
            harness: 'claude',
            title: 'Session',
            titleKind: 'derived',
            cwd: '/w/acme',
            sessionId: null,
            harnessSessionId: null,
            roadmapItemId: null,
            lifecycle: 'stopped-clean',
            exitCode: 0,
            initialTask: 'ship it',
            startedAt: 1,
            contextSummary: 'shipping it',
            goalVisual: options.inline
              ? image
              : {
                  identityKey: image.identityKey,
                  revision: image.revision,
                  state: 'ready',
                },
          };
        }),
      },
    ],
  };
}

let directory: string;
let store: ContentStore;

beforeEach(async () => {
  directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-goal-visuals-')
  );
  store = new ContentStore({
    directory: () => directory,
    maxEntries: MAX_GOAL_VISUALS,
    maxBytes: 48 * 1024 * 1024,
  });
  setGoalVisualStore(store);
});

afterEach(async () => {
  setGoalVisualStore(null);
  await fs.promises.rm(directory, { recursive: true, force: true });
});

describe('the layout is a small-object record', () => {
  it('a layout save does not scale with the number of goal visuals', () => {
    const one = JSON.stringify(layout(1, { inline: false })).length;
    const twenty = JSON.stringify(layout(20, { inline: false })).length;
    const perTab = (twenty - one) / 19;

    // Each tab costs its ids and lifecycle, not an image. The old shape cost
    // 265 KB per tab; anything remotely near that is the defect returning.
    expect(perTab).toBeLessThan(1_000);

    // And the whole twenty-tab layout stays far below one visual's payload.
    expect(twenty).toBeLessThan(DATA_URL_BYTES);
  });

  it('the operator-scale inline layout is what the old shape cost', () => {
    // Not an assertion about the fix — a control, so the number the fix is
    // measured against is in the suite rather than in a report.
    expect(JSON.stringify(layout(19, { inline: true })).length).toBeGreaterThan(
      4_000_000
    );
  });
});

describe('migrateInlineGoalVisuals', () => {
  it("moves the operator's inline visuals into the side store and shrinks the layout", async () => {
    const state = layout(19, { inline: true });
    const before = JSON.stringify(state).length;

    const { migrated, bytesReclaimed } = await migrateInlineGoalVisuals(state);

    expect(migrated).toBe(19);
    expect(bytesReclaimed).toBeGreaterThan(4_000_000);
    const after = JSON.stringify(state).length;
    expect(after).toBeLessThan(30_000);
    expect(before / after).toBeGreaterThan(100);
  });

  it('loses nothing: every migrated visual reads back byte-identical', async () => {
    const state = layout(19, { inline: true });
    const expected = new Map(
      state.projects[0].tabs.map(tab => [
        tab.goalVisual.identityKey,
        (tab.goalVisual as GoalVisual).dataUrl,
      ])
    );

    await migrateInlineGoalVisuals(state);

    for (const tab of state.projects[0].tabs) {
      expect((tab.goalVisual as { dataUrl?: unknown }).dataUrl).toBeUndefined();
      const hydrated = await hydrateGoalVisual(tab.goalVisual);
      expect(hydrated?.state).toBe('ready');
      expect(hydrated?.dataUrl).toBe(expected.get(tab.goalVisual.identityKey));
    }
  });

  it('keeps the inline copy when the side store cannot accept it', async () => {
    setGoalVisualStore(
      new ContentStore({
        directory: () => path.join(directory, 'nope', '\0invalid'),
        maxEntries: 4,
        maxBytes: 1,
      })
    );
    const state = layout(2, { inline: true });
    const { migrated } = await migrateInlineGoalVisuals(state);
    expect(migrated).toBe(0);
    expect(
      (state.projects[0].tabs[0].goalVisual as GoalVisual).dataUrl
    ).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('is idempotent — a second pass over a migrated layout moves nothing', async () => {
    const state = layout(3, { inline: true });
    await migrateInlineGoalVisuals(state);
    const second = await migrateInlineGoalVisuals(state);
    expect(second.migrated).toBe(0);
  });
});

describe('hydrateGoalVisual', () => {
  it('degrades to fallback when the pixels are gone, never claims ready', async () => {
    const hydrated = await hydrateGoalVisual({
      identityKey: 'identity-missing',
      revision: 1,
      state: 'ready',
    });
    expect(hydrated).toEqual({
      identityKey: 'identity-missing',
      revision: 1,
      state: 'fallback',
      dataUrl: null,
    });
  });

  it('refuses a shape that is not a reference at all', async () => {
    await expect(hydrateGoalVisual(null)).resolves.toBeNull();
    await expect(hydrateGoalVisual({ revision: 1 })).resolves.toBeNull();
    await expect(
      hydrateGoalVisual({ identityKey: 'k', revision: 'two' })
    ).resolves.toBeNull();
  });

  it('accepts a pre-migration inline visual unchanged', async () => {
    const inline = visual('legacy');
    await expect(hydrateGoalVisual(inline)).resolves.toBe(inline);
  });
});

describe('the side store is bounded and owned', () => {
  it('never grows past the stated entry bound', async () => {
    for (let index = 0; index < MAX_GOAL_VISUALS + 12; index += 1) {
      await retainGoalVisual(visual(`bounded-${index}`));
    }
    const files = (await fs.promises.readdir(directory)).filter(name =>
      name.endsWith('.bin')
    );
    expect(files.length).toBeLessThanOrEqual(MAX_GOAL_VISUALS);
  });

  it('sweeps what the layout no longer references', async () => {
    await retainGoalVisual(visual('kept'));
    await retainGoalVisual(visual('orphan'));
    // Age both past the grace window so the sweep may consider them.
    const aged = Date.now() - 60 * 60_000;
    for (const name of await fs.promises.readdir(directory)) {
      await fs.promises.utimes(
        path.join(directory, name),
        aged / 1000,
        aged / 1000
      );
    }

    const removed = await store.sweep(['identity-kept']);

    expect(removed).toBe(1);
    expect(await store.read('identity-kept')).not.toBeNull();
    expect(await store.read('identity-orphan')).toBeNull();
  });

  it('never sweeps a visual generated between two layout saves', async () => {
    await retainGoalVisual(visual('just-made'));
    expect(await store.sweep([])).toBe(0);
    expect(await store.read('identity-just-made')).not.toBeNull();
  });

  it('writes the same content once', async () => {
    await retainGoalVisual(visual('same'));
    const first = await fs.promises.stat(
      path.join(directory, `${ContentStore.idFor('identity-same')}.bin`)
    );
    await new Promise(resolve => setTimeout(resolve, 12));
    await retainGoalVisual(visual('same', 3));
    const second = await fs.promises.stat(
      path.join(directory, `${ContentStore.idFor('identity-same')}.bin`)
    );
    expect(second.mtimeMs).toBe(first.mtimeMs);
  });

  it('persists nothing for a visual that never became ready', async () => {
    await retainGoalVisual({
      identityKey: 'identity-pending',
      revision: 1,
      state: 'generating',
      dataUrl: null,
    });
    expect(await store.read('identity-pending')).toBeNull();
  });
});

describe('referencedGoalVisualKeys', () => {
  it('reads every identity a persisted layout still names', () => {
    const keys = referencedGoalVisualKeys(layout(3, { inline: false }));
    expect(keys).toEqual(['identity-v0', 'identity-v1', 'identity-v2']);
  });

  it('tolerates every malformed shape', () => {
    expect(referencedGoalVisualKeys(null)).toEqual([]);
    expect(referencedGoalVisualKeys({ projects: 'junk' })).toEqual([]);
    expect(
      referencedGoalVisualKeys({
        projects: [{ tabs: [null, { goalVisual: 7 }] }],
      })
    ).toEqual([]);
  });
});

/**
 * The side store's write path and its eviction owner run concurrently: a
 * visual can be generated at any moment, and every workspace save sweeps.
 * The invariant is narrow and absolute — a key the layout still references is
 * always readable.
 */
describe('writes and sweeps interleave safely', () => {
  it('a referenced key survives a storm of concurrent writes and sweeps', async () => {
    const referenced = [
      'identity-keep-0',
      'identity-keep-1',
      'identity-keep-2',
    ];
    for (const key of referenced) {
      await store.write(key, `data:image/jpeg;base64,${key}`);
    }

    let seed = 20260816;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const operations: Array<Promise<unknown>> = [];
    for (let index = 0; index < 60; index += 1) {
      const roll = random();
      if (roll < 0.4) {
        operations.push(store.sweep(referenced));
      } else if (roll < 0.7) {
        const key = referenced[Math.floor(random() * referenced.length)];
        operations.push(store.write(key, `data:image/jpeg;base64,${key}`));
      } else {
        operations.push(
          store.write(
            `identity-churn-${index}`,
            `data:image/jpeg;base64,${index}`
          )
        );
      }
    }
    await Promise.all(operations);
    await store.sweep(referenced);

    for (const key of referenced) {
      expect(await store.read(key)).toBe(`data:image/jpeg;base64,${key}`);
    }
    // No partial file survives a raced write.
    expect(
      (await fs.promises.readdir(directory)).filter(name =>
        name.includes('.tmp-')
      )
    ).toHaveLength(0);
  });
});
