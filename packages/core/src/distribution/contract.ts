/**
 * The version this build EMITS. The parser still accepts schema 1 documents
 * and upgrades them in memory (see `parseDistributionContract`), because the
 * stored copies of the official contract live outside the repository and
 * cannot be rewritten by the same commit that changes the schema. Incident
 * `0017` is what a code/config window costs when it is not planned for.
 */
export const DISTRIBUTION_SCHEMA_VERSION = 2 as const;

/** Every document version this build can read. Order is oldest-first. */
export const SUPPORTED_DISTRIBUTION_SCHEMA_VERSIONS = [1, 2] as const;

export interface DistributionBrandV1 {
  appId: string;
  productName: string;
  protocolScheme: string;
  iconPath: string;
  updateChannel: string;
}

/** Public authentication transport only. Product data belongs in `services`. */
export interface DistributionAccountV1 {
  supabaseUrl: string;
  supabaseAnonKey: string;
  recoveryOrigin: string;
}

export interface DistributionEndpointRefV1 {
  url: string;
  protocolVersion: 1;
}

/**
 * Product-service capabilities are deliberately independent. A distributor can
 * implement one without inheriting Exawatt's private tables, RPCs, or the rest
 * of the hosted product. Each value is the public API endpoint for that family.
 */
export interface DistributionServicesV1 {
  productFeedback: DistributionEndpointRefV1 | null;
  operatorStats: DistributionEndpointRefV1 | null;
  projects: DistributionEndpointRefV1 | null;
  preferences: DistributionEndpointRefV1 | null;
  /** Reserved until a public account-data protocol exists; every schema
   *  version to date requires null. */
  accountData: null;
}

export interface DistributionEnrichmentV1 {
  contextLabels: DistributionEndpointRefV1 | null;
  conversationSummaries: DistributionEndpointRefV1 | null;
  goalVisuals: DistributionEndpointRefV1 | null;
}

export interface DistributionAnalyticsV1 {
  ingestOrigin: string;
  projectKey: string;
}

export interface DistributionUpdatesV1 {
  feedUrl: string;
}

/**
 * Schema V2's only addition, and the reason the version moved.
 *
 * Decision `0036` §6 (amended 2026-08-16 after incident `0011`): an automatic
 * credentialed read against the operator's OWN vendor account has to be gated
 * on a durable network identity, and packaging is not that. A contributor's
 * ad-hoc package reports `app.isPackaged === true` and presents Little Snitch
 * a new CDHash on every Electron revision, so an automatic read from it
 * recreates the approval churn `0011` recorded.
 *
 * The DISTRIBUTOR therefore declares whether it supplies a stable signed
 * identity for Exawatt-owned own-account traffic. `'stable-signed'` is the
 * only value: this is a declaration, not a scale. It controls local behaviour
 * only, and is never proof of officiality or authorization to use any Exawatt
 * service.
 */
export interface DistributionOwnAccountV2 {
  claudePlanUsage: 'stable-signed';
}

/**
 * V2 = V1 plus `ownAccount`. Every other member keeps its V1 shape unchanged,
 * which is why those interfaces keep their V1 names: they did not move.
 */
export interface DistributionContractV2 {
  schemaVersion: typeof DISTRIBUTION_SCHEMA_VERSION;
  brand: DistributionBrandV1 | null;
  account: DistributionAccountV1 | null;
  services: DistributionServicesV1;
  enrichment: DistributionEnrichmentV1;
  analytics: DistributionAnalyticsV1 | null;
  updates: DistributionUpdatesV1 | null;
  /** Absent declaration means no automatic own-account read. Fail-safe. */
  ownAccount: DistributionOwnAccountV2 | null;
}

export interface DistributionIdentity {
  appId: string;
  productName: string;
  protocolScheme: string | null;
  iconPath: string | null;
  updateChannel: string | null;
  /** Keeps community and official settings from sharing mutable state. */
  stateNamespace: string;
  /** Keeps extracted renderer/server caches from crossing distributions. */
  cacheNamespace: string;
}

const COMMUNITY_SERVICES: DistributionServicesV1 = Object.freeze({
  productFeedback: null,
  operatorStats: null,
  projects: null,
  preferences: null,
  accountData: null,
});

const COMMUNITY_ENRICHMENT: DistributionEnrichmentV1 = Object.freeze({
  contextLabels: null,
  conversationSummaries: null,
  goalVisuals: null,
});

export const COMMUNITY_DISTRIBUTION: DistributionContractV2 = Object.freeze({
  schemaVersion: DISTRIBUTION_SCHEMA_VERSION,
  brand: null,
  account: null,
  services: COMMUNITY_SERVICES,
  enrichment: COMMUNITY_ENRICHMENT,
  analytics: null,
  updates: null,
  // Community supplies no signing custody, so it declares no own-account
  // capability. This is the value that closes BUG-060.
  ownAccount: null,
});

export const COMMUNITY_IDENTITY: DistributionIdentity = Object.freeze({
  productName: 'Exawatt Community',
  appId: 'ai.exawatt.community',
  protocolScheme: null,
  iconPath: null,
  updateChannel: null,
  stateNamespace: 'ai.exawatt.community',
  cacheNamespace: 'ai.exawatt.community',
});

/**
 * The renderer talks directly to a user-configured OpenClaw Gateway today.
 * Its host may be loopback, LAN, or another operator-owned target. This lane is
 * not an Exawatt distribution service and therefore survives an all-null build.
 */
export const AGENT_SOURCE_CONNECT_SOURCES = Object.freeze(['ws:'] as const);

type JsonObject = Record<string, unknown>;

function record(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(
      `Invalid distribution config: ${path} must be an object`
    );
  }
  return value as JsonObject;
}

function exactKeys(
  value: JsonObject,
  keys: readonly string[],
  path: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `Invalid distribution config: ${path} keys must be exactly ${expected.join(', ')}`
    );
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(
      `Invalid distribution config: ${path} must be a non-empty string`
    );
  }
  return value.trim();
}

function productName(value: unknown): string {
  const parsed = nonEmptyString(value, 'brand.productName');
  if (
    parsed === '.' ||
    parsed === '..' ||
    /[\/\\:\u0000-\u001f]/.test(parsed)
  ) {
    throw new TypeError(
      'Invalid distribution config: brand.productName must be a safe application filename'
    );
  }
  return parsed;
}

function nullableEndpointRef(
  value: unknown,
  path: string
): DistributionEndpointRefV1 | null {
  if (value === null) return null;
  const parsed = record(value, path);
  exactKeys(parsed, ['url', 'protocolVersion'], path);
  if (parsed.protocolVersion !== 1) {
    throw new TypeError(
      `Invalid distribution config: ${path}.protocolVersion must be 1`
    );
  }
  return Object.freeze({
    url: serviceUrl(parsed.url, `${path}.url`),
    protocolVersion: 1,
  });
}

function serviceUrl(value: unknown, path: string): string {
  const stringValue = nonEmptyString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(stringValue);
  } catch {
    throw new TypeError(`Invalid distribution config: ${path} must be a URL`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new TypeError(
      `Invalid distribution config: ${path} cannot contain credentials or a fragment`
    );
  }
  const loopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && loopback)
  ) {
    throw new TypeError(
      `Invalid distribution config: ${path} must use HTTPS (HTTP is loopback-only)`
    );
  }
  return parsed.toString().replace(/\/$/, stringValue.endsWith('/') ? '/' : '');
}

function recoveryOrigin(value: unknown, path: string): string {
  const parsedValue = serviceUrl(value, path);
  const parsed = new URL(parsedValue);
  if (
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== parsedValue.replace(/\/$/, '')
  ) {
    throw new TypeError(
      `Invalid distribution config: ${path} must be an origin`
    );
  }
  return parsed.origin;
}

function brand(value: unknown): DistributionBrandV1 | null {
  if (value === null) return null;
  const parsed = record(value, 'brand');
  exactKeys(
    parsed,
    ['appId', 'productName', 'protocolScheme', 'iconPath', 'updateChannel'],
    'brand'
  );
  const appId = nonEmptyString(parsed.appId, 'brand.appId');
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(appId)) {
    throw new TypeError(
      'Invalid distribution config: brand.appId must be a reverse-DNS identifier'
    );
  }
  const protocolScheme = nonEmptyString(
    parsed.protocolScheme,
    'brand.protocolScheme'
  ).toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*$/.test(protocolScheme)) {
    throw new TypeError(
      'Invalid distribution config: brand.protocolScheme is not a valid URL scheme'
    );
  }
  const iconPath = nonEmptyString(parsed.iconPath, 'brand.iconPath');
  if (iconPath.startsWith('/') || iconPath.split(/[\\/]/).includes('..')) {
    throw new TypeError(
      'Invalid distribution config: brand.iconPath must be repository-relative'
    );
  }
  return Object.freeze({
    appId,
    productName: productName(parsed.productName),
    protocolScheme,
    iconPath,
    updateChannel: nonEmptyString(parsed.updateChannel, 'brand.updateChannel'),
  });
}

function account(value: unknown): DistributionAccountV1 | null {
  if (value === null) return null;
  const parsed = record(value, 'account');
  exactKeys(
    parsed,
    ['supabaseUrl', 'supabaseAnonKey', 'recoveryOrigin'],
    'account'
  );
  return Object.freeze({
    supabaseUrl: serviceUrl(parsed.supabaseUrl, 'account.supabaseUrl'),
    supabaseAnonKey: nonEmptyString(
      parsed.supabaseAnonKey,
      'account.supabaseAnonKey'
    ),
    recoveryOrigin: recoveryOrigin(
      parsed.recoveryOrigin,
      'account.recoveryOrigin'
    ),
  });
}

function services(value: unknown): DistributionServicesV1 {
  const parsed = record(value, 'services');
  exactKeys(
    parsed,
    [
      'productFeedback',
      'operatorStats',
      'projects',
      'preferences',
      'accountData',
    ],
    'services'
  );
  if (parsed.accountData !== null) {
    throw new TypeError(
      'Invalid distribution config: services.accountData is reserved and must be null'
    );
  }
  return Object.freeze({
    productFeedback: nullableEndpointRef(
      parsed.productFeedback,
      'services.productFeedback'
    ),
    operatorStats: nullableEndpointRef(
      parsed.operatorStats,
      'services.operatorStats'
    ),
    projects: nullableEndpointRef(parsed.projects, 'services.projects'),
    preferences: nullableEndpointRef(
      parsed.preferences,
      'services.preferences'
    ),
    accountData: null,
  });
}

function enrichment(value: unknown): DistributionEnrichmentV1 {
  const parsed = record(value, 'enrichment');
  exactKeys(
    parsed,
    ['contextLabels', 'conversationSummaries', 'goalVisuals'],
    'enrichment'
  );
  return Object.freeze({
    contextLabels: nullableEndpointRef(
      parsed.contextLabels,
      'enrichment.contextLabels'
    ),
    conversationSummaries: nullableEndpointRef(
      parsed.conversationSummaries,
      'enrichment.conversationSummaries'
    ),
    goalVisuals: nullableEndpointRef(
      parsed.goalVisuals,
      'enrichment.goalVisuals'
    ),
  });
}

function analytics(value: unknown): DistributionAnalyticsV1 | null {
  if (value === null) return null;
  const parsed = record(value, 'analytics');
  exactKeys(parsed, ['ingestOrigin', 'projectKey'], 'analytics');
  return Object.freeze({
    ingestOrigin: serviceUrl(parsed.ingestOrigin, 'analytics.ingestOrigin'),
    projectKey: nonEmptyString(parsed.projectKey, 'analytics.projectKey'),
  });
}

function updates(value: unknown): DistributionUpdatesV1 | null {
  if (value === null) return null;
  const parsed = record(value, 'updates');
  exactKeys(parsed, ['feedUrl'], 'updates');
  return Object.freeze({
    feedUrl: serviceUrl(parsed.feedUrl, 'updates.feedUrl'),
  });
}

function ownAccount(value: unknown): DistributionOwnAccountV2 | null {
  if (value === null) return null;
  const parsed = record(value, 'ownAccount');
  exactKeys(parsed, ['claudePlanUsage'], 'ownAccount');
  if (parsed.claudePlanUsage !== 'stable-signed') {
    throw new TypeError(
      "Invalid distribution config: ownAccount.claudePlanUsage must be 'stable-signed' or ownAccount must be null"
    );
  }
  return Object.freeze({ claudePlanUsage: 'stable-signed' as const });
}

/** Root keys per document version. Each version stays exact-key-strict for
 *  its OWN shape: a V1 document carrying `ownAccount` is as invalid as a V2
 *  document missing it. Strictness is what makes an absent or half-written
 *  input select community rather than half-configure an official build. */
const ROOT_KEYS_V1 = [
  'schemaVersion',
  'brand',
  'account',
  'services',
  'enrichment',
  'analytics',
  'updates',
] as const;
const ROOT_KEYS_V2 = [...ROOT_KEYS_V1, 'ownAccount'] as const;

/**
 * Accepts every supported document version and returns the CURRENT one.
 *
 * A schema-1 document is upgraded in memory with `ownAccount: null`. That
 * direction is deliberate and fail-safe: a contract written before the
 * declaration existed does not get the capability it never declared. It is
 * also what lets the schema change land before the stored copies of the
 * official contract are rewritten, since those live in Vercel, a GitHub
 * secret, and operator custody rather than in this repository.
 */
export function parseDistributionContract(
  value: unknown
): DistributionContractV2 {
  const parsed = record(value, 'root');
  const documentVersion = parsed.schemaVersion;
  if (
    documentVersion !== 1 &&
    documentVersion !== DISTRIBUTION_SCHEMA_VERSION
  ) {
    throw new TypeError(
      `Invalid distribution config: schemaVersion must be one of ${SUPPORTED_DISTRIBUTION_SCHEMA_VERSIONS.join(', ')}`
    );
  }
  exactKeys(
    parsed,
    documentVersion === 1 ? ROOT_KEYS_V1 : ROOT_KEYS_V2,
    'root'
  );
  const contract = Object.freeze({
    schemaVersion: DISTRIBUTION_SCHEMA_VERSION,
    brand: brand(parsed.brand),
    account: account(parsed.account),
    services: services(parsed.services),
    enrichment: enrichment(parsed.enrichment),
    analytics: analytics(parsed.analytics),
    updates: updates(parsed.updates),
    ownAccount: documentVersion === 1 ? null : ownAccount(parsed.ownAccount),
  });
  const authenticatedEndpoints = [
    contract.services.productFeedback,
    contract.services.operatorStats,
    contract.services.projects,
    contract.services.preferences,
    contract.enrichment.contextLabels,
    contract.enrichment.conversationSummaries,
    contract.enrichment.goalVisuals,
  ];
  if (
    !contract.account &&
    authenticatedEndpoints.some(endpoint => endpoint !== null)
  ) {
    throw new TypeError(
      'Invalid distribution config: account is required when an authenticated service or enrichment endpoint is configured'
    );
  }
  return contract;
}

export function parseDistributionContractJson(
  value: string
): DistributionContractV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError(
      `Invalid distribution config JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return parseDistributionContract(parsed);
}

/** Stable key order is part of the cross-process digest agreement. */
export function serializeDistributionContract(
  contract: DistributionContractV2 | unknown
): string {
  return JSON.stringify(parseDistributionContract(contract));
}

export function resolveDistributionIdentity(
  contract: DistributionContractV2
): DistributionIdentity {
  if (!contract.brand) return COMMUNITY_IDENTITY;
  return Object.freeze({
    ...contract.brand,
    stateNamespace: contract.brand.appId,
    cacheNamespace: contract.brand.appId,
  });
}

function endpointOrigin(value: string, output: Set<string>): void {
  const url = new URL(value);
  output.add(url.origin);
}

export function distributionConnectSources(
  contract: DistributionContractV2
): string[] {
  const sources = new Set<string>(["'self'", ...AGENT_SOURCE_CONNECT_SOURCES]);
  if (contract.account) {
    endpointOrigin(contract.account.supabaseUrl, sources);
    const account = new URL(contract.account.supabaseUrl);
    if (account.protocol === 'https:') sources.add(`wss://${account.host}`);
    if (account.protocol === 'http:') sources.add(`ws://${account.host}`);
  }
  for (const endpoint of Object.values(contract.services)) {
    if (endpoint) endpointOrigin(endpoint.url, sources);
  }
  for (const endpoint of Object.values(contract.enrichment)) {
    if (endpoint) endpointOrigin(endpoint.url, sources);
  }
  if (contract.analytics)
    endpointOrigin(contract.analytics.ingestOrigin, sources);
  return [...sources];
}
