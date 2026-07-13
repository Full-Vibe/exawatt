import { describe, expect, it } from 'vitest';
import type { PtySessionInfo } from '@/types/electron';
import { mergeLocalWorkspaceSessions } from './local-workspace-sessions';

const live = (over: Partial<PtySessionInfo> = {}): PtySessionInfo => ({
  id: 'pty-1',
  durableSessionId: 'durable-1',
  harness: 'claude',
  title: 'Claude Code',
  cwd: '/code/exawatt',
  projectDir: '/code/exawatt',
  projectName: 'Exawatt',
  cols: 120,
  rows: 40,
  startedAt: 100,
  exited: false,
  exitCode: null,
  lastDataAt: 100,
  harnessSessionId: 'provider-1',
  ...over,
});

describe('mergeLocalWorkspaceSessions', () => {
  it('keeps live PTYs and adds persisted tabs that have no process', () => {
    const result = mergeLocalWorkspaceSessions([live()], {
      v: 5,
      projects: [
        {
          dir: '/code/exawatt',
          name: 'Exawatt',
          tabs: [
            {
              id: 'tab-live',
              durableSessionId: 'durable-1',
              sessionId: 'pty-1',
              harness: 'claude',
              title: 'Live agent',
              cwd: '/code/exawatt',
              lifecycle: 'running',
              exitCode: null,
            },
            {
              id: 'tab-stopped',
              durableSessionId: 'durable-2',
              sessionId: null,
              harness: 'codex',
              title: 'Stopped agent',
              cwd: '/code/exawatt-wt/stopped',
              lifecycle: 'stopped-clean',
              exitCode: null,
            },
          ],
        },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'pty-1',
      sessionKey: 'pty-1',
      sessionState: 'live',
    });
    expect(result[1]).toMatchObject({
      id: 'workspace:durable-2',
      sessionKey: 'tab-stopped',
      title: 'Stopped agent',
      exited: true,
      exitCode: 0,
      sessionState: 'stopped',
    });
  });

  it('keeps an exited PTY addressable through its stable tab identity', () => {
    const result = mergeLocalWorkspaceSessions(
      [live({ exited: true, exitCode: 0 })],
      {
        projects: [
          {
            dir: '/code/exawatt',
            tabs: [
              {
                id: 'tab-stable',
                durableSessionId: 'durable-1',
                sessionId: null,
                harness: 'claude',
                cwd: '/code/exawatt',
              },
            ],
          },
        ],
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'pty-1',
      sessionKey: 'tab-stable',
      sessionState: 'stopped',
    });
  });

  it('falls back to durable Session identity before workspace persistence lands', () => {
    const result = mergeLocalWorkspaceSessions(
      [live({ exited: true, exitCode: 0 })],
      null
    );

    expect(result[0]).toMatchObject({
      sessionKey: 'durable-1',
      sessionState: 'stopped',
    });
  });

  it('marks failed stopped tabs as errors and tolerates the legacy group key', () => {
    const result = mergeLocalWorkspaceSessions([], {
      initiatives: [
        {
          dir: '/code/alpha',
          tabs: [
            {
              id: 'tab-failed',
              harness: 'codex',
              title: 'Failed agent',
              cwd: '/code/alpha',
              lifecycle: 'failed',
              exitCode: -999,
            },
          ],
        },
      ],
    });
    expect(result[0]).toMatchObject({
      projectName: 'alpha',
      exitCode: 1,
      sessionState: 'stopped',
    });
  });
});
