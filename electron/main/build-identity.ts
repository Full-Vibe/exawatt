import fs from 'fs';
import path from 'path';
import { resolveDistributionIdentity } from '@exawatt/core/distribution';
import {
  assertRendererCompositionAgreement,
  distributionDataPathOverrides,
  loadDevelopmentDistribution,
  loadPackagedDistribution,
  type ResolvedDistribution,
} from './distribution';
import type { BuildInfo } from '@exawatt/core/desktop-bridge';

/**
 * What this process is: the build it came from, the distribution contract it
 * was built for, and the identity that contract resolves to. Read once, at
 * the top of main, before anything else can depend on a guess.
 */

interface BuildIdentity {
  buildInfo: BuildInfo;
  distribution: ResolvedDistribution;
  identity: ReturnType<typeof resolveDistributionIdentity>;
}

export function resolveBuildIdentity(options: {
  isDev: boolean;
  /** Where a development launch finds its prepared distribution. */
  cwd: string;
  /** The directory holding `build-info.json` in a packaged app. */
  mainRoot: string;
  resourcesPath: string;
  now?: () => Date;
}): BuildIdentity {
  const developmentDistribution = options.isDev
    ? loadDevelopmentDistribution(options.cwd)
    : null;
  const buildInfo: BuildInfo = developmentDistribution
    ? {
        sha: 'development',
        branch: 'development',
        builtAt: (options.now ?? (() => new Date()))().toISOString(),
        delivery: 'dogfood',
        distributionDigest: developmentDistribution.digest,
        rendererCompositionDigest: null,
      }
    : JSON.parse(
        fs.readFileSync(path.join(options.mainRoot, 'build-info.json'), 'utf8')
      );
  const distribution =
    developmentDistribution ??
    loadPackagedDistribution({
      mainRoot: options.mainRoot,
      resourcesPath: options.resourcesPath,
      buildInfoDigest: buildInfo.distributionDigest,
    });
  return {
    buildInfo,
    distribution,
    identity: resolveDistributionIdentity(distribution.contract),
  };
}

interface IdentityApp {
  setName(name: string): void;
  getPath(name: 'userData' | 'sessionData'): string;
  setPath(name: 'userData' | 'sessionData', value: string): void;
  commandLine: { appendSwitch(name: string): void };
}

/**
 * Chromium's switch that puts `safeStorage` and the cookie store (OSCrypt) on
 * an in-process mock keychain: encryption stays real, keyed by a fixed mock
 * password, and the login keychain is never read or written. Electron's own
 * spec suite runs its macOS safeStorage cases under it.
 */
export const TEST_KEYCHAIN_SWITCH = 'use-mock-keychain';

/** A test launch that names no throwaway profile, refused before it runs. */
export class TestLaunchRefused extends Error {}

/**
 * Whether this launch is a hermetic test run, and the throwaway profile it
 * runs over. `EXAWATT_TEST=1` is the one test signal: the composition root's
 * `isTest` and every test seam read the same answer. A test run is hermetic
 * or it does not run. It gets its own `userData` and the stand-in keychain
 * together, never one without the other: with the stand-in keychain over the
 * operator's real profile, every cookie it rewrote would be unreadable to his
 * next launch (signed out), and every secret it stored would read back empty.
 * So a test launch with no throwaway profile is refused.
 */
export function hermeticTestRun(
  env: NodeJS.ProcessEnv
): { userData: string } | null {
  if (env.EXAWATT_TEST !== '1') return null;
  if (!env.EXAWATT_USER_DATA) {
    throw new TestLaunchRefused(
      'EXAWATT_TEST=1 needs EXAWATT_USER_DATA: a test launch runs over a throwaway profile, never the real one.'
    );
  }
  return { userData: env.EXAWATT_USER_DATA };
}

/**
 * Names the app and settles its data paths. A hermetic test run gets its own
 * `userData`. Otherwise the established official install keeps its data
 * path, and Community uses its app-id namespace so it can never mutate
 * official state or renderer caches; a stray EXAWATT_USER_DATA outside a test
 * run changes nothing.
 *
 * A test run also never touches the operator's login keychain (BUG-336).
 * Every test build carries a new ad-hoc signature, so the "<App> Safe
 * Storage" item's access list never matches it and macOS stops the operator
 * with a password prompt. `main.ts` calls this first, before `ready` and
 * before anything reads `safeStorage`, which is when a Chromium switch still
 * takes effect.
 */
export function applyBuildIdentity(
  app: IdentityApp,
  build: BuildIdentity,
  env: NodeJS.ProcessEnv
): void {
  const testRun = hermeticTestRun(env);
  if (testRun) {
    app.commandLine.appendSwitch(TEST_KEYCHAIN_SWITCH);
    app.setPath('userData', testRun.userData);
  }
  app.setName(build.identity.productName);
  if (!testRun) {
    const overrides = distributionDataPathOverrides(
      build.distribution.contract,
      {
        userData: app.getPath('userData'),
        sessionData: app.getPath('sessionData'),
      }
    );
    if (overrides.userData) app.setPath('userData', overrides.userData);
    if (overrides.sessionData)
      app.setPath('sessionData', overrides.sessionData);
  }
}

/** A packaged renderer must be the composition this build recorded. */
export function assertPackagedRendererComposition(
  resourcesPath: string,
  buildInfo: BuildInfo
): void {
  const compositionRoot = path.join(resourcesPath, 'renderer');
  assertRendererCompositionAgreement({
    compositionJson: fs.readFileSync(
      path.join(compositionRoot, 'renderer.composition.json'),
      'utf8'
    ),
    compositionDigest: fs
      .readFileSync(
        path.join(compositionRoot, 'renderer.composition.sha256'),
        'utf8'
      )
      .trim(),
    buildInfoDigest: buildInfo.rendererCompositionDigest,
  });
}
