import { app } from 'electron';
import path from 'path';
import {
  applyBuildIdentity,
  resolveBuildIdentity,
  TestLaunchRefused,
} from './build-identity';

let launched: ReturnType<typeof resolveBuildIdentity> | null = null;

/**
 * This process's build identity, resolved and applied once. `main.ts` calls
 * it first, because the profile it settles is what the instance lock is
 * keyed by; the composition root reads the same answer.
 */
export function launchBuildIdentity(): ReturnType<typeof resolveBuildIdentity> {
  if (launched) return launched;
  launched = resolveBuildIdentity({
    isDev: process.env.NODE_ENV === 'development',
    cwd: process.cwd(),
    mainRoot: path.join(__dirname, '..'),
    resourcesPath: process.resourcesPath,
  });
  try {
    applyBuildIdentity(app, launched, process.env);
  } catch (error) {
    // Said on stderr, where the launching eval reads it, and ended before
    // anything touches a profile. An uncaught throw would also stop the
    // launch, but behind a modal error dialog on the operator's screen.
    if (!(error instanceof TestLaunchRefused)) throw error;
    console.error(error.message);
    process.exit(1);
  }
  return launched;
}
