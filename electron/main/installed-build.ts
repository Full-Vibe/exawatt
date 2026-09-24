import fs from 'fs';

/**
 * Tells every window when a newer build has been installed underneath the
 * running one. The dogfood installer writes `update-state.json`; this watches
 * it and broadcasts `app:update-ready` whenever the installed sha differs
 * from the sha this process is running.
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
}): { stop(): void; check(): Promise<void> } {
  const { statePath, currentSha } = options;
  const report = async () => {
    try {
      const state = JSON.parse(
        await fs.promises.readFile(statePath, 'utf8')
      ) as {
        installedSha?: string;
      };
      if (state.installedSha && state.installedSha !== currentSha) {
        for (const win of options.allWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('app:update-ready', {
              currentSha,
              installedSha: state.installedSha,
            });
          }
        }
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
    check: async () => {
      await first;
      await report();
    },
  };
}
