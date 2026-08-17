// Generated for the public repository by the "public-dogfood-tooling" recipe.
/**
 * One answer to "which package did this repository just build, and what did its
 * contract promise the package would contain?".
 *
 * Before `8309d740` there was exactly one composition, so every packaged eval
 * could spell the bundle out as `release/mac-arm64/Exawatt.app` and be right.
 * The distribution contract is an INPUT now: `prepare-electron-builder-config`
 * feeds electron-builder a config whose `productName`/`appId` come from
 * `resolveDistributionIdentity(preparedContract)`, and the DEFAULT contract
 * names the product `Exawatt Community`. Every literal became a launch of a
 * path that does not exist (BUG-043).
 *
 * This resolves the contract through the same selector `prepare-distribution`
 * uses and the same `resolveDistributionIdentity` the builder config is
 * projected through, so a third distribution cannot break the evals again.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  distributionDigest,
  selectDistributionContract,
} from './distribution-build.mjs';
import { readAsarFile } from './asar.mjs';

const require = createRequire(import.meta.url);

/** electron-builder's macOS output directory for the only arch this repo ships. */
export const MAC_OUTPUT_DIR = path.join('release', 'mac-arm64');

export function packagedBuilderConfigPath(
  root = process.cwd(),
  profile = 'base'
) {
  return path.join(root, '.exawatt-build', `electron-builder.${profile}.json`);
}

/**
 * @param {{ root?: string, appPathOverride?: string | undefined }} [options]
 *   `appPathOverride` is the `EXAWATT_APP_PATH` escape hatch. It moves the
 *   BUNDLE, never the expectations: the contract still decides what the package
 *   owes, and `assertPackagedContract` proves the two agree.
 */
export async function resolvePackagedApp({
  root = process.cwd(),
  appPathOverride = process.env.EXAWATT_APP_PATH,
  inputJson = process.env.EXAWATT_DISTRIBUTION_CONFIG_JSON,
} = {}) {
  // Read the shell's INTENT, not `.exawatt-build/distribution.json`. The
  // prepared artifact is whatever the last build left behind, so resolving from
  // it lets an official-contract shell silently prove the community package —
  // the inverse of the failure incident `0015` was written about. `pnpm build`
  // resolves the same env through the same selector moments later.
  const {
    resolveDistributionIdentity,
    serializeDistributionContract,
  } = require('@exawatt/core/distribution');
  const contract = selectDistributionContract(inputJson);
  const prepared = {
    contract,
    digest: distributionDigest(serializeDistributionContract(contract)),
  };
  const identity = resolveDistributionIdentity(prepared.contract);
  const relativeAppPath = path.join(
    MAC_OUTPUT_DIR,
    `${identity.productName}.app`
  );
  // electron-builder names the mac executable after productName, which is also
  // what `app.setName(distributionIdentity.productName)` reports at runtime.
  const relativeExecutablePath = path.join(
    relativeAppPath,
    'Contents',
    'MacOS',
    identity.productName
  );
  const builtAppPath = path.join(root, relativeAppPath);
  const builtExecutablePath = path.join(root, relativeExecutablePath);
  const executablePath = appPathOverride
    ? path.resolve(appPathOverride)
    : builtExecutablePath;
  const appPath = appPathOverride ? appBundleOf(executablePath) : builtAppPath;
  return {
    contract: prepared.contract,
    digest: prepared.digest,
    identity,
    appPath,
    executablePath,
    relativeAppPath,
    relativeExecutablePath,
    /** The contract is the only thing that decides this (`main.ts`). */
    productUpdatesEnabled: prepared.contract.updates !== null,
  };
}

/**
 * Release and operator dogfood are official-distribution custody paths. They
 * must never inherit the public community fallback merely because their
 * private configuration was absent from the shell.
 */
export async function requireOfficialPackagedApp({
  root = process.cwd(),
  appPathOverride = process.env.EXAWATT_APP_PATH,
  inputJson = process.env.EXAWATT_DISTRIBUTION_CONFIG_JSON,
  purpose = 'Official distribution',
} = {}) {
  if (typeof inputJson !== 'string' || inputJson.trim().length === 0) {
    throw new Error(
      `${purpose} requires EXAWATT_DISTRIBUTION_CONFIG_JSON. ` +
        'GitHub Releases must read it from the repository secret with that name; ' +
        'local dogfood reads the same variable from the linked .env.local or the shell.'
    );
  }
  const packaged = await resolvePackagedApp({
    root,
    appPathOverride,
    inputJson,
  });
  if (packaged.contract.brand === null) {
    throw new Error(`${purpose} requires a branded distribution contract.`);
  }
  if (packaged.contract.updates === null) {
    throw new Error(
      `${purpose} requires an official update feed in distribution.updates.`
    );
  }
  return packaged;
}

/** Read the exact projected builder input and prove it matches the contract. */
export function readPackagedBuilderConfig(
  packaged,
  { root = process.cwd(), profile = 'base' } = {}
) {
  const configPath = packagedBuilderConfigPath(root, profile);
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Resolved ${profile} builder config is missing or invalid at ${configPath}; ` +
        `prepare that profile from the distribution contract first.`,
      { cause: error }
    );
  }
  if (
    config.appId !== packaged.identity.appId ||
    config.productName !== packaged.identity.productName
  ) {
    throw new Error(
      `Resolved ${profile} builder identity ${config.productName} (${config.appId}) ` +
        `does not match the dispatched distribution ${packaged.identity.productName} ` +
        `(${packaged.identity.appId}).`
    );
  }
  const publish = Array.isArray(config.publish)
    ? config.publish[0]
    : config.publish;
  const expectedFeed = packaged.contract.updates?.feedUrl;
  if (
    expectedFeed &&
    (publish?.provider !== 'generic' || publish?.url !== expectedFeed)
  ) {
    throw new Error(
      `Resolved ${profile} builder feed ${publish?.url ?? '(absent)'} does not ` +
        `match the dispatched distribution feed ${expectedFeed}.`
    );
  }
  return config;
}

/** `<name>.app/Contents/MacOS/<name>` → `<name>.app`, and a bundle path unchanged. */
export function appBundleOf(target) {
  const resolved = path.resolve(target);
  if (resolved.endsWith('.app')) return resolved;
  return path.resolve(resolved, '..', '..', '..');
}

/**
 * Refuse to assert a contract's promises against a package built from a
 * different one.
 *
 * The packaged app carries the digest in three places and `loadPackagedDistribution`
 * already refuses if they disagree. This is the outside view of the same
 * agreement, and it is what turns "the updater group is missing" into "you are
 * testing a package this contract did not build".
 */
export function assertPackagedContract(appPath, expectedDigest) {
  const digestPath = path.join(
    appPath,
    'Contents',
    'Resources',
    'renderer',
    'distribution.sha256'
  );
  if (!existsSync(digestPath)) {
    throw new Error(
      `${appPath} carries no Contents/Resources/renderer/distribution.sha256, so ` +
        "it was not packed by this repository's renderer pipeline."
    );
  }
  const packaged = readFileSync(digestPath, 'utf8').trim();
  if (packaged !== expectedDigest) {
    throw new Error(
      `${appPath} was built from distribution ${packaged.slice(0, 12)}, but the ` +
        `prepared contract is ${expectedDigest.slice(0, 12)}. Re-run the build, ` +
        'or point EXAWATT_APP_PATH at the package this contract produced.'
    );
  }
}

/** Read the source identity embedded in the packaged Electron main process. */
export function readPackagedBuildInfo(appPath) {
  const archive = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  let buildInfo;
  try {
    buildInfo = JSON.parse(
      readAsarFile(archive, 'dist-electron/build-info.json').toString('utf8')
    );
  } catch (error) {
    throw new Error(`${appPath} has no valid packaged build-info.json`, {
      cause: error,
    });
  }
  if (
    !buildInfo ||
    typeof buildInfo !== 'object' ||
    typeof buildInfo.sha !== 'string' ||
    buildInfo.sha.trim().length === 0
  ) {
    throw new Error(`${appPath} carries no source SHA in packaged build-info`);
  }
  return buildInfo;
}

/** Refuse a package built from a different source tree. */
export function assertPackagedSource(appPath, expectedSha) {
  const buildInfo = readPackagedBuildInfo(appPath);
  if (buildInfo.sha !== expectedSha) {
    throw new Error(
      `${appPath} was built from source ${buildInfo.sha}, but this gate expects ` +
        `${expectedSha}. Rebuild the package or supply the exact expected SHA.`
    );
  }
  return buildInfo;
}

/** The executable path, for the evals that only need somewhere to launch. */
export async function packagedExecutable(options) {
  return (await resolvePackagedApp(options)).executablePath;
}

/** The bundle path, for the evals that inspect the .app rather than run it. */
export async function packagedAppBundle(options) {
  return (await resolvePackagedApp(options)).appPath;
}
