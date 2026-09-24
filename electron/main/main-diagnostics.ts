import path from 'path';
import {
  appCrashFromChildProcessGone,
  appCrashFromMainException,
  appCrashFromRenderProcessGone,
  queueMainAnalyticsEvent,
} from './analytics-bridge';
import { configureJsonStoreDiagnostics } from './atomic-json-file';
import {
  createDiagnosticsLog,
  type DiagnosticRecorder,
} from './diagnostics-log';
import {
  MainThreadStallTrace,
  STALL_LOG_MAX_BYTES,
  installMainThreadStallTrace,
} from './main-thread-stall-trace';
import {
  configureLoginShellScratchDir,
  observedShellStartupArtifacts,
  prepareLoginShellScratchDir,
} from './pty/login-shell';
import {
  UnhandledRejectionTrace,
  installUnhandledRejectionTrace,
} from './unhandled-rejection-trace';

/**
 * Main-process diagnostics: `logs/main.jsonl`, bounded and rotated, alongside
 * `updater.jsonl` / `auth.jsonl` / `summarizer.jsonl`. A recorder that cannot
 * open its file degrades to a no-op — instrumentation must never keep the app
 * from booting.
 */
export function openMainDiagnostics(userDataPath: string): DiagnosticRecorder {
  try {
    return createDiagnosticsLog(
      path.join(userDataPath, 'logs', 'main.jsonl'),
      STALL_LOG_MAX_BYTES
    );
  } catch {
    return () => {};
  }
}

/**
 * The operator's shell startup runs in an Exawatt-owned scratch directory, not
 * in his Projects (incident `0006`). Because Exawatt owns that directory it can
 * also SEE what the startup writes, which is the finding the incident wanted:
 * the files are named in the diagnostics log instead of being discovered as
 * mystery junk in a repository. One observation per run, well after launch.
 */
function watchShellStartupArtifacts(
  userDataPath: string,
  record: DiagnosticRecorder
): void {
  configureLoginShellScratchDir(path.join(userDataPath, 'shell-startup'));
  void prepareLoginShellScratchDir()
    .then(() => {
      const timer = setTimeout(() => {
        void observedShellStartupArtifacts()
          .then(names => {
            if (names.length === 0) return;
            record('shell.startup.writes-files', { names });
          })
          .catch(() => {});
      }, 90_000);
      timer.unref?.();
    })
    .catch(() => {});
}

/** The standing instrumentation, installed once Electron is ready. */
export function installMainInstrumentation(
  userDataPath: string,
  record: DiagnosticRecorder,
  power: { on(event: 'suspend' | 'resume', listener: () => void): unknown }
): void {
  configureJsonStoreDiagnostics(record);
  // Standing main-thread instrumentation: the next beachball records itself.
  // Started before the window so a stall during startup is captured too.
  const stallTrace = installMainThreadStallTrace(
    new MainThreadStallTrace({ record })
  );
  power.on('suspend', () => stallTrace.suspend());
  power.on('resume', () => stallTrace.resume());
  // A rejection nobody awaited used to end as a console line the packaged
  // app does not keep (BUG-129 main half, BUG-146). Bounded and rate-limited
  // like the stall trace; it records, it never recovers.
  installUnhandledRejectionTrace(new UnhandledRejectionTrace({ record }));
  watchShellStartupArtifacts(userDataPath, record);
}

interface CrashApp {
  getVersion(): string;
  on(
    event: 'render-process-gone',
    listener: (
      event: unknown,
      webContents: unknown,
      details: { reason: string }
    ) => void
  ): unknown;
  on(
    event: 'child-process-gone',
    listener: (
      event: unknown,
      details: { type: string; reason: string }
    ) => void
  ): unknown;
}

/**
 * ENG-030 OS1.5b — main-process crash coverage (`app_crashed`). Each listener
 * queues one typed event into the in-memory analytics bridge; it reaches
 * PostHog only if a renderer later drains it through the allowlisted emission
 * path (decision `0034`: main has no analytics destination of its own). A
 * crash at quit that never drains is an accepted loss — no persistence, no
 * extra work on the crash path.
 */
export function installCrashAnalytics(
  app: CrashApp,
  proc: { on(event: 'uncaughtExceptionMonitor', listener: () => void): unknown }
): void {
  app.on('render-process-gone', (_event, _webContents, details) => {
    const crash = appCrashFromRenderProcessGone(
      details.reason,
      app.getVersion()
    );
    if (crash) queueMainAnalyticsEvent(crash);
  });
  app.on('child-process-gone', (_event, details) => {
    const crash = appCrashFromChildProcessGone(
      details.type,
      details.reason,
      app.getVersion()
    );
    if (crash) queueMainAnalyticsEvent(crash);
  });
  // `uncaughtExceptionMonitor` observes without changing Node's default crash
  // behavior — the safe way to see main's own death. Queue-and-hope: if the
  // process dies before a drain, the event is lost, and that is fine.
  proc.on('uncaughtExceptionMonitor', () => {
    try {
      queueMainAnalyticsEvent(appCrashFromMainException(app.getVersion()));
    } catch {
      // Never add a second failure to the crash path.
    }
  });
}
