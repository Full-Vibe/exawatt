import type { DesktopBridgeRequestChannel } from '@exawatt/core/desktop-bridge';
import type { TrustedHandler } from './ipc-security';

/**
 * How main's IPC is registered: as data the composition root iterates.
 *
 * A channel table is keyed by the channel's name and holds its handler, and
 * every entry goes through `handleTrusted`, the one door that checks the
 * sender's origin. The names and payloads are the desktop bridge contract's
 * (`@exawatt/core/desktop-bridge`): a key the contract does not declare, or a
 * handler whose arguments or answer drift from it, fails `tsc`.
 */

/** Handlers keyed by channel name, each typed by its channel. */
export type TrustedChannels = {
  readonly [C in DesktopBridgeRequestChannel]?: TrustedHandler<C>;
};

/** The one door every table entry is registered through. */
type RegisterTrusted = <C extends DesktopBridgeRequestChannel>(
  channel: C,
  handler: TrustedHandler<C>
) => void;

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
  handle: RegisterTrusted
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
    // Each key and its handler were checked together where the table was
    // written; iteration only loses the correlation, not the check.
    for (const channel of Object.keys(table) as DesktopBridgeRequestChannel[]) {
      handle(channel, table[channel] as TrustedHandler<typeof channel>);
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
