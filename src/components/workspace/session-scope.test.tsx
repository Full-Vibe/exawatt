/**
 * BUG-037 — the renderer half of main's BUG-025.
 *
 * Two guards, both by reflection rather than by an enumerated list of stores,
 * so a fifth Session-keyed map added tomorrow fails the build:
 *
 *  1. RESIDUE. Drive a realistic Session through every renderer store, close
 *     its tab, then walk EVERY value the hook returns and fail if any of them
 *     still names the forgotten Session. A new store added to the return value
 *     is swept without touching this file.
 *  2. DECLARATION. Reflect over the module source and fail if the hook body
 *     declares a keyed collection outside the owner. This is what covers the
 *     stores that never reach the return value — the observed-identity map
 *     leaked for exactly that reason.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceState } from './use-workspace-state';
import type {
  GoalVisual,
  PtyAttention,
  PtySessionInfo,
  SessionDelegation,
} from '@/types/electron';

vi.mock('@/lib/projects/registry', () => ({
  openRepositoryProject: vi.fn(() => Promise.reject(new Error('offline'))),
  listProjects: vi.fn(() => Promise.resolve([])),
  renameProject: vi.fn(() => Promise.resolve()),
  reorderProjects: vi.fn(() => Promise.resolve()),
  setProjectColor: vi.fn(() => Promise.resolve()),
}));

const REPO = '/repo/exawatt';
const DURABLE = 'durable-forgotten';
const PTY = 'pty-forgotten';
/** The operator's real goal visual is a ~265 KB JPEG carried as a data URL. */
const GOAL_VISUAL: GoalVisual = {
  identityKey: 'identity-forgotten',
  revision: 3,
  state: 'ready',
  dataUrl: `data:image/jpeg;base64,${'YWJj'.repeat(16)}`,
};
const ATTENTION: PtyAttention = { kind: 'turn-end', since: 1 };
const DELEGATION: SessionDelegation = {
  children: [{ id: 'child-1', agentType: 'claude', startedAt: 1 }],
  ownTurn: 'generating',
};

function liveSession(
  durableSessionId: string,
  id: string,
  overrides: Partial<PtySessionInfo> = {}
): PtySessionInfo {
  return {
    id,
    durableSessionId,
    harness: 'claude',
    title: 'Claude Code',
    cwd: REPO,
    projectDir: REPO,
    projectName: 'exawatt',
    cols: 120,
    rows: 40,
    startedAt: 1,
    exited: false,
    exitCode: null,
    lastDataAt: 1,
    harnessSessionId: null,
    ...overrides,
  };
}

type Handler<T> = (payload: T) => void;

/** Main's broadcast side, captured so a test can play the real event stream. */
function electronStub(sessions: PtySessionInfo[]) {
  const handlers: Record<string, Handler<never>[]> = {};
  const channel =
    <T,>(name: string) =>
    (handler: Handler<T>) => {
      (handlers[name] ??= []).push(handler as Handler<never>);
      return () => {};
    };
  const emit = <T,>(name: string, payload: T) => {
    for (const handler of handlers[name] ?? [])
      (handler as unknown as Handler<T>)(payload);
  };
  const pty = {
    list: vi.fn(() => Promise.resolve(sessions)),
    create: vi.fn(),
    closeSession: vi.fn(() => Promise.resolve(true)),
    archiveSession: vi.fn(
      (entry: Record<string, unknown>): Promise<Record<string, unknown>> =>
        Promise.resolve({ ...entry, closedAt: 1 })
    ),
    closedSessions: vi.fn(() => Promise.resolve([])),
    reopenSession: vi.fn(() => Promise.resolve(null)),
    focus: vi.fn(() => Promise.resolve()),
    onExit: channel<{
      id: string;
      durableSessionId: string;
      exitCode: number;
    }>('exit'),
    onIdentity: channel<{
      id: string;
      durableSessionId: string;
      harnessSessionId: string;
    }>('identity'),
    onContext: channel<{ durableSessionId: string; summary: string }>(
      'context'
    ),
    onGoalVisual: channel<{ durableSessionId: string; visual: GoalVisual }>(
      'goal-visual'
    ),
    onRecap: channel('recap'),
    onAttention: channel<{ id: string; attention: PtyAttention | null }>(
      'attention'
    ),
    onActivity: channel<{ id: string; working: boolean }>('activity'),
    onEngaged: channel<{ id: string }>('engaged'),
    onDelegation: channel<{
      id: string;
      delegation: SessionDelegation | null;
    }>('delegation'),
  };
  const workspace = {
    load: vi.fn(() => Promise.resolve(null)),
    recovery: vi.fn(() => Promise.resolve({ previousRunInterrupted: false })),
    save: vi.fn(() => Promise.resolve()),
  };
  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: { pty, workspace },
  });
  return { pty, workspace, emit };
}

/**
 * Every Session identity still named by anything the hook hands out.
 *
 * Reflection, not a list: the walk covers each own enumerable value of the
 * returned object, so it also covers stores that do not exist yet.
 */
function sessionIdentityResidue(
  surface: Record<string, unknown>,
  identities: string[]
): string[] {
  const found: string[] = [];
  for (const [name, value] of Object.entries(surface)) {
    if (value instanceof Map || value instanceof Set) {
      for (const id of identities)
        if (value.has(id)) found.push(`${name}.${id}`);
      continue;
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof value === 'function'
    ) {
      continue;
    }
    for (const id of identities) {
      if (id in (value as Record<string, unknown>)) found.push(`${name}.${id}`);
    }
  }
  return found.sort();
}

async function mountedWorkspace(sessions: PtySessionInfo[]) {
  const stub = electronStub(sessions);
  const view = renderHook(() => useWorkspaceState());
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return { ...stub, view };
}

/** Play every Session-scoped broadcast main sends for a live Session. */
function describeSession(
  emit: ReturnType<typeof electronStub>['emit'],
  durableSessionId: string,
  id: string
) {
  act(() => {
    emit('context', { durableSessionId, summary: 'Ship the renderer mirror' });
    emit('goal-visual', { durableSessionId, visual: GOAL_VISUAL });
    emit('identity', {
      id,
      durableSessionId,
      harnessSessionId: `harness-${durableSessionId}`,
    });
    emit('engaged', { id });
    emit('activity', { id, working: true });
    emit('attention', { id, attention: ATTENTION });
    emit('delegation', { id, delegation: DELEGATION });
  });
}

describe('a forgotten Session leaves nothing behind in the renderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases every Session-keyed store, including ones added later', async () => {
    const { view, emit } = await mountedWorkspace([liveSession(DURABLE, PTY)]);
    describeSession(emit, DURABLE, PTY);

    // The stores must actually be populated, or the sweep below proves nothing.
    expect(view.result.current.summaries[DURABLE]).toBe(
      'Ship the renderer mirror'
    );
    expect(view.result.current.goalVisuals[DURABLE]?.dataUrl).toBeTruthy();
    expect(
      sessionIdentityResidue(view.result.current, [DURABLE, PTY]).length
    ).toBeGreaterThan(3);

    const tabId = view.result.current.projects[0].tabs[0].id;
    await act(async () => {
      await view.result.current.closeTab(tabId, { force: true });
    });

    expect(sessionIdentityResidue(view.result.current, [DURABLE, PTY])).toEqual(
      []
    );
  });

  it('releases a superseded PTY incarnation while the Session lives on', async () => {
    const { view, emit } = await mountedWorkspace([liveSession(DURABLE, PTY)]);
    describeSession(emit, DURABLE, PTY);

    // A PTY exit is not a Session ending: the tab stays, its PTY id does not.
    await act(async () => {
      emit('exit', { id: PTY, durableSessionId: DURABLE, exitCode: 0 });
    });

    expect(sessionIdentityResidue(view.result.current, [PTY])).toEqual([]);
    // …and the Session's own durable truth is untouched, so the operator can
    // still read the goal of the tab in front of him.
    expect(view.result.current.summaries[DURABLE]).toBe(
      'Ship the renderer mirror'
    );
    expect(view.result.current.goalVisuals[DURABLE]?.dataUrl).toBeTruthy();
  });

  it('does not let a late broadcast resurrect a forgotten Session', async () => {
    const other = 'durable-other';
    const { view, emit } = await mountedWorkspace([
      liveSession(DURABLE, PTY),
      liveSession(other, 'pty-other'),
    ]);
    describeSession(emit, DURABLE, PTY);
    const tabId = view.result.current.projects[0].tabs.find(
      tab => tab.durableSessionId === DURABLE
    )!.id;
    await act(async () => {
      await view.result.current.closeTab(tabId, { force: true });
    });

    // A last burst of output races the optimistic strip removal.
    await act(async () => {
      emit('activity', { id: PTY, working: true });
      emit('context', { durableSessionId: DURABLE, summary: 'too late' });
    });
    // Any later layout commit sweeps it; here, an unrelated Session exits.
    await act(async () => {
      emit('exit', {
        id: 'pty-other',
        durableSessionId: other,
        exitCode: 0,
      });
    });

    expect(sessionIdentityResidue(view.result.current, [DURABLE, PTY])).toEqual(
      []
    );
  });

  it('keeps the goal the operator can still see when a close is reopened', async () => {
    const { view, emit, pty } = await mountedWorkspace([
      liveSession(DURABLE, PTY),
    ]);
    describeSession(emit, DURABLE, PTY);
    const tabId = view.result.current.projects[0].tabs[0].id;

    let archived: Record<string, unknown> | null = null;
    pty.archiveSession.mockImplementation((entry: Record<string, unknown>) => {
      archived = { ...entry, closedAt: 1 };
      return Promise.resolve(archived);
    });
    await act(async () => {
      await view.result.current.closeTab(tabId, { force: true });
    });
    // The ledger entry carries the goal, which is what ⌘⇧T restores from.
    expect(archived!.goal).toBe('Ship the renderer mirror');

    pty.reopenSession.mockResolvedValue(archived);
    await act(async () => {
      await view.result.current.reopenClosedSession(DURABLE);
    });
    expect(view.result.current.summaries[DURABLE]).toBe(
      'Ship the renderer mirror'
    );
  });
});

/**
 * The declaration guard. Runtime reflection can only see what the hook returns,
 * and the observed-identity map — the one that leaked hardest — is internal.
 * A Session-keyed collection must therefore come from the owner, so the hook
 * body declares none of its own.
 */
describe('Session-keyed renderer state is declared through one owner', () => {
  const source = readFileSync(
    path.join(__dirname, 'use-workspace-state.ts'),
    'utf8'
  );
  const body = source.slice(
    source.indexOf('export function useWorkspaceState')
  );

  it('declares no keyed record state outside the owner', () => {
    // Every `Record<string, …>` this hook has ever held is keyed by a Session
    // identity. Getting one from `useSessionScopedRecord` is the only path.
    expect(body.match(/useState<\s*Record<\s*string/g)).toBeNull();
    expect(body.match(/useState<\s*\n?\s*Record<\s*string/g)).toBeNull();
  });

  it('declares no keyed map outside the owner', () => {
    expect(body.match(/useRef<\s*Map</g)).toBeNull();
    expect(body.match(/useRef\(\s*new Map/g)).toBeNull();
  });

  it('binds the owner to the layout exactly once', () => {
    expect(body.match(/useSessionScopeRelease\(/g)).toHaveLength(1);
  });
});
