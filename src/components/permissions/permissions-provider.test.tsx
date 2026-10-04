import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  permissionDeclaration,
  type PermissionEnsureResult,
  type PermissionState,
  type PermissionsSnapshot,
} from '@exawatt/core';
import type {
  DesktopPermissionsApi,
  DesktopBridgePush,
} from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { PermissionsProvider, usePermissions } from './permissions-provider';

const notifications = permissionDeclaration('notifications');

const snapshotOf = (state: PermissionState): PermissionsSnapshot => [
  { id: 'notifications', state, checkedAt: 1 },
];

const result = (
  state: PermissionState,
  outcome: PermissionEnsureResult['outcome']
): PermissionEnsureResult => ({ id: 'notifications', state, outcome });

/** Main's side of the bridge: what it answers, and the pushes it can send. */
function installPermissions(initial: PermissionState = 'not-determined') {
  let state = initial;
  let changed: ((snapshot: PermissionsSnapshot) => void) | null = null;
  let primerRequested:
    | ((request: DesktopBridgePush<'permissions:primer-requested'>) => void)
    | null = null;
  const bridge = {
    snapshot: vi.fn(async () => snapshotOf(state)),
    refresh: vi.fn(async () => snapshotOf(state)),
    ensure: vi.fn(
      async (
        _id: 'notifications',
        request: { reason: string; primed?: boolean }
      ): Promise<PermissionEnsureResult> => {
        if (state === 'granted') return result('granted', 'ready');
        if (state === 'denied') return result('denied', 'settings');
        return request.primed
          ? result(state, 'requested')
          : result(state, 'primer');
      }
    ),
    openSettings: vi.fn(async () => undefined),
    onChanged: vi.fn(handler => {
      changed = handler;
      return () => undefined;
    }),
    onPrimerRequested: vi.fn(handler => {
      primerRequested = handler;
      return () => undefined;
    }),
  } satisfies DesktopPermissionsApi;
  installBridgeDouble({ permissions: bridge });
  return {
    bridge,
    /** The system, or the user in System Settings, changes the grant. */
    set: (next: PermissionState) => {
      state = next;
    },
    push: (next: PermissionState) => {
      state = next;
      act(() => changed?.(snapshotOf(next)));
    },
    requestPrimer: (reason: string) =>
      act(() => primerRequested?.({ id: 'notifications', reason })),
  };
}

let outcome: boolean | undefined;

function Asker({ reason = 'Hear from your agents.' }: { reason?: string }) {
  const permissions = usePermissions();
  return (
    <button
      type="button"
      onClick={() => {
        void permissions
          .ensure('notifications', reason)
          .then(granted => (outcome = granted));
      }}
    >
      ask
    </button>
  );
}

async function mount(reason?: string) {
  render(
    <PermissionsProvider>
      <Asker reason={reason} />
    </PermissionsProvider>
  );
  await act(async () => undefined);
}

async function ask() {
  await act(async () => {
    fireEvent.click(screen.getByText('ask'));
  });
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const buttons = () => Array.from(dialog()?.querySelectorAll('button') ?? []);

beforeEach(() => {
  outcome = undefined;
});

afterEach(() => {
  cleanup();
  removeBridgeDouble();
  vi.useRealTimers();
});

describe('the primer', () => {
  it('shows one Continue, the caller’s reason and the grant’s own explanation', async () => {
    installPermissions();
    await mount('Turning this on lets Exawatt reach you.');
    await ask();

    expect(dialog()?.getAttribute('data-permission-primer')).toBe(
      'notifications'
    );
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]!.textContent).toContain('Continue');
    expect(dialog()?.textContent).toContain(notifications.primer.title);
    expect(dialog()?.textContent).toContain(notifications.primer.will);
    expect(dialog()?.textContent).toContain(
      'Turning this on lets Exawatt reach you.'
    );
  });

  it('raises nothing by showing itself: only Continue asks the system', async () => {
    const { bridge } = installPermissions();
    await mount();
    await ask();
    expect(bridge.ensure).toHaveBeenCalledTimes(1);
    expect(bridge.ensure.mock.calls[0]![1].primed).not.toBe(true);
  });

  it('Continue asks main with the primer acknowledged, closes, and follows the answer to a grant', async () => {
    const { bridge, push } = installPermissions();
    await mount();
    await ask();

    await act(async () => {
      fireEvent.click(buttons()[0]!);
    });
    expect(bridge.ensure).toHaveBeenLastCalledWith('notifications', {
      reason: 'Hear from your agents.',
      primed: true,
    });
    expect(dialog()).toBeNull();
    expect(outcome).toBeUndefined();

    push('granted');
    await act(async () => undefined);
    expect(outcome).toBe(true);
  });

  it('follows a refusal to false without showing the primer again', async () => {
    const { push } = installPermissions();
    await mount();
    await ask();
    await act(async () => {
      fireEvent.click(buttons()[0]!);
    });
    push('denied');
    await act(async () => undefined);
    expect(outcome).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('dismissing it resolves false and never asks the system', async () => {
    const { bridge } = installPermissions();
    await mount();
    await ask();
    await act(async () => {
      fireEvent.keyDown(dialog()!, { key: 'Escape' });
    });
    expect(dialog()).toBeNull();
    expect(outcome).toBe(false);
    expect(
      bridge.ensure.mock.calls.some(([, request]) => request.primed === true)
    ).toBe(false);
  });

  it('treats a status macOS cannot report as a grant to attempt, not a refusal', async () => {
    const { bridge } = installPermissions('unknown');
    await mount();
    await ask();
    expect(dialog()?.getAttribute('data-primer-step')).toBe('intro');
    await act(async () => {
      fireEvent.click(buttons()[0]!);
    });
    expect(bridge.ensure).toHaveBeenLastCalledWith('notifications', {
      reason: 'Hear from your agents.',
      primed: true,
    });
    expect(outcome).toBe(true);
  });

  it('opens at once when main asks for it, with main’s reason', async () => {
    const { requestPrimer } = installPermissions();
    await mount();
    requestPrimer('An agent needed you while Exawatt was in the background.');
    expect(dialog()?.getAttribute('data-primer-step')).toBe('intro');
    expect(dialog()?.textContent).toContain(
      'An agent needed you while Exawatt was in the background.'
    );
  });

  it('does not stack a second primer on the first', async () => {
    const { requestPrimer } = installPermissions();
    await mount();
    requestPrimer('first');
    requestPrimer('second');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog()?.textContent).toContain('first');
  });
});

describe('a grant macOS has denied', () => {
  it('offers System Settings as the one action, and closes when the grant is made there', async () => {
    const { bridge, push } = installPermissions('denied');
    await mount();
    await ask();

    expect(dialog()?.getAttribute('data-primer-step')).toBe('denied');
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]!.textContent).toContain('Open System Settings');
    expect(dialog()?.textContent).toContain(notifications.settingsPath);

    await act(async () => {
      fireEvent.click(buttons()[0]!);
    });
    expect(bridge.openSettings).toHaveBeenCalledWith('notifications');
    // The primer stays up while the change is made.
    expect(dialog()).not.toBeNull();

    push('granted');
    await act(async () => undefined);
    expect(dialog()).toBeNull();
    expect(outcome).toBe(true);
  });

  it('does nothing for an organization-managed grant a person cannot change', async () => {
    const { bridge } = installPermissions('restricted');
    bridge.ensure.mockResolvedValueOnce(result('restricted', 'settings'));
    await mount();
    await ask();
    expect(dialog()).toBeNull();
    expect(outcome).toBe(false);
  });
});

describe('staying current', () => {
  it('re-reads when the window regains focus', async () => {
    const { bridge, set } = installPermissions('denied');
    await mount();
    bridge.refresh.mockClear();
    set('granted');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(bridge.refresh).toHaveBeenCalledTimes(1);
  });

  it('follows the grant while the primer or System Settings is open, then stops', async () => {
    vi.useFakeTimers();
    const { bridge, set } = installPermissions('denied');
    await mount();
    await ask();
    await act(async () => {
      fireEvent.click(buttons()[0]!);
    });
    bridge.refresh.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(bridge.refresh.mock.calls.length).toBeGreaterThan(0);

    set('granted');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(outcome).toBe(true);

    bridge.refresh.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(bridge.refresh).not.toHaveBeenCalled();
  });

  it('reads nothing and asks for nothing outside the desktop app', async () => {
    removeBridgeDouble();
    await mount();
    await ask();
    expect(outcome).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('answers ensure without a primer when the grant is already given', async () => {
    installPermissions('granted');
    await mount();
    await ask();
    expect(outcome).toBe(true);
    expect(dialog()).toBeNull();
  });
});
