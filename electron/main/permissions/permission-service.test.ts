import { describe, expect, it, vi } from 'vitest';
import {
  PERMISSIONS,
  type PermissionDeclaration,
  type PermissionRead,
  type PermissionsSnapshot,
} from '@exawatt/core';
import {
  createPermissionService,
  type PermissionProvider,
} from './permission-service';

/**
 * A provider with the real one's contract: `read` never prompts, `request`
 * stays pending until the user answers, and while it is pending the system
 * reports `denied` (what macOS does, observed 2026-10-04).
 */
function fakeProvider(
  initial: PermissionRead = { ok: true, state: 'not-determined' }
) {
  let current = initial;
  let answer: ((state: 'granted' | 'denied') => void) | null = null;
  const provider = {
    read: vi.fn(async () => current),
    request: vi.fn(
      () =>
        new Promise<void>(resolve => {
          // A provider that cannot read keeps failing to read.
          if (current.ok) current = { ok: true, state: 'denied' };
          answer = state => {
            current = { ok: true, state };
            resolve();
          };
        })
    ),
    openSettings: vi.fn(async () => undefined),
  } satisfies PermissionProvider;
  return {
    provider,
    set: (next: PermissionRead) => {
      current = next;
    },
    answer: (state: 'granted' | 'denied') => answer?.(state),
  };
}

function service(
  fake = fakeProvider(),
  options: {
    declarations?: readonly PermissionDeclaration[];
    offer?: boolean;
  } = {}
) {
  const published: PermissionsSnapshot[] = [];
  const offerPrimer = vi.fn(() => options.offer ?? true);
  const instance = createPermissionService({
    providers: { notifications: fake.provider },
    declarations: options.declarations,
    now: () => 1000,
    publish: snapshot => published.push(snapshot),
    offerPrimer,
  });
  return { instance, fake, published, offerPrimer };
}

const state = (snapshot: PermissionsSnapshot) => snapshot[0]!.state;

describe('reading status', () => {
  it('starts unknown and unchecked, one entry per declaration', () => {
    const { instance } = service();
    expect(instance.snapshot()).toEqual(
      PERMISSIONS.map(declaration => ({
        id: declaration.id,
        state: 'unknown',
        checkedAt: null,
      }))
    );
  });

  it('reads without prompting and reports a change once', async () => {
    const { instance, fake, published } = service();
    expect(state(await instance.refresh())).toBe('not-determined');
    await instance.refresh();
    expect(published).toHaveLength(1);
    expect(fake.provider.request).not.toHaveBeenCalled();
    expect(instance.snapshot()[0]!.checkedAt).toBe(1000);
  });

  it('turns a read that failed, by value or by throw, into unknown and never denied', async () => {
    const failed = service(fakeProvider({ ok: false }));
    expect(state(await failed.instance.refresh())).toBe('unknown');

    const thrown = service();
    thrown.fake.provider.read.mockRejectedValueOnce(new Error('no addon'));
    expect(state(await thrown.instance.refresh())).toBe('unknown');
  });
});

describe('ensure', () => {
  it('shows the primer first and raises nothing without it', async () => {
    const { instance, fake } = service();
    const result = await instance.ensure('notifications', { reason: 'x' });
    expect(result).toEqual({
      id: 'notifications',
      state: 'not-determined',
      outcome: 'primer',
    });
    expect(fake.provider.request).not.toHaveBeenCalled();
  });

  it('raises the system prompt once the primer was answered, and reports it pending', async () => {
    const { instance, fake } = service();
    const result = await instance.ensure('notifications', {
      reason: 'x',
      primed: true,
    });
    expect(fake.provider.request).toHaveBeenCalledTimes(1);
    // macOS reads `denied` while the prompt is up; that is nobody's refusal.
    expect(result.state).toBe('not-determined');
    expect(result.outcome).toBe('requested');
  });

  it('asks the system once however many callers ask while the prompt is up', async () => {
    const { instance, fake } = service();
    await Promise.all([
      instance.ensure('notifications', { reason: 'x', primed: true }),
      instance.ensure('notifications', { reason: 'y', primed: true }),
    ]);
    expect(fake.provider.request).toHaveBeenCalledTimes(1);
  });

  it('reads the answer once the user has given it, and tells the renderer', async () => {
    const { instance, fake, published } = service();
    await instance.ensure('notifications', { reason: 'x', primed: true });
    fake.answer('granted');
    await vi.waitFor(() => expect(state(instance.snapshot())).toBe('granted'));
    expect(state(published.at(-1)!)).toBe('granted');
  });

  it('reports a refusal as denied only after the prompt was answered', async () => {
    const { instance, fake } = service();
    await instance.ensure('notifications', { reason: 'x', primed: true });
    fake.answer('denied');
    await vi.waitFor(() => expect(state(instance.snapshot())).toBe('denied'));
  });

  it('survives a request that fails and reads whatever the system then says', async () => {
    const fake = fakeProvider();
    fake.provider.request.mockRejectedValueOnce(new Error('unavailable'));
    const { instance } = service(fake);
    await instance.ensure('notifications', { reason: 'x', primed: true });
    await vi.waitFor(() =>
      expect(state(instance.snapshot())).toBe('not-determined')
    );
  });

  it('proceeds when granted and sends a denial to System Settings, never prompting', async () => {
    const granted = service(fakeProvider({ ok: true, state: 'granted' }));
    expect(
      (
        await granted.instance.ensure('notifications', {
          reason: 'x',
          primed: true,
        })
      ).outcome
    ).toBe('ready');
    expect(granted.fake.provider.request).not.toHaveBeenCalled();

    const denied = service(fakeProvider({ ok: true, state: 'denied' }));
    expect(
      (
        await denied.instance.ensure('notifications', {
          reason: 'x',
          primed: true,
        })
      ).outcome
    ).toBe('settings');
    expect(denied.fake.provider.request).not.toHaveBeenCalled();
  });

  it('asks about a status it cannot read, and never calls it denied', async () => {
    const { instance, fake } = service(fakeProvider({ ok: false }));
    expect(
      (await instance.ensure('notifications', { reason: 'x' })).outcome
    ).toBe('primer');
    const primed = await instance.ensure('notifications', {
      reason: 'x',
      primed: true,
    });
    expect(fake.provider.request).toHaveBeenCalledTimes(1);
    expect(primed.state).toBe('unknown');
    expect(primed.outcome).toBe('requested');
  });

  it('reports a grant that needs a restart as such', async () => {
    const [declaration] = PERMISSIONS;
    const { instance, fake } = service(fakeProvider(), {
      declarations: [{ ...declaration!, needsRelaunch: true }],
    });
    await instance.ensure('notifications', { reason: 'x', primed: true });
    fake.answer('granted');
    await vi.waitFor(() =>
      expect(state(instance.snapshot())).toBe('needs-relaunch')
    );
  });
});

describe('require, for main at a moment of need', () => {
  it('lets work through when the grant is given', async () => {
    const { instance, offerPrimer } = service(
      fakeProvider({ ok: true, state: 'granted' })
    );
    expect(await instance.require('notifications', 'why')).toBe(true);
    expect(offerPrimer).not.toHaveBeenCalled();
  });

  it('holds the work and offers the primer once per launch when the user was never asked', async () => {
    const { instance, fake, offerPrimer } = service();
    expect(await instance.require('notifications', 'why')).toBe(false);
    expect(await instance.require('notifications', 'why')).toBe(false);
    expect(offerPrimer).toHaveBeenCalledTimes(1);
    expect(offerPrimer).toHaveBeenCalledWith({
      id: 'notifications',
      reason: 'why',
    });
    expect(fake.provider.request).not.toHaveBeenCalled();
  });

  it('offers the primer again when no window could take it', async () => {
    const { instance, offerPrimer } = service(fakeProvider(), { offer: false });
    await instance.require('notifications', 'why');
    await instance.require('notifications', 'why');
    expect(offerPrimer).toHaveBeenCalledTimes(2);
  });

  it('stays quiet about a denial: the user already said no', async () => {
    const { instance, offerPrimer } = service(
      fakeProvider({ ok: true, state: 'denied' })
    );
    expect(await instance.require('notifications', 'why')).toBe(false);
    expect(offerPrimer).not.toHaveBeenCalled();
  });

  it('offers the primer for a status it cannot read, then lets the work try once the user was asked', async () => {
    const { instance, offerPrimer } = service(fakeProvider({ ok: false }));
    expect(await instance.require('notifications', 'why')).toBe(false);
    expect(offerPrimer).toHaveBeenCalledTimes(1);
    await instance.ensure('notifications', { reason: 'why', primed: true });
    expect(await instance.require('notifications', 'why')).toBe(true);
  });
});

describe('System Settings', () => {
  it('opens the grant’s own pane through its provider', async () => {
    const { instance, fake } = service();
    await instance.openSettings('notifications');
    expect(fake.provider.openSettings).toHaveBeenCalledTimes(1);
  });
});
