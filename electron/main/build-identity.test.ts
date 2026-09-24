import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  COMMUNITY_DISTRIBUTION,
  resolveDistributionIdentity,
  serializeDistributionContract,
} from '@exawatt/core/distribution';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyBuildIdentity,
  assertPackagedRendererComposition,
  resolveBuildIdentity,
  type BuildInfo,
} from './build-identity';

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-identity-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A packaged app's main root and resources, agreeing unless told not to. */
function packagedTree(options: { rendererDigest?: string } = {}) {
  const canonical = serializeDistributionContract(COMMUNITY_DISTRIBUTION);
  const digest = sha256(canonical);
  const mainRoot = path.join(root, 'app');
  const resourcesPath = path.join(root, 'Resources');
  fs.mkdirSync(mainRoot, { recursive: true });
  fs.mkdirSync(path.join(resourcesPath, 'renderer'), { recursive: true });
  const buildInfo: BuildInfo = {
    sha: 'abcdef0123456789',
    branch: 'master',
    builtAt: '2026-09-23T00:00:00.000Z',
    delivery: 'signed',
    distributionDigest: digest,
    rendererCompositionDigest: null,
  };
  fs.writeFileSync(
    path.join(mainRoot, 'build-info.json'),
    JSON.stringify(buildInfo)
  );
  fs.writeFileSync(path.join(mainRoot, 'distribution.json'), canonical);
  fs.writeFileSync(path.join(mainRoot, 'distribution.sha256'), `${digest}\n`);
  fs.writeFileSync(
    path.join(resourcesPath, 'renderer', 'distribution.sha256'),
    `${options.rendererDigest ?? digest}\n`
  );
  return { mainRoot, resourcesPath, buildInfo };
}

describe('resolveBuildIdentity', () => {
  it('reads a packaged build from its build info and its agreeing contract copies', () => {
    const { mainRoot, resourcesPath, buildInfo } = packagedTree();

    const build = resolveBuildIdentity({
      isDev: false,
      cwd: root,
      mainRoot,
      resourcesPath,
    });

    expect(build.buildInfo).toEqual(buildInfo);
    expect(build.distribution.contract).toEqual(COMMUNITY_DISTRIBUTION);
    expect(build.identity).toEqual(
      resolveDistributionIdentity(COMMUNITY_DISTRIBUTION)
    );
  });

  it('refuses a package whose renderer was built for another contract', () => {
    const { mainRoot, resourcesPath } = packagedTree({
      rendererDigest: sha256('another contract'),
    });
    expect(() =>
      resolveBuildIdentity({ isDev: false, cwd: root, mainRoot, resourcesPath })
    ).toThrow('Distribution artifact disagreement');
  });

  it('describes a development launch without a prepared contract as the community build', () => {
    const build = resolveBuildIdentity({
      isDev: true,
      cwd: root,
      mainRoot: path.join(root, 'missing'),
      resourcesPath: path.join(root, 'missing'),
      now: () => new Date('2026-09-23T12:00:00.000Z'),
    });

    expect(build.buildInfo).toEqual({
      sha: 'development',
      branch: 'development',
      builtAt: '2026-09-23T12:00:00.000Z',
      delivery: 'dogfood',
      distributionDigest: build.distribution.digest,
      rendererCompositionDigest: null,
    });
    expect(build.distribution.contract).toEqual(COMMUNITY_DISTRIBUTION);
  });
});

describe('applyBuildIdentity', () => {
  function fakeApp() {
    const paths: Record<string, string> = {
      userData: '/Users/op/Library/Application Support/Exawatt',
      sessionData: '/Users/op/Library/Application Support/Exawatt',
    };
    let name = '';
    return {
      paths,
      name: () => name,
      app: {
        setName: (value: string) => {
          name = value;
        },
        getPath: (key: 'userData' | 'sessionData') => paths[key],
        setPath: (key: 'userData' | 'sessionData', value: string) => {
          paths[key] = value;
        },
      },
    };
  }
  const build = () =>
    resolveBuildIdentity({
      isDev: true,
      cwd: root,
      mainRoot: root,
      resourcesPath: root,
    });

  it('names the app and moves the community build into its own namespace', () => {
    const { app, paths, name } = fakeApp();
    const identity = resolveDistributionIdentity(COMMUNITY_DISTRIBUTION);

    applyBuildIdentity(app, build(), {});

    expect(name()).toBe(identity.productName);
    expect(path.basename(paths.userData)).toBe(identity.stateNamespace);
    expect(path.basename(paths.sessionData)).toBe(
      `${identity.cacheNamespace}.cache`
    );
  });

  it('gives a hermetic test run the userData it asked for, and nothing else', () => {
    const { app, paths } = fakeApp();
    applyBuildIdentity(app, build(), {
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: '/tmp/eval-user-data',
    });
    expect(paths.userData).toBe('/tmp/eval-user-data');
    expect(paths.sessionData).toBe(
      '/Users/op/Library/Application Support/Exawatt'
    );
  });

  it('never redirects real data on a stray variable outside a test run', () => {
    const { app, paths } = fakeApp();
    applyBuildIdentity(app, build(), {
      EXAWATT_USER_DATA: '/tmp/eval-user-data',
    });
    expect(paths.userData).toBe(
      '/Users/op/Library/Application Support/Exawatt'
    );
  });
});

describe('assertPackagedRendererComposition', () => {
  function composition(recorded: string | null) {
    const json = '{"profile":"community"}';
    const dir = path.join(root, 'renderer');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'renderer.composition.json'), json);
    fs.writeFileSync(
      path.join(dir, 'renderer.composition.sha256'),
      `${sha256(json)}\n`
    );
    return {
      digest: sha256(json),
      buildInfo: { rendererCompositionDigest: recorded } as BuildInfo,
    };
  }

  it('accepts the composition the build recorded', () => {
    const { digest } = composition(null);
    expect(() =>
      assertPackagedRendererComposition(root, {
        rendererCompositionDigest: digest,
      } as BuildInfo)
    ).not.toThrow();
  });

  it('refuses a renderer the build did not record', () => {
    const { buildInfo } = composition(sha256('another composition'));
    expect(() => assertPackagedRendererComposition(root, buildInfo)).toThrow(
      'Renderer composition disagreement'
    );
  });
});
