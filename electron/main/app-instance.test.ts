import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import {
  claimAppInstance,
  routeSecondLaunches,
  type BringForwardResult,
} from './app-instance';

/**
 * Electron's `app` as these functions meet it, and no more capable: the lock
 * answers a boolean and notifies the holder by itself, and `exit` ends the
 * process. Electron 43 never makes a process that lost the lock `ready`, so
 * nothing here waits for it.
 */
function fakeApp(holdsLock: boolean) {
  const calls: string[] = [];
  return {
    calls,
    app: {
      requestSingleInstanceLock: () => {
        calls.push('lock');
        return holdsLock;
      },
      exit: (code?: number) => calls.push(`exit:${code}`),
    },
  };
}

const options = {
  productName: 'Exawatt',
  userData: '/Users/someone/Library/Application Support/Exawatt',
};

describe('claimAppInstance', () => {
  it('lets the process that holds the profile lock continue untouched', () => {
    const { app, calls } = fakeApp(true);
    const lines: string[] = [];
    expect(
      claimAppInstance(app, { ...options, report: line => lines.push(line) })
    ).toBe(true);
    expect(calls).toEqual(['lock']);
    expect(lines).toEqual([]);
  });

  it('a second copy over the same profile says where it went, then exits at once', () => {
    const { app, calls } = fakeApp(false);
    const lines: string[] = [];
    expect(
      claimAppInstance(app, { ...options, report: line => lines.push(line) })
    ).toBe(false);
    expect(calls).toEqual(['lock', 'exit:0']);
    expect(lines[0]).toContain(options.userData);
  });
});

describe('routeSecondLaunches', () => {
  it('brings the running window forward for every later launch', () => {
    const events = new EventEmitter();
    const records: Array<[string, Record<string, unknown>]> = [];
    let answer: BringForwardResult = 'focused';
    routeSecondLaunches(
      { on: (event, listener) => events.on(event, listener) },
      {
        bringForward: () => answer,
        record: (event, fields) => records.push([event, fields]),
      }
    );

    events.emit('second-instance', {}, ['/Applications/Exawatt'], '/', null);
    answer = 'quitting';
    events.emit('second-instance', {}, [], '/', null);

    expect(records).toEqual([
      ['instance.second-launch', { presented: 'focused' }],
      ['instance.second-launch', { presented: 'quitting' }],
    ]);
  });
});
