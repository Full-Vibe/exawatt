import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { OUTBOUND_CONTROLS } from '@/lib/hosted-features/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountFirstRunCard,
  ACCOUNT_FIRST_RUN_STORAGE_KEY,
} from './account-first-run-card';

const { pathname, session, accountAvailable, authObserver } = vi.hoisted(
  () => ({
    pathname: { current: '/workspace' },
    session: { current: null as { user: { id: string } } | null },
    accountAvailable: { current: true },
    authObserver: {
      listener: null as
        | null
        | ((event: string, session: { user: { id: string } } | null) => void),
      read: null as null | Promise<{
        data: { session: { user: { id: string } } | null };
      }>,
    },
  })
);

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

vi.mock('@/lib/supabase/client', () => ({
  createOptionalClient: () =>
    accountAvailable.current
      ? {
          auth: {
            getSession: () =>
              authObserver.read ??
              Promise.resolve({ data: { session: session.current } }),
            onAuthStateChange: (
              listener: NonNullable<typeof authObserver.listener>
            ) => {
              authObserver.listener = listener;
              queueMicrotask(() => {
                if (authObserver.listener === listener)
                  listener('INITIAL_SESSION', session.current);
              });
              return {
                data: {
                  subscription: {
                    unsubscribe: () => {
                      authObserver.listener = null;
                    },
                  },
                },
              };
            },
          },
        }
      : null,
}));

/** mount and let the component's own session read and effects settle */
async function mount() {
  render(<AccountFirstRunCard />);
  await act(async () => {});
}

function card() {
  return screen.queryByRole('complementary', { name: 'Account features' });
}

beforeEach(() => {
  pathname.current = '/workspace';
  session.current = null;
  accountAvailable.current = true;
  authObserver.listener = null;
  authObserver.read = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  delete (window as { electron?: unknown }).electron;
});

describe('AccountFirstRunCard', () => {
  it('does not permanently dismiss the invitation from an obsolete session read after sign-out', async () => {
    let settle!: (value: {
      data: { session: { user: { id: string } } };
    }) => void;
    authObserver.read = new Promise(resolve => {
      settle = resolve;
    });
    await mount();
    act(() => authObserver.listener?.('SIGNED_OUT', null));
    expect(card()).not.toBeNull();

    await act(async () => {
      settle({ data: { session: { user: { id: 'previous-account' } } } });
    });

    expect(card()).not.toBeNull();
    expect(
      window.localStorage.getItem(ACCOUNT_FIRST_RUN_STORAGE_KEY)
    ).toBeNull();
  });

  it('retires the invitation when the auth event stream signs in', async () => {
    await mount();
    act(() =>
      authObserver.listener?.('SIGNED_IN', { user: { id: 'new-account' } })
    );
    expect(card()).toBeNull();
    expect(
      window.localStorage.getItem(ACCOUNT_FIRST_RUN_STORAGE_KEY)
    ).not.toBeNull();
  });

  it('names what an account enables, without blocking anything', async () => {
    await mount();

    const invitation = card();
    expect(invitation).not.toBeNull();
    // Hosted-feature names come from the contract that also names them on
    // Settings → Privacy — asserting the contract value rather than a literal
    // is what stops the invitation and the switch drifting apart again.
    for (const feature of [
      OUTBOUND_CONTROLS.contextLabels.label,
      OUTBOUND_CONTROLS.conversationSummaries.label,
      OUTBOUND_CONTROLS.goalVisuals.label,
      'Project sync across machines',
      'Sending feedback',
    ]) {
      expect(invitation).toHaveTextContent(feature);
    }
    // the ENG-030 OS0 promise that local operation stays usable is on screen
    expect(invitation).toHaveTextContent(
      'Agents, Projects, and Demo Mode work without an account.'
    );
    // an invitation, never a gate: no dialog, no modal semantics, no scrim
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invitation!.getAttribute('aria-modal')).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in'
    );
  });

  it('never returns once dismissed', async () => {
    await mount();
    expect(card()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(card()).toBeNull();
    expect(
      window.localStorage.getItem(ACCOUNT_FIRST_RUN_STORAGE_KEY)
    ).not.toBeNull();

    cleanup();
    await mount();
    expect(card()).toBeNull();
  });

  it('does not return after the operator takes the invitation', async () => {
    await mount();

    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));

    expect(card()).toBeNull();
    expect(
      window.localStorage.getItem(ACCOUNT_FIRST_RUN_STORAGE_KEY)
    ).not.toBeNull();
  });

  it('stays away when there is already an account', async () => {
    session.current = { user: { id: 'user-1' } };

    await mount();

    expect(card()).toBeNull();
    // signing in by any route settles the invitation for good
    expect(
      window.localStorage.getItem(ACCOUNT_FIRST_RUN_STORAGE_KEY)
    ).not.toBeNull();
  });

  it('stays silent when account services are not configured', async () => {
    accountAvailable.current = false;
    await mount();
    expect(card()).toBeNull();
  });

  it('stays off the auth surfaces and off public pages', async () => {
    pathname.current = '/sign-in';
    await mount();
    expect(card()).toBeNull();

    cleanup();
    pathname.current = '/';
    await mount();
    expect(card()).toBeNull();

    cleanup();
    pathname.current = '/architecture';
    await mount();
    expect(card()).toBeNull();
  });

  it('stays out of the deterministic Electron evaluator', async () => {
    (window as { electron?: unknown }).electron = {
      isElectron: true,
      feedback: { testMode: true },
    };

    await mount();

    expect(card()).toBeNull();
  });
});
