import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import {
  claimAppInstance,
  routeSecondLaunches,
  secondLaunchLinks,
  type BringForwardResult,
} from './app-instance';

/**
 * Electron's `app` as these functions meet it, and no more capable: the lock
 * answers a boolean and carries `additionalData` one way, `open-url` arrives
 * as an event before `ready`, and `exit` ends the process.
 */
function fakeApp(holdsLock: boolean) {
  const events = new EventEmitter();
  const requests: Array<Record<string, unknown> | undefined> = [];
  const calls: string[] = [];
  let ready!: () => void;
  const readyPromise = new Promise<void>(resolve => (ready = resolve));
  const app = {
    requestSingleInstanceLock: (data?: Record<string, unknown>) => {
      requests.push(data);
      return holdsLock;
    },
    setActivationPolicy: (policy: string) => calls.push(`policy:${policy}`),
    on: (event: string, listener: (...args: never[]) => void) =>
      events.on(event, listener),
    whenReady: () => readyPromise,
    exit: (code?: number) => calls.push(`exit:${code}`),
  };
  return { app, events, requests, calls, ready };
}

const options = {
  platform: 'darwin' as const,
  productName: 'Exawatt',
  userData: '/Users/someone/Library/Application Support/Exawatt',
};

describe('claimAppInstance', () => {
  it('lets the process that holds the profile lock continue untouched', () => {
    const { app, calls, requests } = fakeApp(true);
    const lines: string[] = [];
    expect(
      claimAppInstance(app, { ...options, report: line => lines.push(line) })
    ).toBe(true);
    expect(requests).toEqual([undefined]);
    expect(calls).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('hands a second copy over: no Dock icon, the links macOS delivered forwarded, then exit', async () => {
    const { app, events, calls, requests, ready } = fakeApp(false);
    const lines: string[] = [];
    expect(
      claimAppInstance(app, { ...options, report: line => lines.push(line) })
    ).toBe(false);
    expect(calls).toEqual(['policy:accessory']);

    let prevented = 0;
    const link = 'exawatt://welcome?w=0f3c';
    events.emit('open-url', { preventDefault: () => (prevented += 1) }, link);
    expect(prevented).toBe(1);
    ready();
    await new Promise(resolve => setImmediate(resolve));

    expect(requests).toEqual([undefined, { links: [link] }]);
    expect(calls).toEqual(['policy:accessory', 'exit:0']);
    expect(lines[0]).toContain(options.userData);
  });

  it('sends no second message when nothing arrived to forward', async () => {
    const { app, requests, calls, ready } = fakeApp(false);
    claimAppInstance(app, { ...options, report: () => undefined });
    ready();
    await new Promise(resolve => setImmediate(resolve));
    expect(requests).toEqual([undefined]);
    expect(calls.at(-1)).toBe('exit:0');
  });
});

describe('secondLaunchLinks', () => {
  it('reads only bounded strings from what another process sent', () => {
    expect(secondLaunchLinks(undefined)).toEqual([]);
    expect(secondLaunchLinks({ links: 'exawatt://welcome' })).toEqual([]);
    expect(
      secondLaunchLinks({
        links: ['exawatt://a', 7, null, `exawatt://${'x'.repeat(5000)}`],
      })
    ).toEqual(['exawatt://a']);
    expect(
      secondLaunchLinks({
        links: Array.from({ length: 20 }, (_, i) => `exawatt://${i}`),
      })
    ).toHaveLength(8);
  });
});

describe('routeSecondLaunches', () => {
  it('brings the running window forward and opens each forwarded link', () => {
    const events = new EventEmitter();
    const order: string[] = [];
    const records: Array<[string, Record<string, unknown>]> = [];
    routeSecondLaunches(
      { on: (event, listener) => events.on(event, listener) },
      {
        bringForward: (): BringForwardResult => {
          order.push('forward');
          return 'focused';
        },
        openLink: url => order.push(url),
        record: (event, fields) => records.push([event, fields]),
      }
    );

    events.emit('second-instance', {}, ['/Applications/Exawatt'], '/', null);
    events.emit('second-instance', {}, [], '/', {
      links: ['exawatt://welcome?w=1'],
    });

    expect(order).toEqual(['forward', 'forward', 'exawatt://welcome?w=1']);
    expect(records).toEqual([
      ['instance.second-launch', { links: 0, presented: 'focused' }],
      ['instance.second-launch', { links: 1, presented: 'focused' }],
    ]);
  });
});
