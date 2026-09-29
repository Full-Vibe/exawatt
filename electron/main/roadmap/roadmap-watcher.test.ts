import type * as fs from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

/** Every `fs.watch` the module opens, and whether it was closed. */
const watches = vi.hoisted(() => ({
  opened: [] as Array<{ closed: boolean }>,
}));
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  const watch = () => {
    const handle = { closed: false };
    watches.opened.push(handle);
    return {
      on: () => undefined,
      close: () => {
        handle.closed = true;
      },
    };
  };
  return { ...actual, default: { ...actual, watch }, watch };
});

/** Discovery the test releases by hand, so calls can interleave with it. */
const discovery = vi.hoisted(() => ({
  pending: [] as Array<(file: string | null) => void>,
}));
vi.mock('./roadmap-reader', () => ({
  ROADMAP_DISCOVERY_ORDER: ['ROADMAP.md'],
  discoverRoadmapPath: () =>
    new Promise<string | null>(resolve => discovery.pending.push(resolve)),
}));

const { disposeRoadmapWatchers, unwatchRoadmap, watchRoadmap } =
  await import('./roadmap-watcher');

function recordWatchers() {
  watches.opened.length = 0;
  return watches.opened;
}

function releaseDiscovery() {
  for (const resolve of discovery.pending.splice(0)) resolve(null);
}

describe('roadmap watching', () => {
  afterEach(() => {
    disposeRoadmapWatchers();
    discovery.pending.length = 0;
    vi.restoreAllMocks();
  });

  it('leaves exactly one open watcher after watch, unwatch, watch', async () => {
    const opened = recordWatchers();

    const first = watchRoadmap('/project');
    unwatchRoadmap('/project');
    const second = watchRoadmap('/project');
    releaseDiscovery();
    await Promise.all([first, second]);

    expect(opened.filter(handle => !handle.closed)).toHaveLength(1);
    disposeRoadmapWatchers();
    expect(opened.filter(handle => !handle.closed)).toHaveLength(0);
  });

  it('opens nothing for a watch that was unwatched while it discovered', async () => {
    const opened = recordWatchers();

    const watching = watchRoadmap('/project');
    unwatchRoadmap('/project');
    releaseDiscovery();
    await watching;

    expect(opened.filter(handle => !handle.closed)).toHaveLength(0);
  });

  it('opens one watcher for two overlapping watches of the same Project', async () => {
    const opened = recordWatchers();

    const both = Promise.all([
      watchRoadmap('/project'),
      watchRoadmap('/project'),
    ]);
    releaseDiscovery();
    await both;

    expect(opened).toHaveLength(1);
  });
});
