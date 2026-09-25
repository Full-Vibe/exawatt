import { describe, expect, it, vi } from 'vitest';
import type { SafetyControlSettings } from '@exawatt/core';
import { createSafetyGuard } from './safety-guard';

const HELPER =
  '/Applications/Slack.app/Contents/Frameworks/Slack Helper.app/Contents/MacOS/Slack Helper';

function guardWith(settings: SafetyControlSettings) {
  const recorded: Array<[string, Record<string, unknown> | undefined]> = [];
  const run = vi.fn(async (command: string) => {
    if (command === 'pgrep') return '42';
    if (command === 'ps') return `   42 ${HELPER}`;
    return '';
  });
  const guard = createSafetyGuard({
    settings: () => settings,
    protectedPids: () => new Set(),
    record: (event, fields) => recorded.push([event, fields]),
    run,
    home: '/Users/op',
  });
  return { guard, recorded, run };
}

const bash = (command: string) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command },
});

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
    expect(
      (decision?.hookSpecificOutput as Record<string, string>)
        .permissionDecisionReason
    ).toContain('Slack Helper');
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
