import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  COMMUNITY_DISTRIBUTION,
  parseDistributionContractJson,
  resolveDistributionIdentity,
  serializeDistributionContract,
  type DistributionContractV1,
} from '@exawatt/core/distribution';

export interface ResolvedDistribution {
  contract: DistributionContractV1;
  canonical: string;
  digest: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function resolveDistribution(
  contract: DistributionContractV1
): ResolvedDistribution {
  const canonical = serializeDistributionContract(contract);
  return { contract, canonical, digest: digest(canonical) };
}

export function assertDistributionAgreement(input: {
  contractJson: string;
  contractDigest: string;
  rendererDigest: string;
  buildInfoDigest: string;
}): DistributionContractV1 {
  const contract = parseDistributionContractJson(input.contractJson);
  const canonical = serializeDistributionContract(contract);
  const computed = digest(canonical);
  const expected = [
    input.contractDigest,
    input.rendererDigest,
    input.buildInfoDigest,
  ];
  if (expected.some(candidate => candidate !== computed)) {
    throw new Error(
      `Distribution artifact disagreement: computed ${computed}, contract ${input.contractDigest}, renderer ${input.rendererDigest}, build-info ${input.buildInfoDigest}`
    );
  }
  return contract;
}

export function loadDevelopmentDistribution(
  root = process.cwd()
): ResolvedDistribution {
  try {
    const contractJson = fs.readFileSync(
      path.join(root, '.exawatt-build', 'distribution.json'),
      'utf8'
    );
    const contractDigest = fs
      .readFileSync(
        path.join(root, '.exawatt-build', 'distribution.sha256'),
        'utf8'
      )
      .trim();
    const contract = parseDistributionContractJson(contractJson);
    const resolved = resolveDistribution(contract);
    if (resolved.digest !== contractDigest) {
      throw new Error(
        `Development distribution digest mismatch: expected ${contractDigest}, computed ${resolved.digest}`
      );
    }
    return resolved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return resolveDistribution(COMMUNITY_DISTRIBUTION);
    }
    throw error;
  }
}

export function loadPackagedDistribution(input: {
  mainRoot: string;
  resourcesPath: string;
  buildInfoDigest: string;
}): ResolvedDistribution {
  const contractJson = fs.readFileSync(
    path.join(input.mainRoot, 'distribution.json'),
    'utf8'
  );
  const contractDigest = fs
    .readFileSync(path.join(input.mainRoot, 'distribution.sha256'), 'utf8')
    .trim();
  const rendererDigest = fs
    .readFileSync(
      path.join(input.resourcesPath, 'renderer', 'distribution.sha256'),
      'utf8'
    )
    .trim();
  const contract = assertDistributionAgreement({
    contractJson,
    contractDigest,
    rendererDigest,
    buildInfoDigest: input.buildInfoDigest,
  });
  return resolveDistribution(contract);
}

export function assertRendererCompositionAgreement(input: {
  compositionJson: string;
  compositionDigest: string;
  buildInfoDigest: string | null;
}): void {
  const computed = digest(input.compositionJson);
  if (
    input.buildInfoDigest === null ||
    input.compositionDigest !== computed ||
    input.buildInfoDigest !== computed
  ) {
    throw new Error(
      `Renderer composition disagreement: computed ${computed}, package ${input.compositionDigest}, build-info ${input.buildInfoDigest ?? 'null'}`
    );
  }
}

export function distributionIpcCapabilities(contract: DistributionContractV1) {
  const identity = resolveDistributionIdentity(contract);
  return {
    updates: contract.updates !== null,
    updateIpcChannels: contract.updates
      ? ['app:get-update-status', 'app:check-for-updates', 'app:restart-update']
      : [],
    protocolScheme: identity.protocolScheme,
  } as const;
}

export function distributionChildEnvironment(
  resolved: ResolvedDistribution,
  ambient: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const account = resolved.contract.account;
  const forwarded = { ...ambient };
  delete forwarded.NEXT_PUBLIC_POSTHOG_KEY;
  delete forwarded.NEXT_PUBLIC_POSTHOG_HOST;
  delete forwarded.NEXT_PUBLIC_ANALYTICS_DISABLED;
  return {
    ...forwarded,
    EXAWATT_RESOLVED_DISTRIBUTION_JSON: resolved.canonical,
    EXAWATT_RESOLVED_DISTRIBUTION_SHA256: resolved.digest,
    NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON: resolved.canonical,
    NEXT_PUBLIC_EXAWATT_DISTRIBUTION_SHA256: resolved.digest,
    NEXT_PUBLIC_SUPABASE_URL: account?.supabaseUrl ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: account?.supabaseAnonKey ?? '',
  };
}
