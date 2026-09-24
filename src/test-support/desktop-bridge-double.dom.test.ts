import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBridgeDouble,
  installBridgeDouble,
  removeBridgeDouble,
} from './desktop-bridge-double';

/**
 * The double cannot be more capable than the bridge. The `@ts-expect-error`
 * lines are the compile-time half: `pnpm type-check` fails if any of them
 * stops being an error, which is what would happen if the double learned to
 * accept a member, or a callback, that preload cannot carry.
 */
describe('the desktop bridge double', () => {
  afterEach(() => removeBridgeDouble());

  it('installs a partial bridge and removes it', () => {
    const list = vi.fn(async () => []);
    installBridgeDouble({ pty: { list } });
    expect(window.electron?.isElectron).toBe(true);
    expect(window.electron?.pty.list).toBe(list);
    expect(window.electron?.settings).toBeUndefined();
    removeBridgeDouble();
    expect(window.electron).toBeUndefined();
  });

  it('refuses a namespace the bridge does not have, even through a cast', () => {
    expect(() =>
      createBridgeDouble({ terminal: {} } as unknown as Parameters<
        typeof createBridgeDouble
      >[0])
    ).toThrow('Not part of the desktop bridge contract: terminal');
  });

  it('refuses, at compile time, members and callbacks preload cannot carry', () => {
    createBridgeDouble({
      pty: {
        // @ts-expect-error: `pty` has no `bogus` member.
        bogus: vi.fn(),
      },
    });

    // A spec built in a variable is not a fresh literal, so this is the
    // double's own check rather than TypeScript's excess-property rule.
    const built = { pty: { list: vi.fn(async () => []), bogus: vi.fn() } };
    // @ts-expect-error: `pty.bogus` is still not a bridge member.
    createBridgeDouble(built);

    createBridgeDouble({
      connectedSources: {
        // @ts-expect-error: `connect` takes an id; a progress callback cannot
        // cross `ipcRenderer.invoke`, so the bridge never offers one.
        connect: async (_id: string, _onProgress: (phase: string) => void) =>
          ({}) as never,
      },
    });

    expect(true).toBe(true);
  });
});
