/**
 * BUG-031 — the end-to-end path the operator's machine actually takes on the
 * first launch after this change: `loadWorkspace()` moves the inline goal
 * visuals into the side store, rewrites the (now small) layout, and
 * `saveWorkspace()` owns eviction.
 *
 * Mocks only `electron.app.getPath`, so the real stores, the real userData
 * layout, and the real atomic write path are all exercised.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const electronState = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
}));

import { loadWorkspace, saveWorkspace } from './workspace-store';
import { hydrateGoalVisual, setGoalVisualStore } from './goal-visual-store';

const DATA_URL_A = `data:image/jpeg;base64,${'QUJD'.repeat(40_000)}`;
const DATA_URL_B = `data:image/jpeg;base64,${'WERG'.repeat(40_000)}`;

function inlineLayout() {
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
        activeTabId: 'tab-a',
        tabs: [
          {
            id: 'tab-a',
            durableSessionId: 'durable-a',
            harness: 'claude',
            title: 'A',
            cwd: '/w/acme',
            lifecycle: 'stopped-clean',
            goalVisual: {
              identityKey: 'identity-a',
              revision: 2,
              state: 'ready',
              dataUrl: DATA_URL_A,
            },
          },
          {
            id: 'tab-b',
            durableSessionId: 'durable-b',
            harness: 'codex',
            title: 'B',
            cwd: '/w/acme',
            lifecycle: 'stopped-clean',
            goalVisual: {
              identityKey: 'identity-b',
              revision: 1,
              state: 'ready',
              dataUrl: DATA_URL_B,
            },
          },
        ],
      },
    ],
  };
}

const layoutFile = () => path.join(electronState.userData, 'workspace.json');

// One userData for the file: `workspace-store` memoizes its store from
// `app.getPath` on first use, exactly as it does in the real main process.
beforeAll(() => {
  electronState.userData = fs.mkdtempSync(
    path.join(os.tmpdir(), 'exawatt-workspace-migration-')
  );
});

beforeEach(() => {
  for (const name of fs.readdirSync(electronState.userData)) {
    fs.rmSync(path.join(electronState.userData, name), {
      recursive: true,
      force: true,
    });
  }
  setGoalVisualStore(null);
});

afterAll(() => {
  setGoalVisualStore(null);
  fs.rmSync(electronState.userData, { recursive: true, force: true });
});

describe('loadWorkspace migration', () => {
  it('rewrites an inline layout small on first load, keeping every visual', async () => {
    fs.writeFileSync(layoutFile(), JSON.stringify(inlineLayout()), 'utf8');
    const before = fs.statSync(layoutFile()).size;
    expect(before).toBeGreaterThan(300_000);

    const loaded = (await loadWorkspace()) as ReturnType<typeof inlineLayout>;

    // The file on disk shrank, once, without a save from the renderer.
    const after = fs.statSync(layoutFile()).size;
    expect(after).toBeLessThan(2_000);
    expect(before / after).toBeGreaterThan(100);

    // The pixels are in the side store and read back byte-identical.
    const [a, b] = loaded.projects[0].tabs;
    expect((a.goalVisual as { dataUrl?: unknown }).dataUrl).toBeUndefined();
    expect((await hydrateGoalVisual(a.goalVisual))?.dataUrl).toBe(DATA_URL_A);
    expect((await hydrateGoalVisual(b.goalVisual))?.dataUrl).toBe(DATA_URL_B);
    expect(
      fs.readdirSync(path.join(electronState.userData, 'goal-visuals'))
    ).toHaveLength(2);

    // And a second load is a no-op: nothing left inline to move.
    const rewritten = fs.readFileSync(layoutFile(), 'utf8');
    await loadWorkspace();
    expect(fs.readFileSync(layoutFile(), 'utf8')).toBe(rewritten);
  });

  it('returns null for a layout that was never written', async () => {
    await expect(loadWorkspace()).resolves.toBeNull();
  });
});

describe('saveWorkspace eviction', () => {
  it('sweeps a visual the layout stopped referencing', async () => {
    fs.writeFileSync(layoutFile(), JSON.stringify(inlineLayout()), 'utf8');
    const loaded = (await loadWorkspace()) as ReturnType<typeof inlineLayout>;
    const visuals = path.join(electronState.userData, 'goal-visuals');
    // Age them past the grace window that protects a just-generated visual.
    const aged = (Date.now() - 3_600_000) / 1000;
    for (const name of fs.readdirSync(visuals)) {
      fs.utimesSync(path.join(visuals, name), aged, aged);
    }

    // The operator closes the second Session.
    loaded.projects[0].tabs = [loaded.projects[0].tabs[0]];
    await saveWorkspace(loaded);
    // The sweep is fire-and-forget; let its microtasks land.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(fs.readdirSync(visuals)).toHaveLength(1);
    expect(
      (
        await hydrateGoalVisual({
          identityKey: 'identity-a',
          revision: 2,
          state: 'ready',
        })
      )?.dataUrl
    ).toBe(DATA_URL_A);
    expect(
      (
        await hydrateGoalVisual({
          identityKey: 'identity-b',
          revision: 1,
          state: 'ready',
        })
      )?.state
    ).toBe('fallback');
  });
});

/**
 * Interleaving. The migration reads, awaits ~a quarter second of disk writes
 * at the operator's scale, and rewrites. Anything that observes or replaces
 * the file in that gap is a lost save or a lost visual, so the migration runs
 * inside the store's own serialized chain and this proves it.
 */
describe('the migration cannot be interleaved with a save', () => {
  it('a save issued during migration lands AFTER it, and survives', async () => {
    fs.writeFileSync(layoutFile(), JSON.stringify(inlineLayout()), 'utf8');

    const loading = loadWorkspace();
    // Issued while the migration is awaiting its content-store writes.
    const newer = {
      ...inlineLayout(),
      activeDir: '/w/newer',
      projects: [
        { dir: '/w/newer', name: 'newer', activeTabId: null, tabs: [] },
      ],
    };
    const saving = saveWorkspace(newer);
    await Promise.all([loading, saving]);

    const onDisk = JSON.parse(fs.readFileSync(layoutFile(), 'utf8'));
    // The later save wins outright — never a document mixing both.
    expect(onDisk.activeDir).toBe('/w/newer');
    expect(onDisk.projects).toHaveLength(1);
    // And the pixels the migration moved are still in the side store, so a
    // layout that names them again resolves.
    expect(
      (
        await hydrateGoalVisual({
          identityKey: 'identity-a',
          revision: 2,
          state: 'ready',
        })
      )?.dataUrl
    ).toBe(DATA_URL_A);
  });

  it('survives a randomized storm of concurrent loads and saves', async () => {
    fs.writeFileSync(layoutFile(), JSON.stringify(inlineLayout()), 'utf8');
    const operations: Array<Promise<unknown>> = [];
    let seed = 20260816;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let index = 0; index < 40; index += 1) {
      if (random() < 0.5) {
        operations.push(loadWorkspace());
      } else {
        const state = inlineLayout() as ReturnType<typeof inlineLayout> & {
          revision?: number;
        };
        state.revision = index;
        operations.push(saveWorkspace(state));
      }
    }
    await Promise.all(operations);
    await new Promise(resolve => setTimeout(resolve, 60));

    // Whatever won, the file is one complete document, never a torn one, and
    // no temporary file is left behind.
    const raw = fs.readFileSync(layoutFile(), 'utf8');
    const parsed = JSON.parse(raw) as ReturnType<typeof inlineLayout>;
    expect(parsed.projects[0].tabs).toHaveLength(2);
    expect(
      fs.readdirSync(electronState.userData).filter(n => n.includes('.tmp-'))
    ).toHaveLength(0);

    // Every visual either still resolves from the side store or is still
    // inline. Nothing is lost by either path.
    for (const tab of parsed.projects[0].tabs) {
      const hydrated = await hydrateGoalVisual(tab.goalVisual);
      expect(hydrated?.state).toBe('ready');
      expect(hydrated?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    }
  });
});
