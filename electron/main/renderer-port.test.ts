import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRendererPortPolicy,
  type RendererPortPolicyDependencies,
} from './renderer-port';

/**
 * BUG-022: the renderer's origin carries its port, and Chromium scopes
 * `localStorage` by origin. These tests hold the port policy that makes one
 * install keep one origin, and say exactly what a launch that cannot have it
 * does to storage.
 */

let userData: string;
const file = () => path.join(userData, 'renderer-port.json');
const kept = () => JSON.parse(fs.readFileSync(file(), 'utf8'));

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-port-'));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

async function listenOnAStablePort(server: net.Server): Promise<number> {
  for (let port = 20_000; port < 20_200; port += 1) {
    const bound = await new Promise<boolean>(resolve => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (bound) return port;
  }
  throw new Error('No stable-range port could be held for the probe test');
}

/** A machine whose busy ports the test names; every other port is free. */
function machine(
  overrides: Partial<RendererPortPolicyDependencies> & { busy?: number[] } = {}
) {
  const busy = new Set(overrides.busy ?? []);
  const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  let osPort = 50_000;
  const deps: RendererPortPolicyDependencies = {
    userDataPath: () => userData,
    record: (event, fields) => events.push({ event, fields }),
    isFree: async port => !busy.has(port),
    anyFreePort: async () => ++osPort,
    // 0.25 of the way through the stable range, every time.
    random: () => 0.25,
    ...overrides,
  };
  return {
    busy,
    events,
    launch: async () => {
      const policy = createRendererPortPolicy(deps);
      const port = await policy.allocate();
      await policy.serving(port);
      return port;
    },
  };
}

describe('createRendererPortPolicy', () => {
  it('gives a first launch a port in the stable range and keeps it once served', async () => {
    const { launch } = machine();

    const port = await launch();

    expect(port).toBeGreaterThanOrEqual(20_000);
    expect(port).toBeLessThan(32_768);
    expect(kept()).toEqual({ port, consecutiveFallbacks: 0 });
  });

  it('serves every later launch from the same port, so the origin and its storage survive', async () => {
    const { launch } = machine();
    const first = await launch();
    const written = fs.statSync(file()).mtimeMs;

    expect(await launch()).toBe(first);
    expect(await launch()).toBe(first);
    // The common path writes nothing.
    expect(fs.statSync(file()).mtimeMs).toBe(written);
  });

  it('does not record a port before anything has answered on it', async () => {
    const policy = createRendererPortPolicy({
      userDataPath: () => userData,
      isFree: async () => true,
      random: () => 0.5,
    });

    await policy.allocate();

    expect(fs.existsSync(file())).toBe(false);
  });

  it('serves a launch whose kept port is taken from an OS port, and keeps the record for the next launch', async () => {
    const { launch, busy, events } = machine();
    const home = await launch();
    busy.add(home);

    const fallback = await launch();

    expect(fallback).not.toBe(home);
    expect(kept()).toEqual({ port: home, consecutiveFallbacks: 1 });
    expect(events).toContainEqual({
      event: 'renderer.port.fallback',
      fields: { keptPort: home, consecutiveFallbacks: 1 },
    });

    busy.delete(home);
    expect(await launch()).toBe(home);
    expect(kept()).toEqual({ port: home, consecutiveFallbacks: 0 });
  });

  it('re-homes after three launches in a row find the kept port taken', async () => {
    const draws = [0.25, 0.75];
    const { launch, busy, events } = machine({
      random: () => draws[0],
    });
    const home = await launch();
    busy.add(home);
    await launch();
    await launch();
    draws.shift();

    const rehomed = await launch();

    expect(rehomed).not.toBe(home);
    expect(rehomed).toBeGreaterThanOrEqual(20_000);
    expect(rehomed).toBeLessThan(32_768);
    expect(kept()).toEqual({ port: rehomed, consecutiveFallbacks: 0 });
    expect(events.map(entry => entry.event)).toEqual([
      'renderer.port.fallback',
      'renderer.port.fallback',
      'renderer.port.rehome',
    ]);
    expect(await launch()).toBe(rehomed);
  });

  it('says so, and re-homes, when the record cannot be read', async () => {
    fs.writeFileSync(file(), '{not json');
    const { launch, events } = machine();

    const port = await launch();

    expect(kept()).toEqual({ port, consecutiveFallbacks: 0 });
    expect(events).toContainEqual({
      event: 'renderer.port.unreadable',
      fields: { file: 'renderer-port.json' },
    });
  });

  it('treats a record outside the stable range as unreadable, not as a port to serve on', async () => {
    fs.writeFileSync(
      file(),
      JSON.stringify({ port: 80, consecutiveFallbacks: 0 })
    );
    const { launch, events } = machine();

    const port = await launch();

    expect(port).not.toBe(80);
    expect(events.map(entry => entry.event)).toEqual([
      'renderer.port.unreadable',
    ]);
  });

  it('draws another stable candidate when the first is taken', async () => {
    const draws = [0, 0, 0.5];
    const { launch } = machine({
      busy: [20_000],
      random: () => draws.shift() ?? 0.5,
    });

    expect(await launch()).toBe(20_000 + Math.floor(0.5 * 12_768));
  });

  it('serves from an OS port, and keeps nothing, when no stable candidate is free', async () => {
    const { launch } = machine({ isFree: async () => false });

    expect(await launch()).toBe(50_001);
    expect(fs.existsSync(file())).toBe(false);
  });

  it('logs a record it cannot write instead of failing the launch', async () => {
    const blocked = path.join(userData, 'not-a-directory');
    fs.writeFileSync(blocked, '');
    const { launch, events } = machine({
      userDataPath: () => blocked,
    });

    await expect(launch()).resolves.toBeGreaterThan(0);
    expect(events.map(entry => entry.event)).toContain(
      'renderer.port.persist-failed'
    );
  });

  it('probes the real loopback interface by default', async () => {
    const holder = net.createServer();
    const heldPort = await listenOnAStablePort(holder);
    try {
      // Every stable candidate is the held port, so a default probe that works
      // reports each one taken and the launch falls through to an OS port.
      const policy = createRendererPortPolicy({
        userDataPath: () => userData,
        random: () => (heldPort - 20_000 + 0.5) / 12_768,
        anyFreePort: async () => 1,
      });
      expect(await policy.allocate()).toBe(1);
    } finally {
      await new Promise(resolve => holder.close(resolve));
    }
  });
});
