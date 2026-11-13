import { BrowserWindow, app, powerMonitor } from 'electron';
import { hasLiveAgents, onAgentLaunched } from './analytics-activity';
import {
  MAIN_DELIVERIES,
  MAIN_PLATFORMS,
  queueMainAnalyticsEvent,
  type MainDelivery,
  type MainPlatform,
} from './analytics-bridge';
import { claimActiveDay } from './analytics-identity';

/**
 * ENG-047 F6 — `app_active`, once per local calendar day.
 *
 * `app_launched` fires once per start, and the app stays open for days, so
 * "came back on a later day" could not see anyone who never quits. Main
 * knows when the app is in use: a window has focus, or an Agent it started
 * is running. The first moment of a local day that holds, main claims the
 * day in the device record (`claimActiveDay`, so a restart never counts it
 * twice) and queues `app_active` for the renderer's allowlisted path.
 *
 * Checked on window focus, after an Agent launch, on resume and unlock, and
 * on a coarse timer that crosses midnight for an app left running. Nothing
 * here reads a window's content, a task, or a path.
 */

const ACTIVE_DAY_CHECK_INTERVAL_MS = 10 * 60 * 1000;

interface ActiveDayBuild {
  platform: MainPlatform;
  delivery: MainDelivery;
  appVersion: string | null;
}

export interface ActiveDayDependencies {
  now(): Date;
  /** Some window of this app has focus. */
  windowFocused(): boolean;
  /** An Agent main started is running. */
  agentsRunning(): boolean;
  /** `claimActiveDay`: true once per day, only when kept. */
  claimDay(localDate: string): boolean;
  queue(event: {
    name: 'app_active';
    platform: MainPlatform;
    delivery: MainDelivery;
    appVersion: string | null;
    agentsRunning: boolean;
  }): void;
  build: ActiveDayBuild;
}

/** The local calendar day of `date`, as `YYYY-MM-DD`. */
export function localDateOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function buildForActiveDay(input: {
  platform: string;
  delivery: unknown;
  appVersion: string | null;
}): ActiveDayBuild {
  return {
    platform: (MAIN_PLATFORMS as readonly string[]).includes(input.platform)
      ? (input.platform as MainPlatform)
      : 'unknown',
    delivery: (MAIN_DELIVERIES as readonly unknown[]).includes(input.delivery)
      ? (input.delivery as MainDelivery)
      : 'unknown',
    appVersion: input.appVersion,
  };
}

interface ActiveDayRecorder {
  /** Claim today if the app is in use and today is not claimed yet. */
  check(): void;
}

export function createActiveDayRecorder(
  deps: ActiveDayDependencies
): ActiveDayRecorder {
  /** The day this launch claimed, so later checks today are a date compare.
   *  A refused claim is not remembered: an earlier launch may hold the day,
   *  or the record may have been unreadable, and only a read can tell. */
  let claimed: string | null = null;
  return {
    check() {
      try {
        const agentsRunning = deps.agentsRunning();
        if (!deps.windowFocused() && !agentsRunning) return;
        const today = localDateOf(deps.now());
        if (today === claimed || !deps.claimDay(today)) return;
        claimed = today;
        deps.queue({ name: 'app_active', ...deps.build, agentsRunning });
      } catch {
        // Analytics never propagate a failure into the app.
      }
    },
  };
}

/**
 * Wire the recorder to the running app. Returns the stop; the composition
 * root calls it at quit. The timer is unref'd so it never holds the process.
 */
export function startActiveDayRecorder(build: ActiveDayBuild): () => void {
  const recorder = createActiveDayRecorder({
    now: () => new Date(),
    windowFocused: () => BrowserWindow.getFocusedWindow() !== null,
    agentsRunning: hasLiveAgents,
    claimDay: day => claimActiveDay(day),
    queue: queueMainAnalyticsEvent,
    build,
  });
  const check = () => recorder.check();
  app.on('browser-window-focus', check);
  powerMonitor.on('resume', check);
  powerMonitor.on('unlock-screen', check);
  const removeLaunchListener = onAgentLaunched(check);
  const timer = setInterval(check, ACTIVE_DAY_CHECK_INTERVAL_MS);
  timer.unref();
  check();
  return () => {
    clearInterval(timer);
    removeLaunchListener();
    app.removeListener('browser-window-focus', check);
    powerMonitor.removeListener('resume', check);
    powerMonitor.removeListener('unlock-screen', check);
  };
}
