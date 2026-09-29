import { describe, expect, it, vi } from 'vitest';
import type { PtyPowerControl } from '@exawatt/core/desktop-bridge';

const fixture = vi.hoisted(() => ({
  probe: vi.fn(),
  commands: [] as string[][],
  environments: [] as NodeJS.ProcessEnv[],
  exits: [] as Array<() => void>,
}));
vi.mock('./harness-power-control', () => ({
  probeHarnessPowerControl: fixture.probe,
}));
vi.mock('./resume-candidates', () => ({
  listResumeCandidates: vi.fn(async () => []),
  invalidateResumeCandidates: vi.fn(),
}));
vi.mock('node-pty', () => ({
  spawn: (
    _shell: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv }
  ) => {
    fixture.commands.push(args);
    fixture.environments.push(options.env);
    return {
      pid: 4242,
      onData: () => ({ dispose() {} }),
      onExit: (listener: (event: { exitCode: number }) => void) => {
        fixture.exits.push(() => listener({ exitCode: 0 }));
        return { dispose() {} };
      },
      write() {},
      resize() {},
      kill() {},
    };
  },
}));
const { PtySessionManager } = await import('./session-manager');

describe('power evidence belongs to the process', () => {
  it('re-probes a replacement and does not inherit previous launch control', async () => {
    const applied: PtyPowerControl = {
      state: 'applied-at-launch',
      mechanism: 'codex-prevent-idle-sleep',
      executable: '/opt/verified-codex',
      version: '0.156.1',
      observedAt: 1,
    };
    fixture.probe.mockResolvedValueOnce(applied).mockResolvedValueOnce({
      state: 'unknown',
      reason: 'Control probe failed',
    });
    const manager = new PtySessionManager();
    const original = await manager.create({
      harness: 'codex',
      cwd: process.cwd(),
      durableSessionId: 'power-session',
    });
    expect(original.powerControl).toEqual(applied);
    expect(fixture.probe.mock.calls[0][0].env).toBe(fixture.environments[0]);
    expect(fixture.commands[0].at(-1)).toContain(
      "'/opt/verified-codex' --disable prevent_idle_sleep"
    );
    fixture.exits[0]();
    const replacement = await manager.create({
      harness: 'codex',
      cwd: process.cwd(),
      durableSessionId: original.durableSessionId,
      resumeSessionId: 'session123',
    });
    expect(replacement.id).not.toBe(original.id);
    expect(replacement.powerControl?.state).toBe('unknown');
    expect(fixture.commands[1].at(-1)).not.toContain('--disable');
    expect(fixture.probe).toHaveBeenCalledTimes(2);
    expect(
      manager.list().find(row => row.id === replacement.id)?.powerControl
    ).toEqual(replacement.powerControl);
    fixture.exits[1]();
  });
});
