// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  COMMUNITY_DISTRIBUTION,
  parseDistributionContract,
} from '@exawatt/core/distribution';
import Ajv2020, { type AnySchema, type ErrorObject } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

interface FixtureCase {
  id: string;
  schema: string;
  file: string;
  valid: boolean;
}

type JsonObject = Record<string, unknown>;

const CONTRACT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SERVICE_ROOT = fileURLToPath(new URL('../services/v1/', import.meta.url));
const SCHEMA_ROOT = fileURLToPath(
  new URL('../services/v1/schemas/', import.meta.url)
);
const FIXTURE_ROOT = fileURLToPath(
  new URL('../services/v1/fixtures/', import.meta.url)
);

const SERVICE_SCHEMAS = [
  'problem.schema.json',
  'context-labels.schema.json',
  'conversation-summaries.schema.json',
  'goal-visuals.schema.json',
  'product-feedback.schema.json',
  'operator-stats.schema.json',
] as const;

async function json<T = JsonObject>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function ajv(): Ajv2020 {
  const validator = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  validator.addFormat('uri', value => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  });
  validator.addFormat('uri-reference', value => {
    try {
      new URL(value, 'https://reference.invalid');
      return true;
    } catch {
      return false;
    }
  });
  validator.addFormat(
    'uuid',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  validator.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  validator.addFormat(
    'date-time',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
  );
  return validator;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(error => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
    .join('; ');
}

function externalRefs(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) externalRefs(item, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && typeof item === 'string' && item.startsWith('./')) {
      output.push(item);
    } else {
      externalRefs(item, output);
    }
  }
  return output;
}

describe('Apache compatibility contracts', () => {
  it('compiles every standalone schema as JSON Schema 2020-12', async () => {
    const validator = ajv();
    for (const version of ['v1', 'v2']) {
      const distribution = await json<AnySchema>(
        `${CONTRACT_ROOT}distribution/${version}/schema.json`
      );
      expect(() => validator.addSchema(distribution)).not.toThrow();
    }
    for (const file of SERVICE_SCHEMAS) {
      const schema = await json<AnySchema>(`${SCHEMA_ROOT}${file}`);
      expect(() => validator.addSchema(schema)).not.toThrow();
    }
  });

  it('keeps OpenAPI operations on the canonical standalone schemas', async () => {
    const document = await json<JsonObject>(`${SERVICE_ROOT}openapi.json`);
    expect(document.openapi).toBe('3.1.1');
    const refs = [...new Set(externalRefs(document))].sort();
    expect(refs).toEqual([
      './schemas/context-labels.schema.json#/$defs/request',
      './schemas/context-labels.schema.json#/$defs/response',
      './schemas/conversation-summaries.schema.json#/$defs/request',
      './schemas/conversation-summaries.schema.json#/$defs/response',
      './schemas/goal-visuals.schema.json#/$defs/request',
      './schemas/goal-visuals.schema.json#/$defs/response',
      './schemas/operator-stats.schema.json#/$defs/profileResponse',
      './schemas/operator-stats.schema.json#/$defs/publishRequest',
      './schemas/operator-stats.schema.json#/$defs/publishResponse',
      './schemas/problem.schema.json',
      './schemas/product-feedback.schema.json#/$defs/request',
      './schemas/product-feedback.schema.json#/$defs/response',
    ]);

    const paths = document.paths as JsonObject;
    expect(Object.keys(paths).sort()).toEqual([
      '/context-labels',
      '/conversation-summaries',
      '/goal-visuals',
      '/operator-stats',
      '/product-feedback',
    ]);

    for (const path of Object.values(paths)) {
      for (const operation of Object.values(path as JsonObject)) {
        const value = operation as JsonObject;
        expect(value.security ?? document.security).toEqual([
          { bearerAuth: [] },
        ]);
        expect(value.parameters).toContainEqual({
          $ref: '#/components/parameters/serviceVersion',
        });
      }
    }
  });

  it('accepts every valid service fixture and rejects every negative fixture', async () => {
    const validator = ajv();
    const schemas = new Map<string, JsonObject>();
    for (const file of SERVICE_SCHEMAS) {
      const schema = await json<JsonObject>(`${SCHEMA_ROOT}${file}`);
      schemas.set(file, schema);
      validator.addSchema(schema);
    }

    const fixtures = await json<FixtureCase[]>(`${FIXTURE_ROOT}manifest.json`);
    for (const fixture of fixtures) {
      const [file, fragment = ''] = fixture.schema.split('#');
      const schema = schemas.get(file);
      expect(schema, `${fixture.id}: unknown schema`).toBeDefined();
      const schemaId = String(schema?.$id);
      const validate = validator.getSchema(
        fragment ? `${schemaId}#${fragment}` : schemaId
      );
      expect(
        validate,
        `${fixture.id}: unresolved schema pointer`
      ).toBeDefined();
      const payload = await json(`${FIXTURE_ROOT}${fixture.file}`);
      const actual = validate?.(payload) ?? false;
      expect(actual, `${fixture.id}: ${formatErrors(validate?.errors)}`).toBe(
        fixture.valid
      );
    }
  });

  it('proves community, custom, missing-account, and incompatible-version distributions', async () => {
    const validator = ajv();
    const schema = await json<AnySchema>(
      `${CONTRACT_ROOT}distribution/v1/schema.json`
    );
    const validate = validator.compile(schema);
    const cases = [
      ['community.json', true],
      ['custom-distributor.json', true],
      ['invalid-service-without-account.json', false],
      ['invalid-protocol-version.json', false],
    ] as const;
    for (const [file, expected] of cases) {
      const payload = await json(
        `${CONTRACT_ROOT}distribution/v1/fixtures/${file}`
      );
      let runtimeAccepted = true;
      try {
        parseDistributionContract(payload);
      } catch {
        runtimeAccepted = false;
      }
      expect(
        validate(payload),
        `${file}: ${formatErrors(validate.errors)}`
      ).toBe(expected);
      expect(runtimeAccepted, `${file}: runtime/schema drift`).toBe(expected);
    }
  });

  // BUG-060. V2 is the version this build emits, and V1 is still accepted so
  // that stored copies of the official contract keep working while their
  // custodians rewrite them. Both halves of that have to be true of the
  // published schema as well as of the runtime parser, or the compatibility
  // surface is describing a client that no longer exists.
  it('publishes V2 and keeps V1 readable as an ownAccount-free upgrade', async () => {
    const validator = ajv();
    const v2 = validator.compile(
      await json<AnySchema>(`${CONTRACT_ROOT}distribution/v2/schema.json`)
    );
    const v1 = validator.compile(
      await json<AnySchema>(`${CONTRACT_ROOT}distribution/v1/schema.json`)
    );

    const community = await json<JsonObject>(
      `${CONTRACT_ROOT}distribution/v2/fixtures/community.json`
    );
    const custom = await json<JsonObject>(
      `${CONTRACT_ROOT}distribution/v2/fixtures/custom-distributor.json`
    );
    const invalidOwnAccount = await json<JsonObject>(
      `${CONTRACT_ROOT}distribution/v2/fixtures/invalid-own-account-value.json`
    );

    expect(v2(community), formatErrors(v2.errors)).toBe(true);
    expect(parseDistributionContract(community)).toEqual(
      COMMUNITY_DISTRIBUTION
    );
    expect(v2(custom), formatErrors(v2.errors)).toBe(true);
    expect(parseDistributionContract(custom).ownAccount).toEqual({
      claudePlanUsage: 'stable-signed',
    });

    // Only 'stable-signed' declares the capability; nothing else does.
    expect(v2(invalidOwnAccount)).toBe(false);
    expect(() => parseDistributionContract(invalidOwnAccount)).toThrow();

    // Exact-key strictness is PER VERSION. Neither schema accepts the other's
    // key set, and neither does the parser.
    const v1Fixture = await json<JsonObject>(
      `${CONTRACT_ROOT}distribution/v1/fixtures/custom-distributor.json`
    );
    expect(v2({ ...v1Fixture, schemaVersion: 2 })).toBe(false);
    expect(() =>
      parseDistributionContract({ ...v1Fixture, schemaVersion: 2 })
    ).toThrow();
    expect(v1({ ...custom, schemaVersion: 1 })).toBe(false);
    expect(() =>
      parseDistributionContract({ ...custom, schemaVersion: 1 })
    ).toThrow();

    // A V1 document is accepted by the V1 schema and by the runtime, and the
    // runtime upgrade withholds the capability rather than inventing it.
    expect(v1(v1Fixture), formatErrors(v1.errors)).toBe(true);
    expect(parseDistributionContract(v1Fixture)).toMatchObject({
      schemaVersion: 2,
      ownAccount: null,
    });
  });

  it('keeps the published V1 schema in step with the runtime parser', async () => {
    const validator = ajv();
    const schema = await json<AnySchema>(
      `${CONTRACT_ROOT}distribution/v1/schema.json`
    );
    const validate = validator.compile(schema);
    const community = await json(
      `${CONTRACT_ROOT}distribution/v1/fixtures/community.json`
    );
    const custom = await json<JsonObject>(
      `${CONTRACT_ROOT}distribution/v1/fixtures/custom-distributor.json`
    );
    expect(parseDistributionContract(community)).toEqual(
      COMMUNITY_DISTRIBUTION
    );

    const endpointFamilies = [
      ['services', 'productFeedback'],
      ['services', 'operatorStats'],
      ['services', 'projects'],
      ['services', 'preferences'],
      ['enrichment', 'contextLabels'],
      ['enrichment', 'conversationSummaries'],
      ['enrichment', 'goalVisuals'],
    ] as const;
    for (const [family, capability] of endpointFamilies) {
      const candidate = structuredClone(community) as JsonObject;
      (candidate[family] as JsonObject)[capability] = {
        url: `https://services.example.test/${capability}`,
        protocolVersion: 1,
      };
      expect(validate(candidate), `${family}.${capability} needs account`).toBe(
        false
      );
      expect(() => parseDistributionContract(candidate)).toThrow(
        /account is required/
      );
    }

    const mutations: Array<[string, JsonObject]> = [
      ['unknown root field', { ...custom, surprise: true }],
      [
        'unknown endpoint field',
        {
          ...custom,
          services: {
            ...(custom.services as JsonObject),
            productFeedback: {
              ...((custom.services as JsonObject)
                .productFeedback as JsonObject),
              secret: true,
            },
          },
        },
      ],
      [
        'unsafe remote HTTP',
        {
          ...custom,
          services: {
            ...(custom.services as JsonObject),
            productFeedback: {
              url: 'http://services.example.test/feedback',
              protocolVersion: 1,
            },
          },
        },
      ],
      [
        'credential-bearing URL',
        {
          ...custom,
          services: {
            ...(custom.services as JsonObject),
            productFeedback: {
              url: 'https://user:pass@services.example.test/feedback',
              protocolVersion: 1,
            },
          },
        },
      ],
      [
        'reserved account-data ref',
        {
          ...custom,
          services: {
            ...(custom.services as JsonObject),
            accountData: {
              url: 'https://services.example.test/account',
              protocolVersion: 1,
            },
          },
        },
      ],
    ];
    for (const [label, candidate] of mutations) {
      expect(validate(candidate), label).toBe(false);
      expect(() => parseDistributionContract(candidate), label).toThrow();
    }

    const loopback = structuredClone(custom) as JsonObject;
    (loopback.services as JsonObject).projects = {
      url: 'http://127.0.0.1:8787/v1/projects',
      protocolVersion: 1,
    };
    expect(validate(loopback), formatErrors(validate.errors)).toBe(true);
    expect(parseDistributionContract(loopback).services.projects).toEqual({
      url: 'http://127.0.0.1:8787/v1/projects',
      protocolVersion: 1,
    });
  });

  it('keeps human-authored goal text outside the goal-visual request', async () => {
    const schema = await json<JsonObject>(
      `${SCHEMA_ROOT}goal-visuals.schema.json`
    );
    const request = (schema.$defs as JsonObject).request as JsonObject;
    const properties = request.properties as JsonObject;
    expect(Object.keys(properties).sort()).toEqual([
      'identityKey',
      'schemaVersion',
    ]);
    expect(request.additionalProperties).toBe(false);
    expect(JSON.stringify(properties)).not.toMatch(
      /projectName|projectKey|label|prompt|instruction|transcript/
    );
  });

  it('commits the absence, custom, incompatible, N-1, and rollback cases', async () => {
    const cases = await json<
      Array<{
        id: string;
        expected: JsonObject;
        distributionFixture?: string | null;
        serviceFixture?: string;
      }>
    >(`${CONTRACT_ROOT}conformance/cases.json`);
    expect(cases.map(item => item.id)).toEqual([
      'community-all-null',
      'no-exawatt-fallback',
      'custom-distributor-v1',
      'configured-incompatible-version',
      'n-minus-one-additive-response',
      'live-rollback-version-mismatch',
    ]);
    expect(
      cases.find(item => item.id === 'community-all-null')?.expected
    ).toMatchObject({
      networkRequests: 0,
      fallback: 'local-or-absent',
    });
    expect(
      cases.find(item => item.id === 'live-rollback-version-mismatch')?.expected
    ).toMatchObject({ automaticReplay: false });
    for (const item of cases) {
      for (const fixture of [item.distributionFixture, item.serviceFixture]) {
        if (fixture) {
          await expect(
            json(fileURLToPath(new URL(fixture, import.meta.url)))
          ).resolves.toBeDefined();
        }
      }
    }
  });
});
