import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionOrigins,
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

async function listenOnAStablePort(
  server: net.Server,
  host = '127.0.0.1'
): Promise<number> {
  for (let port = 20_000; port < 20_200; port += 1) {
    const bound = await new Promise<boolean>(resolve => {
      server.once('error', () => resolve(false));
      server.listen(port, host, () => resolve(true));
    });
    if (bound) return port;
  }
  throw new Error('No stable-range port could be held for the probe test');
}

/** A machine whose busy ports the test names; every other port is free. */
function machine(
  overrides: Partial<RendererPortPolicyDependencies> & {
    busy?: number[];
    unknown?: number[];
  } = {}
) {
  const busy = new Set(overrides.busy ?? []);
  const unknown = new Set(overrides.unknown ?? []);
  const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  let osPort = 50_000;
  const deps: RendererPortPolicyDependencies = {
    userDataPath: () => userData,
    record: (event, fields) => events.push({ event, fields }),
    probe: async port =>
      unknown.has(port) ? 'unknown' : busy.has(port) ? 'taken' : 'free',
    anyFreePort: async () => ++osPort,
    // 0.25 of the way through the stable range, every time.
    random: () => 0.25,
    ...overrides,
  };
  return {
    busy,
    unknown,
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
      probe: async () => 'free',
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

  // BUG-232: a record that exists but cannot be read is not a missing one.
  // Re-homing on it would overwrite the record and orphan the storage kept
  // under its origin, so the launch is served temporarily and writes nothing.
  it.each([
    [
      'without permission to read it',
      () => fs.chmodSync(file(), 0o000),
      () => fs.chmodSync(file(), 0o600),
    ],
    [
      'when its path cannot be read as a file',
      () => {
        fs.renameSync(file(), `${file()}.aside`);
        fs.mkdirSync(file());
      },
      () => {
        fs.rmdirSync(file());
        fs.renameSync(`${file()}.aside`, file());
      },
    ],
  ])(
    'serves a temporary port and keeps the record when it cannot be read %s',
    async (_case, damage, repair) => {
      const { launch, events } = machine();
      const home = await launch();
      damage();

      const temporary = await launch();

      expect(temporary).not.toBe(home);
      expect(events.map(entry => entry.event)).toEqual([
        'renderer.port.inaccessible',
      ]);
      repair();
      expect(kept()).toEqual({ port: home, consecutiveFallbacks: 0 });
      expect(await launch()).toBe(home);
    }
  );

  it('serves a temporary port, and counts nothing, when the kept port cannot be probed', async () => {
    const { launch, unknown, events } = machine();
    const home = await launch();
    unknown.add(home);

    for (let i = 0; i < 4; i += 1) {
      expect(await launch()).not.toBe(home);
    }

    expect(kept()).toEqual({ port: home, consecutiveFallbacks: 0 });
    expect(new Set(events.map(entry => entry.event))).toEqual(
      new Set(['renderer.port.probe-failed'])
    );
    unknown.delete(home);
    expect(await launch()).toBe(home);
  });

  it('never keeps a new candidate that cannot be probed', async () => {
    const draws = [0, 0.5];
    const { launch } = machine({
      unknown: [20_000],
      random: () => draws.shift() ?? 0.5,
    });

    expect(await launch()).toBe(20_000 + Math.floor(0.5 * 12_768));
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
    const { launch } = machine({ probe: async () => 'taken' });

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

  // macOS lets 127.0.0.1:<port> bind while another program listens on the
  // wildcard address, and the more specific bind then takes that program's
  // loopback traffic. A port someone answers on is taken, whatever binds.
  it.each(['0.0.0.0', '::', '127.0.0.1'])(
    'counts a kept port as taken while another program listens on %s',
    async host => {
      const holder = net.createServer();
      const heldPort = await listenOnAStablePort(holder, host);
      try {
        fs.writeFileSync(
          file(),
          JSON.stringify({ port: heldPort, consecutiveFallbacks: 0 })
        );
        const events: string[] = [];
        const policy = createRendererPortPolicy({
          userDataPath: () => userData,
          anyFreePort: async () => 1,
          record: event => events.push(event),
        });

        expect(await policy.allocate()).toBe(1);
        expect(events).toEqual(['renderer.port.fallback']);
      } finally {
        await new Promise(resolve => holder.close(resolve));
      }
    }
  );

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

/**
 * BUG-170: every launch before BUG-022 served a new origin and left its
 * storage on disk, unreadable by any later launch. The policy that knows
 * which origin is live sweeps every other one, once, after a launch has
 * served from the kept port, and again only after a launch made another.
 */
/**
 * Electron's `session.clearData` over storage the test names, honouring the
 * documented options: `origins` clears only those, `excludeOrigins` clears
 * every other, neither clears everything.
 */
function storageSession(origins: string[]) {
  const stored = new Set(origins);
  return {
    stored,
    clearData: async (options: {
      dataTypes?: string[];
      origins?: string[];
      excludeOrigins?: string[];
    }) => {
      const only = options.origins ? new Set(options.origins) : null;
      const except = new Set(options.excludeOrigins ?? []);
      for (const origin of Array.from(stored)) {
        if (only ? only.has(origin) : !except.has(origin)) {
          stored.delete(origin);
        }
      }
    },
  };
}

describe('sweepDeadOrigins', () => {
  function sweeping(
    overrides: Partial<RendererPortPolicyDependencies> = {},
    origins: string[] = []
  ) {
    const busy = new Set<number>();
    const events: Array<{ event: string; fields?: Record<string, unknown> }> =
      [];
    const session = storageSession(origins);
    let sweeps = 0;
    let osPort = 50_000;
    return {
      busy,
      events,
      session,
      sweeps: () => sweeps,
      /** One launch, served, then its post-start housekeeping. */
      launchAndSweep: async (
        deps: Partial<RendererPortPolicyDependencies> = {}
      ) => {
        const policy = createRendererPortPolicy({
          userDataPath: () => userData,
          probe: async port => (busy.has(port) ? 'taken' : 'free'),
          anyFreePort: async () => ++osPort,
          random: () => 0.25,
          record: (event, fields) => events.push({ event, fields }),
          clearOrigins: async dead => {
            sweeps += 1;
            await clearSessionOrigins(session, dead);
          },
          ...overrides,
          ...deps,
        });
        const port = await policy.allocate();
        await policy.serving(port);
        await policy.sweepDeadOrigins();
        return port;
      },
    };
  }

  // Review of 0.1.22: the sweep cleared every origin but two, so a worktree
  // dev server's storage, or any site's in the shared default session, went
  // with the dead launches'.
  it("clears only the packaged server's abandoned origins", async () => {
    fs.writeFileSync(
      file(),
      JSON.stringify({ port: 21_000, consecutiveFallbacks: 0 })
    );
    const live = [
      'http://127.0.0.1:21000',
      'http://localhost:7000',
      'http://localhost:4317',
      'http://localhost:54123',
      'http://127.0.0.1:3000',
      'https://accounts.example.com',
    ];
    const dead = [
      // A launch before BUG-022, or a fallback: an OS-assigned port.
      'http://127.0.0.1:54123',
      'http://127.0.0.1:61001',
      // A port kept before a re-home.
      'http://127.0.0.1:24567',
    ];
    const { launchAndSweep, session } = sweeping({}, [...live, ...dead]);

    expect(await launchAndSweep()).toBe(21_000);

    expect(Array.from(session.stored).sort()).toEqual([...live].sort());
  });

  it('sweeps once, on the first launch to serve from the kept port', async () => {
    const { launchAndSweep, sweeps } = sweeping();

    const home = await launchAndSweep();

    expect(sweeps()).toBe(1);
    expect(kept()).toEqual({
      port: home,
      consecutiveFallbacks: 0,
      deadOriginsSwept: true,
    });
    await launchAndSweep();
    await launchAndSweep();
    expect(sweeps()).toBe(1);
  });

  it('sweeps an install that kept its port before the sweep existed', async () => {
    fs.writeFileSync(
      file(),
      JSON.stringify({ port: 21_000, consecutiveFallbacks: 0 })
    );
    const { launchAndSweep, sweeps } = sweeping();

    expect(await launchAndSweep()).toBe(21_000);

    expect(sweeps()).toBe(1);
  });

  it('never sweeps from a fallback launch, and sweeps its origin once the kept port is back', async () => {
    const { launchAndSweep, sweeps, busy, session } = sweeping();
    const home = await launchAndSweep();
    busy.add(home);

    const fallback = await launchAndSweep();
    session.stored.add(`http://127.0.0.1:${home}`);
    session.stored.add(`http://127.0.0.1:${fallback}`);

    expect(fallback).not.toBe(home);
    expect(sweeps()).toBe(1);
    expect(kept()).toEqual({ port: home, consecutiveFallbacks: 1 });

    busy.delete(home);
    expect(await launchAndSweep()).toBe(home);
    expect(sweeps()).toBe(2);
    expect(Array.from(session.stored)).toEqual([`http://127.0.0.1:${home}`]);
    expect(kept()).toEqual({
      port: home,
      consecutiveFallbacks: 0,
      deadOriginsSwept: true,
    });
  });

  it('never sweeps when the record cannot be read', async () => {
    const { launchAndSweep, sweeps } = sweeping();
    const home = await launchAndSweep();
    fs.writeFileSync(
      file(),
      JSON.stringify({ port: home, consecutiveFallbacks: 0 })
    );
    fs.chmodSync(file(), 0o000);
    try {
      expect(await launchAndSweep()).not.toBe(home);
    } finally {
      fs.chmodSync(file(), 0o600);
    }

    expect(sweeps()).toBe(1);
    expect(kept()).toEqual({ port: home, consecutiveFallbacks: 0 });
  });

  it('marks nothing swept when the sweep fails, and tries again next launch', async () => {
    const { launchAndSweep, sweeps, events } = sweeping();
    const home = await launchAndSweep({
      clearOrigins: async () => {
        throw new Error('storage busy');
      },
    });

    expect(kept()).toEqual({ port: home, consecutiveFallbacks: 0 });
    expect(events).toContainEqual({
      event: 'renderer.origins.sweep-failed',
      fields: { keptPort: home, error: 'storage busy' },
    });

    await launchAndSweep();
    expect(sweeps()).toBe(1);
    expect(kept().deadOriginsSwept).toBe(true);
  });
});
