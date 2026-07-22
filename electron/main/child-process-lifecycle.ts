import type { ChildProcess } from 'child_process';

export interface StopChildProcessOptions {
  forceAfterMs: number;
  failAfterMs: number;
  failureMessage: string;
}

function hasStopped(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** One truthful child-process shutdown edge: graceful signal, bounded force,
 * then rejection. Ownership stays with the caller until this resolves, so a
 * failed stop remains retryable instead of orphaning the process handle. */
export async function stopChildProcess(
  child: ChildProcess,
  options: StopChildProcessOptions
): Promise<void> {
  if (hasStopped(child)) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let failureTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(failureTimer);
      child.off('close', closed);
      if (error) reject(error);
      else resolve();
    };
    const closed = () => finish();
    child.once('close', closed);

    try {
      child.kill('SIGTERM');
    } catch (cause) {
      finish(cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }
    if (hasStopped(child)) {
      finish();
      return;
    }

    forceTimer = setTimeout(() => {
      if (hasStopped(child)) return;
      try {
        child.kill('SIGKILL');
      } catch (cause) {
        finish(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }, options.forceAfterMs);
    failureTimer = setTimeout(
      () => finish(new Error(options.failureMessage)),
      options.failAfterMs
    );
  });
}
