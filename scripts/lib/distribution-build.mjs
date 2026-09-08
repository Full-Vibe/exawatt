import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';

import { decodePng, icnsImageSlices } from './app-icon.mjs';

const require = createRequire(import.meta.url);

function distributionCore() {
  try {
    return require('@exawatt/core/distribution');
  } catch (error) {
    throw new Error(
      'Distribution resolver requires the built @exawatt/core runtime; run `pnpm --filter @exawatt/core types:build` first.',
      { cause: error }
    );
  }
}

export function distributionCoreParse(json) {
  const { parseDistributionContractJson } = distributionCore();
  return parseDistributionContractJson(json);
}

export function distributionDigest(canonical) {
  return createHash('sha256').update(canonical).digest('hex');
}

export function distributionArtifactPaths(root) {
  const directory = path.join(root, '.exawatt-build');
  return {
    directory,
    contract: path.join(directory, 'distribution.json'),
    digest: path.join(directory, 'distribution.sha256'),
    webIcon: path.join(directory, 'distribution-web-icon.png'),
    webIconDigest: path.join(directory, 'distribution-web-icon.sha256'),
  };
}

export const DISTRIBUTION_WEB_ICON_URL = '/exawatt-distribution/icon.png';

export function distributionWebIconPath(root) {
  return distributionArtifactPaths(root).webIcon;
}

/**
 * Project the contract-owned macOS artwork into the browser asset boundary.
 *
 * `brand.iconPath` is already the distributor's explicit, repository-relative
 * asset source. Requiring a second magic `/icon.png` file made the desktop and
 * browser identities disagree for every downstream distributor. Build
 * preparation now extracts the largest PNG representation from that one ICNS
 * source and seals it beside the prepared contract. Next materializes the
 * bytes through one stable route without changing the source tree.
 */
export async function prepareDistributionWebIcon({ root, contract }) {
  const { resolveDistributionIdentity } = distributionCore();
  const identity = resolveDistributionIdentity(contract);
  if (!identity.iconPath) {
    throw new Error(
      `Distribution ${identity.productName} has no icon source; brand.iconPath must name a repository-relative ICNS file.`
    );
  }

  const rootReal = await realpath(root);
  const declaredSource = path.resolve(root, identity.iconPath);
  let source;
  try {
    source = await realpath(declaredSource);
  } catch (cause) {
    throw new Error(
      `Distribution web icon source is missing: ${identity.iconPath}`,
      { cause }
    );
  }
  if (source !== rootReal && !source.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(
      `Distribution web icon source escapes the repository: ${identity.iconPath}`
    );
  }
  const details = await stat(source);
  if (!details.isFile()) {
    throw new Error(
      `Distribution web icon source is not a file: ${identity.iconPath}`
    );
  }

  let slices;
  try {
    slices = icnsImageSlices(await readFile(source));
  } catch (cause) {
    throw new Error(
      `Distribution web icon source is not a supported ICNS file: ${identity.iconPath}`,
      { cause }
    );
  }
  const largest = slices[0];
  if (!largest) {
    throw new Error(
      `Distribution web icon source has no PNG representation: ${identity.iconPath}`
    );
  }

  const paths = distributionArtifactPaths(root);
  const output = paths.webIcon;
  await mkdir(path.dirname(output), { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const iconTemporary = `${output}.${nonce}.tmp`;
  const digestTemporary = `${paths.webIconDigest}.${nonce}.tmp`;
  const digest = distributionDigest(largest.png);
  await Promise.all([
    writeFile(iconTemporary, largest.png),
    writeFile(digestTemporary, `${digest}\n`, 'utf8'),
  ]);
  await rename(iconTemporary, output);
  await rename(digestTemporary, paths.webIconDigest);
  return {
    source: identity.iconPath,
    output,
    url: DISTRIBUTION_WEB_ICON_URL,
    digest,
    width: largest.image.width,
    height: largest.image.height,
  };
}

export async function readPreparedDistributionWebIcon(root) {
  const paths = distributionArtifactPaths(root);
  const [icon, expectedDigest] = await Promise.all([
    readFile(paths.webIcon),
    readFile(paths.webIconDigest, 'utf8'),
  ]).catch(error => {
    throw new Error(
      'Prepared distribution web icon is missing; run `pnpm distribution:prepare` first.',
      { cause: error }
    );
  });
  const digest = distributionDigest(icon);
  if (digest !== expectedDigest.trim()) {
    throw new Error(
      `Prepared distribution web icon digest mismatch: expected ${expectedDigest.trim()}, computed ${digest}`
    );
  }
  try {
    decodePng(icon);
  } catch (cause) {
    throw new Error('Prepared distribution web icon is not a supported PNG.', {
      cause,
    });
  }
  return icon;
}

/**
 * The one place an absent config becomes the community contract.
 *
 * Exported so a reader that must NOT write build state — the packaged evals,
 * which have to know which package the current shell's contract would produce
 * (BUG-043) — asks this instead of keeping a second copy of the answer.
 */
/**
 * Operator-local custody for the official contract.
 *
 * Lives OUTSIDE every checkout on purpose. A path inside the repository would
 * be one `git add` from publication, would be re-pulled or clobbered by
 * `pnpm env:pull`, and would have to be classified by Gate A. A home-directory
 * file is shared by every worktree the operator owns, survives environment
 * refreshes, and cannot be committed by any agent.
 *
 * Vercel Development deliberately does NOT carry the official contract
 * (incident `0017`): an agent worktree must not inherit official custody. This
 * file is the operator's own third consumer, and it is read ONLY when a build
 * explicitly declares itself official.
 */
export const OFFICIAL_CUSTODY_FILE = path.join(
  homedir(),
  '.exawatt',
  'distribution.official.json'
);

export const DISTRIBUTION_PROFILE_ENV = 'EXAWATT_DISTRIBUTION_PROFILE';
export const DISTRIBUTION_CONFIG_ENV = 'EXAWATT_DISTRIBUTION_CONFIG_JSON';

/**
 * Read operator custody. Never a fallback: only an explicit
 * `EXAWATT_DISTRIBUTION_PROFILE=official` reaches here.
 *
 * Silence is the failure mode this guards against. Incident `0017` shipped a
 * community website for eighteen hours because an absent input downgraded
 * instead of refusing, so every failure below throws with the path named.
 */
export async function readOfficialCustody(file = OFFICIAL_CUSTODY_FILE) {
  let details;
  try {
    details = await stat(file);
  } catch {
    throw new Error(
      `Official distribution custody is missing: ${file}\n` +
        'Write the validated official contract there with mode 0600 (schema 2; ' +
        'a schema-1 file is still accepted and reads as ownAccount: null), or ' +
        'build without EXAWATT_DISTRIBUTION_PROFILE=official for a community build.'
    );
  }
  if (!details.isFile()) {
    throw new Error(`Official distribution custody is not a file: ${file}`);
  }
  // Group/other bits set means another local account can read the contract.
  if ((details.mode & 0o077) !== 0) {
    throw new Error(
      `Official distribution custody ${file} is group/world readable; run: chmod 600 ${file}`
    );
  }
  return readFile(file, 'utf8');
}

/**
 * The single resolver every build path shares.
 *
 * Order is deliberate, and the amendment of 2026-08-17 is the reason: an
 * absent input may default to community ONLY where community is a legitimate
 * artifact. A target that must be official declares itself, and a declared
 * official build that cannot find its contract FAILS rather than downgrading.
 */
export async function resolveDistributionInput(env = process.env) {
  const explicit = env[DISTRIBUTION_CONFIG_ENV];
  if (explicit !== undefined) return { inputJson: explicit, source: 'env' };
  const profile = env[DISTRIBUTION_PROFILE_ENV];
  if (profile === undefined || profile === 'community') {
    return { inputJson: undefined, source: 'community-default' };
  }
  if (profile !== 'official') {
    throw new Error(
      `${DISTRIBUTION_PROFILE_ENV} must be "official" or "community"; received ${JSON.stringify(profile)}`
    );
  }
  return {
    inputJson: await readOfficialCustody(),
    source: 'operator-custody',
  };
}

export function selectDistributionContract(inputJson) {
  const { COMMUNITY_DISTRIBUTION, parseDistributionContractJson } =
    distributionCore();
  try {
    return inputJson === undefined
      ? COMMUNITY_DISTRIBUTION
      : parseDistributionContractJson(inputJson);
  } catch (error) {
    throw new Error(
      `Distribution config is present but invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export async function prepareDistribution({ root, inputJson }) {
  const { serializeDistributionContract } = distributionCore();
  const contract = selectDistributionContract(inputJson);
  const canonical = serializeDistributionContract(contract);
  const digest = distributionDigest(canonical);
  const paths = distributionArtifactPaths(root);
  await mkdir(paths.directory, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const contractTemp = `${paths.contract}.${nonce}.tmp`;
  const digestTemp = `${paths.digest}.${nonce}.tmp`;
  await writeFile(contractTemp, `${canonical}\n`, 'utf8');
  await writeFile(digestTemp, `${digest}\n`, 'utf8');
  await rename(contractTemp, paths.contract);
  await rename(digestTemp, paths.digest);
  return { contract, canonical, digest };
}

export async function readPreparedDistribution(root) {
  const { parseDistributionContractJson, serializeDistributionContract } =
    distributionCore();
  const paths = distributionArtifactPaths(root);
  const [rawContract, expectedDigest] = await Promise.all([
    readFile(paths.contract, 'utf8'),
    readFile(paths.digest, 'utf8'),
  ]).catch(error => {
    throw new Error(
      'Prepared distribution artifact is missing; run `pnpm distribution:prepare` first.',
      { cause: error }
    );
  });
  const contract = parseDistributionContractJson(rawContract);
  const canonical = serializeDistributionContract(contract);
  const digest = distributionDigest(canonical);
  if (digest !== expectedDigest.trim()) {
    throw new Error(
      `Prepared distribution digest mismatch: expected ${expectedDigest.trim()}, computed ${digest}`
    );
  }
  return { contract, canonical, digest };
}

export function nextDistributionEnvironment(
  prepared,
  ambient = process.env,
  webIcon = undefined
) {
  const account = prepared.contract.account;
  const forwarded = { ...ambient };
  // These pre-contract inputs must not survive into Next at all. Empty values
  // are weaker than absence: a future computed lookup could mistake one for a
  // supported compatibility surface and reopen ambient configuration.
  delete forwarded.NEXT_PUBLIC_POSTHOG_KEY;
  delete forwarded.NEXT_PUBLIC_POSTHOG_HOST;
  delete forwarded.NEXT_PUBLIC_ANALYTICS_DISABLED;
  delete forwarded.EXAWATT_RESOLVED_WEB_ICON_BASE64;
  return {
    ...forwarded,
    EXAWATT_RESOLVED_DISTRIBUTION_JSON: prepared.canonical,
    EXAWATT_RESOLVED_DISTRIBUTION_SHA256: prepared.digest,
    NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON: prepared.canonical,
    NEXT_PUBLIC_EXAWATT_DISTRIBUTION_SHA256: prepared.digest,
    // Temporary Supabase compatibility values are derived from the contract.
    NEXT_PUBLIC_SUPABASE_URL: account?.supabaseUrl ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: account?.supabaseAnonKey ?? '',
    ...(webIcon
      ? { EXAWATT_RESOLVED_WEB_ICON_BASE64: webIcon.toString('base64') }
      : {}),
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeConfig(base, overlay) {
  const output = cloneJson(base);
  for (const [key, value] of Object.entries(overlay ?? {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = mergeConfig(output[key], value);
    } else {
      output[key] = cloneJson(value);
    }
  }
  return output;
}

/**
 * Produces the actual electron-builder input. The checked-in config remains a
 * temporary official compatibility source until WP3 relocates release
 * custody; this projection makes an absent distribution community-neutral.
 */
export function electronBuilderDistributionConfig(
  base,
  contract,
  overlay = undefined
) {
  const { resolveDistributionIdentity } = distributionCore();
  const identity = resolveDistributionIdentity(contract);
  const overlayWithoutExtends = { ...(overlay ?? {}) };
  delete overlayWithoutExtends.extends;
  const config = mergeConfig(base, overlayWithoutExtends);
  const templateProductName = config.productName;
  config.appId = identity.appId;
  config.productName = identity.productName;
  if (typeof config.copyright === 'string' && templateProductName) {
    config.copyright = config.copyright.replaceAll(
      templateProductName,
      identity.productName
    );
  }
  if (identity.protocolScheme) {
    config.protocols = [
      { name: identity.productName, schemes: [identity.protocolScheme] },
    ];
  } else {
    delete config.protocols;
  }
  config.mac = config.mac ?? {};
  for (const [key, value] of Object.entries(config.mac.extendInfo ?? {})) {
    if (typeof value === 'string' && templateProductName) {
      config.mac.extendInfo[key] = value.replaceAll(
        templateProductName,
        identity.productName
      );
    }
  }
  if (identity.iconPath) config.mac.icon = identity.iconPath;
  else delete config.mac.icon;
  if (contract.updates) {
    config.publish = { provider: 'generic', url: contract.updates.feedUrl };
  } else {
    delete config.publish;
  }
  return config;
}
