import { describe, expect, it, vi } from 'vitest';
import type { SafetyControlSettings, SafetyControlsRead } from '@exawatt/core';
import {
  createSafetyGuard,
  enforcedSafetyControls,
  runListing,
} from './safety-guard';
import {
  ListingFailure,
  type Listing,
  type ListingTool,
} from './process-kill-guard';

const HELPER =
  '/Applications/Slack.app/Contents/Frameworks/Slack Helper.app/Contents/MacOS/Slack Helper';

function guardWith(
  controls: SafetyControlSettings | null,
  run: (
    tool: ListingTool,
    args: readonly string[]
  ) => Promise<Listing> = async (tool, args) => {
    if (tool === 'pgrep') return { stdout: '42\n', stderr: '', exitCode: 0 };
    if (args.join(' ').endsWith('comm=')) {
      return { stdout: `   42     1 ${HELPER}`, stderr: '', exitCode: 0 };
    }
    return { stdout: `   42 ${HELPER}`, stderr: '', exitCode: 0 };
  }
) {
  const recorded: Array<[string, Record<string, unknown> | undefined]> = [];
  const runner = vi.fn(run);
  const guard = createSafetyGuard({
    controls: () => controls,
    protectedPids: () => new Set(),
    sessionRootPid: () => null,
    record: (event, fields) => recorded.push([event, fields]),
    run: runner,
    home: '/Users/op',
  });
  return { guard, recorded, run: runner };
}

const bash = (command: string) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command },
});

function reasonOf(decision: Record<string, unknown> | null): string {
  return (decision?.hookSpecificOutput as Record<string, string>)
    .permissionDecisionReason;
}

describe('createSafetyGuard', () => {
  it('answers a refused command with the harness’s deny document and records it', async () => {
    const { guard, recorded } = guardWith({ processKillGuard: true });

    const decision = await guard('pty-3', bash('pkill -f Slack'));

    expect(decision).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
      },
    });
    expect(reasonOf(decision)).toContain('Slack Helper');
    expect(recorded).toEqual([
      [
        'safety.denied',
        expect.objectContaining({
          control: 'processKillGuard',
          session: 'pty-3',
        }),
      ],
    ]);
  });

  it('stops deciding the moment the control is switched off, even for a running agent', async () => {
    const { guard, run, recorded } = guardWith({ processKillGuard: false });

    expect(await guard('pty-3', bash('pkill -f Slack'))).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('keeps judging when the settings cannot be read, because the hook exists only while the control is on', async () => {
    const { guard } = guardWith(null);

    expect(reasonOf(await guard('pty-3', bash('pkill -f Slack')))).toContain(
      'Slack Helper'
    );
  });

  it('refuses a kill it could not check, and records why', async () => {
    const { guard, recorded } = guardWith(
      { processKillGuard: true },
      async () => {
        throw new ListingFailure('pgrep did not answer within 1.5s');
      }
    );

    const decision = await guard('pty-3', bash('pkill -f Slack'));

    expect(reasonOf(decision)).toContain('could not check');
    expect(recorded.map(([event]) => event)).toEqual([
      'safety.undecided',
      'safety.denied',
    ]);
    expect(recorded[0][1]).toMatchObject({
      cause: 'pgrep did not answer within 1.5s',
      outcome: 'refused',
    });
  });

  it('judges only shell commands', async () => {
    const { guard, run } = guardWith({ processKillGuard: true });

    expect(
      await guard('pty-3', {
        tool_name: 'Write',
        tool_input: { command: 'pkill -f Slack' },
      })
    ).toBeNull();
    expect(await guard('pty-3', 'not a payload')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('enforcedSafetyControls', () => {
  it('keeps the last choice read this run when the file turns unreadable, and says so once', () => {
    const reads: SafetyControlsRead[] = [
      { status: 'ready', controls: { processKillGuard: true } },
      { status: 'unreadable' },
      { status: 'unreadable' },
    ];
    const recorded: string[] = [];
    const controls = enforcedSafetyControls({
      read: () => reads.shift()!,
      record: event => recorded.push(event),
    });

    expect(controls()).toEqual({ processKillGuard: true });
    expect(controls()).toEqual({ processKillGuard: true });
    expect(controls()).toEqual({ processKillGuard: true });
    expect(recorded).toEqual(['safety.undecided']);
  });

  it('answers null, never "off", when nothing was ever read', () => {
    const controls = enforcedSafetyControls({
      read: () => ({ status: 'unreadable' }),
      record: () => undefined,
    });
    expect(controls()).toBeNull();
  });
});

describe('runListing', () => {
  // The macOS tools the guard runs; other platforms' pgrep differs.
  it.runIf(process.platform === 'darwin')(
    'resolves a tool’s own exit status as its answer',
    async () => {
      // pgrep exits 1 for no match: an answer, not a failure.
      const none = await runListing('pgrep', [
        '-x',
        'no-such-process-exawatt-guard',
      ]);
      expect(none.exitCode).toBe(1);
      // An invalid option is pgrep's exit 2: still the tool's own answer.
      const invalid = await runListing('pgrep', ['-Z']);
      expect(invalid.exitCode).toBe(2);
    }
  );
});
