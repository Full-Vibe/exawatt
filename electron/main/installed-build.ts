import fs from 'fs';
import type { UpdateReadyNotice } from '@exawatt/core/desktop-bridge';
import { broadcastToWindows } from './window-broadcast';

/**
 * Tells every window when a newer build has been installed underneath the
 * running one. The dogfood installer writes `update-state.json`; this watches
 * it and broadcasts `app:update-ready` whenever the installed sha differs
 * from the sha this process is running. `current()` answers a window that
 * opens or reloads after the broadcast. Whether the operator has already
 * dismissed the notice is the notice record's question, not this one's
 * (`notice-dismissals.ts`, BUG-285).
 */

interface UpdateReadyWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

export function watchInstalledBuild(options: {
  statePath: string;
  currentSha: string;
  allWindows: () => UpdateReadyWindow[];
  intervalMs?: number;
}): {
  stop(): void;
  check(): Promise<void>;
  current(): UpdateReadyNotice | null;
} {
  const { statePath, currentSha } = options;
  let latest: UpdateReadyNotice | null = null;
  const report = async () => {
    try {
      const state = JSON.parse(
        await fs.promises.readFile(statePath, 'utf8')
      ) as {
        installedSha?: string;
      };
      if (state.installedSha && state.installedSha !== currentSha) {
        latest = { currentSha, installedSha: state.installedSha };
        broadcastToWindows(options.allWindows(), 'app:update-ready', latest);
      }
    } catch {
      // No installed update state yet.
    }
  };
  fs.watchFile(
    statePath,
    { interval: options.intervalMs ?? 2_000 },
    () => void report()
  );
  const first = report();
  return {
    stop: () => fs.unwatchFile(statePath),
    current: () => latest,
    check: async () => {
      await first;
      await report();
    },
  };
}
