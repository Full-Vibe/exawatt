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

/**
 * What this process is: the build it came from, the distribution contract it
 * was built for, and the identity that contract resolves to. Read once, at
 * the top of main, before anything else can depend on a guess.
 */

export interface BuildInfo {
  sha: string;
  branch: string;
  builtAt: string;
  delivery: 'dogfood' | 'signed';
  distributionDigest: string;
  rendererCompositionDigest: string | null;
}

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
}

/**
 * Names the app and settles its data paths. A hermetic test run gets its own
 * `userData`, gated on EXAWATT_TEST so a stray variable in a normal launch can
 * never redirect real data. Otherwise the established official install keeps
 * its data path, and Community uses its app-id namespace so it can never
 * mutate official state or renderer caches.
 */
export function applyBuildIdentity(
  app: IdentityApp,
  build: BuildIdentity,
  env: NodeJS.ProcessEnv
): void {
  if (env.EXAWATT_TEST && env.EXAWATT_USER_DATA) {
    app.setPath('userData', env.EXAWATT_USER_DATA);
  }
  app.setName(build.identity.productName);
  if (!env.EXAWATT_USER_DATA) {
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
