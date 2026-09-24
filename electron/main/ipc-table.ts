import type { handleTrusted } from './ipc-security';

/**
 * How main's IPC is registered: as data the composition root iterates.
 *
 * A channel table is keyed by the channel's name and holds its handler, and
 * every entry goes through `handleTrusted`, the one door that checks the
 * sender's origin. This module deliberately declares no channel names and no
 * payload types: those belong to the desktop-bridge contract that main,
 * preload and the renderer's types will share, and a table keyed by name can
 * adopt that contract without changing shape.
 */

type TrustedHandler = Parameters<typeof handleTrusted>[1];

/** Handlers keyed by channel name. */
export type TrustedChannels = Readonly<Record<string, TrustedHandler>>;

/** A module that owns its own channels and registers them itself. */
interface IpcModuleRegistration {
  /** For diagnostics and duplicate detection, not a channel name. */
  id: string;
  register(): void;
}

/**
 * Registers every table through `handle`, refusing a channel that two tables
 * both claim. Merging objects would let the later table silently win, which
 * is the failure a table exists to make visible.
 */
export function registerTrustedChannels(
  tables: readonly TrustedChannels[],
  handle: (channel: string, handler: TrustedHandler) => void
): void {
  const claimed = new Set<string>();
  for (const table of tables) {
    for (const channel of Object.keys(table)) {
      if (claimed.has(channel)) {
        throw new Error(`IPC channel ${channel} is registered twice`);
      }
      claimed.add(channel);
    }
  }
  for (const table of tables) {
    for (const [channel, handler] of Object.entries(table)) {
      handle(channel, handler);
    }
  }
}

/** Runs each module's registration once, in table order. */
export function registerIpcModules(
  modules: readonly IpcModuleRegistration[]
): void {
  const seen = new Set<string>();
  for (const entry of modules) {
    if (seen.has(entry.id)) {
      throw new Error(`IPC module ${entry.id} is registered twice`);
    }
    seen.add(entry.id);
  }
  for (const entry of modules) entry.register();
}
