import type { MessageEnvelope } from '@exawatt/core';
import type {
  BusDeliveryContext,
  BusTarget,
  SourceCommandArg,
  SourceCommandResult,
  TerminalDoor,
} from './types';

export const envelope: MessageEnvelope = {
  id: 'msg-1',
  projectId: '/work/app',
  from: {
    sessionId: 'session-a',
    name: 'codex-2',
    harness: 'codex',
    kind: 'agent',
  },
  to: { sessionId: 'session-b', name: 'claude-1', harness: 'claude' },
  at: 1,
  text: 'hello',
};

export function target(overrides: Partial<BusTarget> = {}): BusTarget {
  return {
    sessionId: 'session-b',
    ptyId: 'pty-2',
    name: 'claude-1',
    harness: 'claude',
    harnessSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    cwd: '/work/app',
    ...overrides,
  };
}

/** A terminal that records every write, in order, and when Enter came. */
export function recordingTerminal(bracketed = true) {
  const writes: string[] = [];
  const events: string[] = [];
  const door: TerminalDoor = {
    bracketedPaste: () => bracketed,
    write: data => {
      writes.push(data);
      events.push('write');
    },
    settled: async () => {
      events.push('settled');
    },
    submit: () => {
      writes.push('\r');
      events.push('submit');
    },
  };
  return { door, writes, events };
}

export function context(
  overrides: Partial<BusDeliveryContext> = {}
): BusDeliveryContext & {
  commands: { executable: string; args: readonly SourceCommandArg[] }[];
} {
  const commands: { executable: string; args: readonly SourceCommandArg[] }[] =
    [];
  return {
    text: '[Exawatt] Message from @codex-2 …\n\nhello',
    terminal: null,
    runSourceCommand: async (
      executable,
      args
    ): Promise<SourceCommandResult> => {
      commands.push({ executable, args });
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    commands,
    ...overrides,
  };
}
