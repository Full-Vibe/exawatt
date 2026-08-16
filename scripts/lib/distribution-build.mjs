import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

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

export function distributionDigest(canonical) {
  return createHash('sha256').update(canonical).digest('hex');
}

export function distributionArtifactPaths(root) {
  const directory = path.join(root, '.exawatt-build');
  return {
    directory,
    contract: path.join(directory, 'distribution.json'),
    digest: path.join(directory, 'distribution.sha256'),
  };
}

export async function prepareDistribution({ root, inputJson }) {
  const {
    COMMUNITY_DISTRIBUTION,
    parseDistributionContractJson,
    serializeDistributionContract,
  } = distributionCore();
  let contract;
  try {
    contract =
      inputJson === undefined
        ? COMMUNITY_DISTRIBUTION
        : parseDistributionContractJson(inputJson);
  } catch (error) {
    throw new Error(
      `Distribution config is present but invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
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

export function nextDistributionEnvironment(prepared, ambient = process.env) {
  const account = prepared.contract.account;
  const analytics = prepared.contract.analytics;
  return {
    ...ambient,
    EXAWATT_RESOLVED_DISTRIBUTION_JSON: prepared.canonical,
    EXAWATT_RESOLVED_DISTRIBUTION_SHA256: prepared.digest,
    NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON: prepared.canonical,
    NEXT_PUBLIC_EXAWATT_DISTRIBUTION_SHA256: prepared.digest,
    // Compatibility values are derived from the contract. Ambient legacy env
    // cannot turn a community capability back on.
    NEXT_PUBLIC_SUPABASE_URL: account?.supabaseUrl ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: account?.supabaseAnonKey ?? '',
    NEXT_PUBLIC_POSTHOG_KEY: analytics?.projectKey ?? '',
    NEXT_PUBLIC_POSTHOG_HOST: analytics?.ingestOrigin ?? '',
    NEXT_PUBLIC_ANALYTICS_DISABLED: analytics ? 'false' : 'true',
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
  config.appId = identity.appId;
  config.productName = identity.productName;
  if (identity.protocolScheme) {
    config.protocols = [
      { name: identity.productName, schemes: [identity.protocolScheme] },
    ];
  } else {
    delete config.protocols;
  }
  config.mac = config.mac ?? {};
  if (identity.iconPath) config.mac.icon = identity.iconPath;
  else delete config.mac.icon;
  if (contract.updates) {
    config.publish = { provider: 'generic', url: contract.updates.feedUrl };
  } else {
    delete config.publish;
  }
  return config;
}
