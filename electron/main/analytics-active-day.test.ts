import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent' },
  BrowserWindow: {},
  powerMonitor: {},
}));

import {
  buildForActiveDay,
  createActiveDayRecorder,
  localDateOf,
  type ActiveDayDependencies,
} from './analytics-active-day';

const BUILD = {
  platform: 'darwin',
  delivery: 'signed',
  appVersion: '0.1.26',
} as const;

function harness(start: Date) {
  let now = start;
  let focused = false;
  let agents = false;
  const claimed = new Set<string>();
  let refuse = false;
  const queued: Parameters<ActiveDayDependencies['queue']>[0][] = [];
  const claimDay = vi.fn((day: string) => {
    if (refuse || claimed.has(day)) return false;
    claimed.add(day);
    return true;
  });
  const recorder = createActiveDayRecorder({
    now: () => now,
    windowFocused: () => focused,
    agentsRunning: () => agents,
    claimDay,
    queue: event => queued.push(event),
    build: BUILD,
  });
  return {
    recorder,
    queued,
    claimDay,
    claimed,
    set: (state: { focused?: boolean; agents?: boolean; now?: Date }) => {
      focused = state.focused ?? focused;
      agents = state.agents ?? agents;
      now = state.now ?? now;
    },
    refuse: (value: boolean) => (refuse = value),
  };
}

describe('app_active, once per local day (ENG-047 F6)', () => {
  it('records nothing while the app is open but unused', () => {
    const h = harness(new Date(2026, 10, 12, 9));
    h.recorder.check();
    expect(h.queued).toEqual([]);
    expect(h.claimDay).not.toHaveBeenCalled();
  });

  it('records the first focus of the day, once, however many checks follow', () => {
    const h = harness(new Date(2026, 10, 12, 9));
    h.set({ focused: true });
    h.recorder.check();
    h.recorder.check();
    h.set({ now: new Date(2026, 10, 12, 23, 59) });
    h.recorder.check();
    expect(h.queued).toEqual([
      { name: 'app_active', ...BUILD, agentsRunning: false },
    ]);
    // After the claim, a check later that day is a date compare, not a read.
    expect(h.claimDay).toHaveBeenCalledTimes(1);
  });

  it('an Agent running in an unfocused app counts, and says so', () => {
    const h = harness(new Date(2026, 10, 12, 9));
    h.set({ agents: true });
    h.recorder.check();
    expect(h.queued).toEqual([
      { name: 'app_active', ...BUILD, agentsRunning: true },
    ]);
  });

  it('an app left running crosses midnight into a new day', () => {
    const h = harness(new Date(2026, 10, 12, 23, 50));
    h.set({ agents: true });
    h.recorder.check();
    h.set({ now: new Date(2026, 10, 13, 0, 0) });
    h.recorder.check();
    expect([...h.claimed]).toEqual(['2026-11-12', '2026-11-13']);
    expect(h.queued).toHaveLength(2);
  });

  it('a day an earlier launch claimed is not recorded again', () => {
    const h = harness(new Date(2026, 10, 12, 9));
    h.claimed.add('2026-11-12');
    h.set({ focused: true });
    h.recorder.check();
    expect(h.queued).toEqual([]);
  });

  it('a refused claim (an unreadable record) is retried at the next trigger', () => {
    const h = harness(new Date(2026, 10, 12, 9));
    h.set({ focused: true });
    h.refuse(true);
    h.recorder.check();
    h.refuse(false);
    h.recorder.check();
    expect(h.queued).toHaveLength(1);
  });

  it('a failure inside a dependency never reaches the app', () => {
    const recorder = createActiveDayRecorder({
      now: () => new Date(2026, 10, 12),
      windowFocused: () => {
        throw new Error('no windows yet');
      },
      agentsRunning: () => false,
      claimDay: () => true,
      queue: () => undefined,
      build: BUILD,
    });
    expect(() => recorder.check()).not.toThrow();
  });
});

describe('the day and the build, as the allowlist names them', () => {
  it('formats the local calendar day', () => {
    expect(localDateOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('maps an unknown platform or delivery to unknown', () => {
    expect(
      buildForActiveDay({
        platform: 'aix',
        delivery: 'nightly',
        appVersion: null,
      })
    ).toEqual({ platform: 'unknown', delivery: 'unknown', appVersion: null });
    expect(
      buildForActiveDay({
        platform: 'darwin',
        delivery: 'dogfood',
        appVersion: '0.1.26',
      })
    ).toEqual({
      platform: 'darwin',
      delivery: 'dogfood',
      appVersion: '0.1.26',
    });
  });
});
