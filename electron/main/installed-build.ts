import fs from 'fs';
import path from 'path';
import type {
  MoveToApplicationsOffer,
  MoveToApplicationsOutcome,
  UpdateReadyNotice,
} from '@exawatt/core/desktop-bridge';
import type { TrustedChannels } from './ipc-table';
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

/**
 * Where the running copy lives against where Exawatt is installed (BUG-305).
 *
 * An official build run from a disk image, from Downloads or from a build
 * folder cannot update itself the way the installed one does, and a stale
 * copy left there is how an August build came to run beside the current one.
 * So an official build running from outside Applications offers to move
 * itself there, through Electron's own mover, which relaunches it from
 * Applications and trashes the copy it replaces. It never offers to replace a
 * build in Applications that is newer than itself, or one it cannot read.
 */

/** The two facts a build is compared by. */
interface BuildStamp {
  version: string;
  builtAt: string;
}

/** Electron's mover (`app.isInApplicationsFolder`, `moveToApplicationsFolder`). */
interface ApplicationsMover {
  isInApplicationsFolder(): boolean;
  moveToApplicationsFolder(options: {
    conflictHandler: (conflict: 'exists' | 'existsAndRunning') => boolean;
  }): boolean;
}

/** `absent` when nothing is at the path; `unreadable` when something is. */
export type InstalledCopy = BuildStamp | 'absent' | 'unreadable';

function versionParts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

/** Whether `installed` is strictly older than `running`. */
export function isOlderBuild(installed: BuildStamp, running: BuildStamp) {
  const a = versionParts(installed.version);
  const b = versionParts(running.version);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  const installedAt = Date.parse(installed.builtAt);
  const runningAt = Date.parse(running.builtAt);
  return (
    Number.isFinite(installedAt) &&
    Number.isFinite(runningAt) &&
    installedAt < runningAt
  );
}

/** Reads a bundle's version and build time out of its archive. Electron's
 *  `fs` reads inside `app.asar`, so this needs no archive reader. */
export function readInstalledCopy(
  appPath: string,
  read: (file: string) => string = file => fs.readFileSync(file, 'utf8')
): InstalledCopy {
  if (!fs.existsSync(appPath)) return 'absent';
  const archive = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  try {
    const { version } = JSON.parse(read(path.join(archive, 'package.json')));
    const { builtAt } = JSON.parse(
      read(path.join(archive, 'dist-electron', 'build-info.json'))
    );
    if (typeof version !== 'string' || typeof builtAt !== 'string') {
      return 'unreadable';
    }
    return { version, builtAt };
  } catch {
    return 'unreadable';
  }
}

export function createApplicationsPlacement(deps: {
  /** An official, packaged macOS build in a normal launch. */
  offered: boolean;
  /** The running `.app`. */
  bundlePath: string;
  running: BuildStamp;
  mover: ApplicationsMover;
  installedCopy: (appPath: string) => InstalledCopy;
  applicationsDirectory?: string;
  record: (event: string, fields: Record<string, unknown>) => void;
}): {
  offer(): MoveToApplicationsOffer | null;
  move(): MoveToApplicationsOutcome;
  channels: TrustedChannels;
} {
  const destination = path.join(
    deps.applicationsDirectory ?? '/Applications',
    path.basename(deps.bundlePath)
  );
  const offer = (): MoveToApplicationsOffer | null => {
    if (!deps.offered || deps.mover.isInApplicationsFolder()) return null;
    const installed = deps.installedCopy(destination);
    if (installed === 'unreadable') return null;
    if (installed !== 'absent' && !isOlderBuild(installed, deps.running)) {
      return null;
    }
    return { location: deps.bundlePath };
  };
  const move = (): MoveToApplicationsOutcome => {
    if (!offer()) return 'not-moved';
    let conflict: 'exists' | 'existsAndRunning' | null = null;
    try {
      const moved = deps.mover.moveToApplicationsFolder({
        // The copy there is older (`offer`), so it may be replaced; one that
        // is open is never closed from here.
        conflictHandler: type => {
          conflict = type;
          return type === 'exists';
        },
      });
      deps.record('placement.move', { moved, conflict });
      if (moved) return 'moving';
      return conflict === 'existsAndRunning' ? 'other-copy-open' : 'not-moved';
    } catch (error) {
      deps.record('placement.move-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  };
  return {
    offer,
    move,
    channels: {
      'app:move-to-applications-offer': () => offer(),
      'app:move-to-applications': () => move(),
    },
  };
}
