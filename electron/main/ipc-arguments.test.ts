import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
);
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => unknown
    ) => handlers.set(channel, handler),
  },
}));

import { ARGUMENT_BOUNDARIES, handleBounded } from './ipc-arguments';
import { setTrustedRendererOrigin } from './ipc-security';

type Channel = keyof typeof ARGUMENT_BOUNDARIES;
const read = (channel: Channel, ...args: unknown[]) =>
  ARGUMENT_BOUNDARIES[channel].read(args);

/** What preload actually sends, per bounded channel: every one must pass. */
const WELL_FORMED: { [C in Channel]: unknown[] } = {
  'agent-sources:list': ['launch', true],
  'agent-sources:remembered': ['all'],
  'agent-sources:act': ['claude', 'install-guide'],
  'consumption:snapshot': [{ sinceMs: 5 }],
  'pty:create': [
    {
      harness: 'claude',
      cwd: '/work/repo',
      cols: 120,
      rows: 40,
      durableSessionId: 'session-1',
      initialPrompt: 'Ship it',
      permissionMode: 'prompt',
      model: 'opus',
      effort: 'high',
    },
  ],
  'pty:list-agent-models': ['codex', '/work/repo', false],
  'pty:set-context-auth': [null],
  'pty:correct-context': ['session-1', 'Fix the build'],
  'pty:clone-context': ['session-1'],
  'pty:copy-text': ['hello'],
  'pty:open-path': ['docs/plan.md', '/work/repo', { contain: true }],
  'pty:worktree': ['/work/repo', 'agent/fix-build'],
  'pty:reconcile-resume-identities': [
    [
      {
        durableSessionId: 'session-1',
        harness: 'claude',
        cwd: '/work/repo',
        initialTask: null,
        harnessSessionId: null,
      },
    ],
  ],
  'settings:set-attention-notifications': [true],
  'settings:set-dock-badge': [false],
  'settings:set-hosted-context-labels': [true],
  'settings:set-hosted-conversation-summaries': [false],
  'settings:set-goal-visuals': [true],
  'settings:set-reentry-recap': [false],
  'settings:set-operator-auto-publish': [true],
  'settings:set-claude-plan-windows': [true],
  'settings:record-operator-profile-state': [
    { startedAt: '2026-09-01T00:00:00.000Z', profileEnabled: true },
  ],
};

describe('argument boundaries', () => {
  it.each(Object.entries(WELL_FORMED))(
    '%s accepts what preload sends',
    (channel, args) => {
      expect(() => read(channel as Channel, ...args)).not.toThrow();
    }
  );

  it('passes accepted values through unchanged', () => {
    const options = WELL_FORMED['pty:create'][0];
    expect(read('pty:create', options)[0]).toBe(options);
    expect(read('agent-sources:list')).toEqual(['all', false]);
    expect(read('pty:list-agent-models', 'codex', '/r')).toEqual([
      'codex',
      '/r',
      false,
    ]);
    expect(read('consumption:snapshot', undefined)).toEqual([undefined]);
    expect(read('consumption:snapshot', { sinceMs: 9, other: 1 })).toEqual([
      { sinceMs: 9 },
    ]);
  });

  // The sentences the renderer has always received for these refusals.
  it.each([
    ['agent-sources:list', ['everything'], 'Invalid Agent Source scope'],
    [
      'agent-sources:list',
      ['all', 'yes'],
      'Invalid Agent Source refresh request',
    ],
    [
      'agent-sources:act',
      ['nope', 'install-guide'],
      'Unsupported Agent Source',
    ],
    ['agent-sources:act', ['claude', 'rm'], 'Unsupported Agent Source action'],
    [
      'consumption:snapshot',
      [{ sinceMs: '5' }],
      'Invalid consumption snapshot request',
    ],
    ['pty:list-agent-models', ['shell', '/r'], 'Unsupported Agent Source'],
    ['pty:list-agent-models', ['codex', '/r\0'], 'Invalid Project directory'],
    ['pty:set-context-auth', [42], 'Invalid context-label authentication'],
    ['pty:correct-context', ['', 'x'], 'Invalid context-label correction'],
    ['pty:clone-context', ['../../etc'], 'Invalid Session identity'],
    ['pty:copy-text', [{}], 'Invalid clipboard text'],
    ['pty:open-path', ['', '/r'], 'Invalid local path'],
    [
      'pty:reconcile-resume-identities',
      ['x'],
      'Invalid Session identity reconciliation request',
    ],
    [
      'pty:reconcile-resume-identities',
      [[{ harness: 'claude' }]],
      'Invalid Session identity hint',
    ],
    ['settings:set-dock-badge', ['on'], 'Invalid dock badge setting'],
    [
      'settings:set-claude-plan-windows',
      [1],
      'Invalid Claude plan usage setting',
    ],
    [
      'settings:record-operator-profile-state',
      [{ admin: true }],
      'Invalid Operator profile state',
    ],
  ] as const)('%s refuses %j', (channel, args, message) => {
    expect(() => read(channel, ...args)).toThrow(message);
  });

  it('refuses spawn options the launch path would otherwise receive', () => {
    for (const options of [
      null,
      { harness: 'rm -rf /' },
      { harness: '../../bin/sh' },
      { harness: 'claude', cwd: '/work\0/repo' },
      { harness: 'claude', cols: '80' },
      { harness: 'claude', model: { toString: 'x' } },
      { harness: 'claude', permissionMode: 'root' },
    ]) {
      expect(() => read('pty:create', options)).toThrow(
        'Invalid launch options'
      );
    }
  });

  it('refuses a worktree branch git would read as an option', () => {
    expect(() => read('pty:worktree', '/work/repo', '--upload-pack=x')).toThrow(
      'Invalid worktree request'
    );
  });
});

describe('a bounded channel', () => {
  setTrustedRendererOrigin('http://127.0.0.1:43123');
  const trusted = { senderFrame: { url: 'http://127.0.0.1:43123/workspace' } };

  it('answers a refusal in its own result shape instead of rejecting', async () => {
    const launch = vi.fn();
    handleBounded('pty:create', launch);
    const answer = await handlers.get('pty:create')!(trusted, {
      harness: 'nope',
    });
    expect(answer).toEqual({ ok: false, error: 'Invalid launch options' });
    expect(launch).not.toHaveBeenCalled();
  });

  it('rejects before its handler runs when the channel has no refusal shape', async () => {
    const write = vi.fn();
    handleBounded('pty:copy-text', write);
    expect(() => handlers.get('pty:copy-text')!(trusted, 7)).toThrow(
      'Invalid clipboard text'
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('hands the handler the arguments the reader returned', async () => {
    const snapshot = vi.fn(() => 'ok');
    handleBounded('consumption:snapshot', (_event, request) => {
      snapshot(request);
      return Promise.resolve({} as never);
    });
    await handlers.get('consumption:snapshot')!(trusted, { sinceMs: 3, x: 1 });
    expect(snapshot).toHaveBeenCalledWith({ sinceMs: 3 });
  });
});

describe('registration', () => {
  it('registers every bounded channel through handleBounded, never around it', () => {
    const sources = files(__dirname).map(file => readFileSync(file, 'utf8'));
    for (const channel of Object.keys(ARGUMENT_BOUNDARIES)) {
      const bounded = sources.some(source =>
        new RegExp(`handleBounded\\(\\s*'${channel}'`).test(source)
      );
      const bare = sources.some(source =>
        new RegExp(`handleTrusted\\(\\s*'${channel}'`).test(source)
      );
      expect({ channel, bounded, bare }).toEqual({
        channel,
        bounded: true,
        bare: false,
      });
    }
  });
});

function files(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}
