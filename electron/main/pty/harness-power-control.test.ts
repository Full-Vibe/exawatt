import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeHarnessPowerControl } from './harness-power-control';

const run = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: run,
  }),
}));

const request = {
  harness: 'codex' as const,
  shell: '/bin/zsh',
  cwd: '/tmp/power project',
};
beforeEach(() => {
  run.mockReset();
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
});
afterEach(() => vi.unstubAllGlobals());

describe('per-launch source sleep control probe', () => {
  it('pins only the executable whose version and override were recognized', async () => {
    run
      .mockResolvedValueOnce({ stdout: '/opt/codex\n' })
      .mockResolvedValueOnce({ stdout: 'codex-cli 0.156.1\n' })
      .mockResolvedValueOnce({
        stdout: 'other stable true\nprevent_idle_sleep experimental false\n',
      });
    const env = {
      ...process.env,
      PATH: '/fixture/bin',
      TERM_PROGRAM: 'fixture',
    };
    const result = await probeHarnessPowerControl({ ...request, env });
    expect(result).toMatchObject({
      state: 'applied-at-launch',
      executable: '/opt/codex',
      version: '0.156.1',
    });
    for (const [shell, args, options] of run.mock.calls) {
      expect(shell).toBe(request.shell);
      expect(args.at(-1)).toContain("cd -- '/tmp/power project'");
      expect(options.cwd).not.toBe(request.cwd);
      expect(options.env).toBe(env);
      expect(options.timeout).toBeGreaterThan(0);
    }
    expect(run.mock.calls[2][1].at(-1)).toContain(
      "'/opt/codex' --disable prevent_idle_sleep features list"
    );
  });

  it.each(['0.155.0', '0.156.2', '9.9.9-fixture'])(
    'does not force a feature on unverified version %s',
    async version => {
      run.mockResolvedValue({ stdout: `codex-cli ${version}` });
      expect(
        await probeHarnessPowerControl({ ...request, executable: '/opt/codex' })
      ).toMatchObject({ state: 'unknown', version });
      expect(run).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    '',
    'prevent_idle_sleep experimental true',
    'prevent_idle_sleep experimental false\nprevent_idle_sleep experimental false',
  ])('requires an unambiguous disabled feature: %s', async stdout => {
    run
      .mockResolvedValueOnce({ stdout: 'codex-cli 0.156.1' })
      .mockResolvedValueOnce({ stdout });
    expect(
      await probeHarnessPowerControl({ ...request, executable: '/opt/codex' })
    ).toMatchObject({ state: 'unknown' });
  });

  it('degrades timeouts/errors to unknown without exposing process output', async () => {
    run.mockRejectedValue(new Error('private stderr'));
    const result = await probeHarnessPowerControl(request);
    expect(result).toMatchObject({
      state: 'unknown',
      reason: 'Control probe failed',
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it.each(['codex is a function', '/opt/codex\nstartup output'])(
    'preserves ambiguous shell resolution as unknown',
    async stdout => {
      run.mockResolvedValue({ stdout });
      expect(await probeHarnessPowerControl(request)).toMatchObject({
        state: 'unknown',
      });
      expect(run).toHaveBeenCalledTimes(1);
    }
  );

  it('preserves a Fish function instead of bypassing it for the PATH binary', async () => {
    run.mockResolvedValueOnce({ stdout: 'function\n' });
    expect(
      await probeHarnessPowerControl({
        ...request,
        shell: '/usr/local/bin/fish',
      })
    ).toMatchObject({ state: 'unknown' });
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][1].at(-1)).toContain("type -t 'codex'");
  });

  it('verifies a plain Fish executable after resolving invocation precedence', async () => {
    run
      .mockResolvedValueOnce({ stdout: 'file\n' })
      .mockResolvedValueOnce({ stdout: '/opt/codex\n' })
      .mockResolvedValueOnce({ stdout: 'codex-cli 0.156.1\n' })
      .mockResolvedValueOnce({
        stdout: 'prevent_idle_sleep experimental false\n',
      });
    expect(
      await probeHarnessPowerControl({
        ...request,
        shell: '/usr/local/bin/fish',
      })
    ).toMatchObject({ state: 'applied-at-launch', executable: '/opt/codex' });
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('does not claim control on an unverified platform', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    expect(await probeHarnessPowerControl(request)).toMatchObject({
      state: 'unknown',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('does not probe excluded, uncontrolled or unverified sources', async () => {
    expect(
      await probeHarnessPowerControl({ ...request, harness: 'shell' })
    ).toEqual({ state: 'not-applicable', reason: 'shell' });
    expect(
      await probeHarnessPowerControl({ ...request, harness: 'claude' })
    ).toMatchObject({ state: 'uncontrolled' });
    expect(
      await probeHarnessPowerControl({ ...request, harness: 'qwen' })
    ).toMatchObject({ state: 'unknown' });
    expect(run).not.toHaveBeenCalled();
  });
});
