// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  CompatibleServiceProblemError,
  createContextLabel,
  createGoalVisual,
  disableOperatorStatsProfile,
  getOperatorStatsProfile,
  isCompatibleServiceProtocolError,
  parseDistributionContract,
  publishOperatorStats,
  submitProductFeedback,
  summarizeConversations,
  type CompatibleServiceCallOptions,
  type DistributionEndpointRefV1,
} from '@exawatt/core/distribution';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  resetResolvedDistributionForTest,
  resolvedDistribution,
} from '../../src/lib/distribution/resolved';

import {
  SERVICE_FAMILIES,
  SERVICE_OPERATIONS,
  SERVICE_VERSION_HEADER,
  assertConformingReferenceHandler,
  assertConformingServiceResponse,
  canonicalServiceRequest,
  canonicalServiceResponse,
  endpointForFamily,
  requestInitForOperation,
  startStrictLoopbackDistributor,
  type ServiceOperation,
  type ServiceResponseMode,
  type StrictLoopbackDistributor,
} from './service-harness';

interface CaseExpectation {
  accepted?: boolean;
  attemptsPerOperation?: number;
  automaticReplay?: boolean;
  error?: string | null;
  fallback?: string;
  networkRequests?: number;
  problemCode?: string;
  retryable?: boolean;
  resolvedDistribution?: string;
  ignoredFields?: string[];
  duplicateSequence?: boolean[];
  retryAfterSeconds?: number | null;
}

interface DistributionCase {
  id: string;
  kind: 'distribution';
  distributionFixture: string | null;
  environment?: Record<string, string>;
  action: 'exercise-all-hosted-capabilities' | 'resolve-distribution';
  expected: CaseExpectation;
}

interface WireCase {
  id: string;
  kind: 'wire';
  operations:
    | 'all'
    | 'all-with-response-body'
    | 'mutating'
    | 'product-feedback';
  responseMode: ServiceResponseMode;
  invocations?: number;
  expected: CaseExpectation;
}

type ConformanceCase = DistributionCase | WireCase;

const casesPath = fileURLToPath(new URL('./cases.json', import.meta.url));
const casesSchemaPath = fileURLToPath(
  new URL('./cases.schema.json', import.meta.url)
);

async function conformanceCases(): Promise<ConformanceCase[]> {
  const value = JSON.parse(await readFile(casesPath, 'utf8')) as unknown;
  const schema = JSON.parse(await readFile(casesSchemaPath, 'utf8')) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    schema
  );
  if (!validate(value)) {
    throw new Error(
      `Invalid executable conformance cases: ${JSON.stringify(validate.errors)}`
    );
  }
  return value as ConformanceCase[];
}

function selectedOperations(
  selector: WireCase['operations']
): ServiceOperation[] {
  if (selector === 'all') return [...SERVICE_OPERATIONS];
  if (selector === 'all-with-response-body') {
    return SERVICE_OPERATIONS.filter(
      operation => operation.responseSchema !== null
    );
  }
  if (selector === 'product-feedback') {
    return SERVICE_OPERATIONS.filter(
      operation => operation.family === 'productFeedback'
    );
  }
  return SERVICE_OPERATIONS.filter(
    operation =>
      operation.family === 'productFeedback' ||
      (operation.family === 'operatorStats' && operation.method !== 'GET')
  );
}

function protocolCode(error: unknown): string | null {
  return isCompatibleServiceProtocolError(error) ? error.code : null;
}

async function invokeProductionOperation(
  operation: ServiceOperation,
  endpoint: DistributionEndpointRefV1,
  body: unknown,
  options: CompatibleServiceCallOptions = {}
): Promise<unknown> {
  switch (operation.id) {
    case 'context-labels:create':
      return createContextLabel(
        endpoint,
        'conformance-access-token',
        body as Parameters<typeof createContextLabel>[2],
        options
      );
    case 'conversation-summaries:create':
      return summarizeConversations(
        endpoint,
        'conformance-access-token',
        body as Parameters<typeof summarizeConversations>[2],
        options
      );
    case 'goal-visuals:create':
      return createGoalVisual(
        endpoint,
        'conformance-access-token',
        body as Parameters<typeof createGoalVisual>[2],
        options
      );
    case 'product-feedback:create':
      return submitProductFeedback(
        endpoint,
        'conformance-access-token',
        body as Parameters<typeof submitProductFeedback>[2],
        options
      );
    case 'operator-stats:profile':
      return getOperatorStatsProfile(
        endpoint,
        'conformance-access-token',
        options
      );
    case 'operator-stats:publish':
      return publishOperatorStats(
        endpoint,
        'conformance-access-token',
        body as Parameters<typeof publishOperatorStats>[2],
        options
      );
    case 'operator-stats:disable':
      return disableOperatorStatsProfile(
        endpoint,
        'conformance-access-token',
        options
      );
    default:
      throw new Error(`No production client for ${operation.id}`);
  }
}

function allHostedCapabilitiesAreNull(
  distribution: ReturnType<typeof resolvedDistribution>
): boolean {
  return SERVICE_FAMILIES.every(
    family => endpointForFamily(distribution, family) === null
  );
}

function assertEveryExpectedField(
  label: string,
  expected: CaseExpectation,
  observed: CaseExpectation
): void {
  for (const [field, value] of Object.entries(expected)) {
    expect(
      Object.hasOwn(observed, field),
      `${label}: expectation ${field} has no executable observation`
    ).toBe(true);
    expect(
      observed[field as keyof CaseExpectation],
      `${label}: ${field}`
    ).toEqual(value);
  }
}

async function withEnvironment<T>(
  overrides: Record<string, string> | undefined,
  run: () => Promise<T>
): Promise<T> {
  const keys = new Set([
    ...Object.keys(overrides ?? {}),
    'NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON',
  ]);
  const previous = new Map(
    [...keys].map(key => [key, process.env[key]] as const)
  );
  try {
    delete process.env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON;
    for (const [key, value] of Object.entries(overrides ?? {})) {
      process.env[key] = value;
    }
    resetResolvedDistributionForTest();
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetResolvedDistributionForTest();
  }
}

describe('executable service conformance cases', () => {
  let loopback: StrictLoopbackDistributor;
  let allCases: ConformanceCase[];

  beforeAll(async () => {
    allCases = await conformanceCases();
    loopback = await startStrictLoopbackDistributor();
  });

  afterAll(async () => {
    await loopback.close();
  });

  it('executes every distribution absence, environment, and fallback expectation', async () => {
    const distributionCases = allCases.filter(
      (entry): entry is DistributionCase => entry.kind === 'distribution'
    );
    expect(distributionCases.map(entry => entry.id)).toEqual([
      'community-all-null',
      'no-exawatt-fallback',
      'configured-incompatible-version',
    ]);

    for (const testCase of distributionCases) {
      await withEnvironment(testCase.environment, async () => {
        loopback.reset();
        const fixture = testCase.distributionFixture
          ? (JSON.parse(
              await readFile(
                fileURLToPath(
                  new URL(testCase.distributionFixture, import.meta.url)
                ),
                'utf8'
              )
            ) as unknown)
          : null;
        let distribution: ReturnType<typeof resolvedDistribution> | null = null;
        let actualError: string | null = null;

        if (testCase.action === 'resolve-distribution') {
          try {
            distribution = parseDistributionContract(fixture);
          } catch {
            actualError = 'unsupported_protocol_version';
          }
        } else if (fixture) {
          distribution = parseDistributionContract(fixture);
        } else {
          distribution = resolvedDistribution();
        }

        const allNull = distribution
          ? allHostedCapabilitiesAreNull(distribution)
          : true;
        const observed: CaseExpectation = {
          resolvedDistribution: allNull ? 'community-all-null' : undefined,
          networkRequests: loopback.requests.length,
          fallback: allNull ? 'local-or-absent' : undefined,
          error: actualError,
        };
        assertEveryExpectedField(testCase.id, testCase.expected, observed);
      });
    }
  });

  it('executes every declared wire case across its complete operation set', async () => {
    const wireCases = allCases.filter(
      (entry): entry is WireCase => entry.kind === 'wire'
    );
    expect(wireCases.map(entry => entry.id)).toEqual([
      'custom-distributor-v1-current',
      'n-minus-one-additive-response',
      'missing-response-version',
      'malformed-response-version',
      'unknown-response-version',
      'live-rollback-version-mismatch',
      'schema-version-mismatch',
      'wrong-success-media',
      'wrong-success-status',
      'malformed-json',
      'malformed-success-envelope',
      'problem-envelope-v1',
      'malformed-problem-envelope',
      'mutating-no-ambiguous-replay',
      'product-feedback-idempotent-repeat',
    ]);

    for (const testCase of wireCases) {
      for (const operation of selectedOperations(testCase.operations)) {
        loopback.reset();
        loopback.setResponseMode(testCase.responseMode);
        const endpoint = endpointForFamily(
          loopback.distribution,
          operation.family
        );
        expect(
          endpoint,
          `${testCase.id}: ${operation.id} endpoint`
        ).not.toBeNull();
        const body = await canonicalServiceRequest(operation);
        const invocations = testCase.invocations ?? 1;
        const values: unknown[] = [];
        let actualError: string | null = null;
        let problemCode: string | null = null;
        let retryable: boolean | null = null;
        let retryAfterSeconds: number | null = null;

        for (let invocation = 0; invocation < invocations; invocation += 1) {
          try {
            values.push(
              await invokeProductionOperation(operation, endpoint!, body)
            );
          } catch (error) {
            if (error instanceof CompatibleServiceProblemError) {
              actualError = 'service_problem';
              problemCode = error.code;
              retryable = error.retryable;
              retryAfterSeconds = error.retryAfterSeconds;
            } else {
              actualError =
                protocolCode(error) ??
                (testCase.responseMode === 'disconnect'
                  ? 'transport_error'
                  : 'unexpected_error');
            }
          }
        }

        const ignoredFields = (testCase.expected.ignoredFields ?? []).filter(
          field =>
            values.every(
              value =>
                !value ||
                typeof value !== 'object' ||
                !Object.hasOwn(value, field)
            )
        );
        const duplicateSequence = values.flatMap(value => {
          if (!value || typeof value !== 'object') return [];
          const duplicate = (value as { duplicate?: unknown }).duplicate;
          return typeof duplicate === 'boolean' ? [duplicate] : [];
        });
        const observed: CaseExpectation = {
          accepted: values.length === invocations,
          attemptsPerOperation: loopback.requests.length,
          automaticReplay: loopback.requests.length > invocations,
          error: actualError,
          fallback:
            values.length === invocations ? undefined : 'local-or-absent',
          ignoredFields,
          problemCode: problemCode ?? undefined,
          retryable: retryable ?? undefined,
          retryAfterSeconds,
          duplicateSequence,
        };
        assertEveryExpectedField(
          `${testCase.id}: ${operation.id}`,
          testCase.expected,
          observed
        );

        for (const request of loopback.requests) {
          expect(request).toMatchObject({
            operation: operation.id,
            version: '1',
            authorization: 'Bearer conformance-access-token',
            bodyRead: operation.requestSchema !== null,
            accepted: true,
          });
          expect(request.body).toEqual(body);
        }
      }
    }
  });
});

describe('strict custom-distributor fixture', () => {
  let loopback: StrictLoopbackDistributor;

  beforeAll(async () => {
    loopback = await startStrictLoopbackDistributor();
  });

  afterAll(async () => {
    await loopback.close();
  });

  it('configures exact loopback endpoints for all five families', () => {
    for (const family of SERVICE_FAMILIES) {
      const endpoint = endpointForFamily(loopback.distribution, family);
      expect(endpoint?.url).toMatch(
        new RegExp(`^${loopback.origin.replaceAll('.', '\\.')}\/v1\/`)
      );
      expect(endpoint?.protocolVersion).toBe(1);
    }
  });

  it('rejects a missing, malformed, or unknown request version before accepting work', async () => {
    const operation = SERVICE_OPERATIONS[0];
    const endpoint = endpointForFamily(
      loopback.distribution,
      operation.family
    )!;
    for (const version of [null, 'one', '99']) {
      loopback.reset();
      const headers: HeadersInit = {
        authorization: 'Bearer wrong-token',
        'content-type': 'application/json',
      };
      if (version !== null) headers[SERVICE_VERSION_HEADER] = version;
      const response = await fetch(endpoint.url, {
        method: operation.method,
        headers,
        body: '{this would fail JSON parsing if read}',
      });
      expect(response.status).toBe(400);
      await expect(
        assertConformingServiceResponse({ operation, response })
      ).resolves.toBeUndefined();
      expect(loopback.requests).toHaveLength(1);
      expect(loopback.requests[0]).toMatchObject({
        bodyRead: false,
        accepted: false,
      });
    }
  });

  it('rejects the wrong operation before version, authentication, or body consumption', async () => {
    loopback.reset();
    const response = await fetch(`${loopback.origin}/v1/not-configured`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-token',
        'content-type': 'application/json',
        [SERVICE_VERSION_HEADER]: '99',
      },
      body: '{this would fail JSON parsing if read}',
    });
    expect(response.status).toBe(404);
    expect(loopback.requests).toHaveLength(1);
    expect(loopback.requests[0]).toMatchObject({
      operation: null,
      bodyRead: false,
      accepted: false,
    });
  });

  it('rejects authentication before consuming the request body', async () => {
    const operation = SERVICE_OPERATIONS[0];
    const endpoint = endpointForFamily(
      loopback.distribution,
      operation.family
    )!;
    loopback.reset();
    const response = await fetch(endpoint.url, {
      method: operation.method,
      headers: {
        authorization: 'Bearer wrong-token',
        'content-type': 'application/json',
        [SERVICE_VERSION_HEADER]: '1',
      },
      body: '{this would fail JSON parsing if read}',
    });
    expect(response.status).toBe(401);
    expect(loopback.requests).toHaveLength(1);
    expect(loopback.requests[0]).toMatchObject({
      bodyRead: false,
      accepted: false,
    });
  });

  it('rejects request media type before consuming the request body', async () => {
    const operation = SERVICE_OPERATIONS[0];
    const endpoint = endpointForFamily(
      loopback.distribution,
      operation.family
    )!;
    loopback.reset();
    const response = await fetch(endpoint.url, {
      method: operation.method,
      headers: {
        authorization: 'Bearer conformance-access-token',
        'content-type': 'text/plain',
        [SERVICE_VERSION_HEADER]: '1',
      },
      body: JSON.stringify(await canonicalServiceRequest(operation)),
    });
    expect(response.status).toBe(415);
    expect(loopback.requests).toHaveLength(1);
    expect(loopback.requests[0]).toMatchObject({
      bodyRead: false,
      accepted: false,
    });
  });

  it('rejects a body outside the closed request schema', async () => {
    const operation = SERVICE_OPERATIONS.find(
      candidate => candidate.family === 'goalVisuals'
    )!;
    const endpoint = endpointForFamily(
      loopback.distribution,
      operation.family
    )!;
    const body = {
      ...((await canonicalServiceRequest(operation)) as Record<
        string,
        unknown
      >),
      privateGoalLabel: 'This must not cross the boundary',
    };
    loopback.reset();
    const response = await fetch(
      endpoint.url,
      requestInitForOperation(operation, body, {
        [SERVICE_VERSION_HEADER]: '1',
      })
    );
    expect(response.status).toBe(400);
    await expect(
      assertConformingServiceResponse({ operation, response })
    ).resolves.toBeUndefined();
    expect(loopback.requests[0]).toMatchObject({ accepted: false });
  });
});

describe('portable reference-handler assertion seam', () => {
  it('accepts every current and additive success through the canonical schemas', async () => {
    for (const operation of SERVICE_OPERATIONS) {
      const body = await canonicalServiceResponse(operation);
      const status = operation.successStatuses.at(-1)!;
      for (const additive of [false, true]) {
        const responseBody =
          additive && body && typeof body === 'object'
            ? { ...body, serviceTrace: 'reference-additive-field' }
            : body;
        const received: Request[] = [];
        const response = await assertConformingReferenceHandler({
          operation,
          handler: async request => {
            received.push(request);
            return new Response(
              status === 204 ? null : JSON.stringify(responseBody),
              {
                status,
                headers: {
                  [SERVICE_VERSION_HEADER]: '1',
                  ...(status === 204
                    ? {}
                    : { 'content-type': 'application/json' }),
                },
              }
            );
          },
        });
        expect(response.status).toBe(status);
        expect(received).toHaveLength(1);
        expect(received[0].headers.get(SERVICE_VERSION_HEADER)).toBe('1');
        expect(received[0].headers.get('authorization')).toBe(
          'Bearer conformance-access-token'
        );
      }
    }
  });

  it('fails deliberate header, body, and problem-envelope mutations', async () => {
    const operation = SERVICE_OPERATIONS[0];
    await expect(
      assertConformingServiceResponse({
        operation,
        response: new Response(
          JSON.stringify(await canonicalServiceResponse(operation)),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
      })
    ).rejects.toThrow(/response Exawatt-Service-Version must be 1/);

    await expect(
      assertConformingServiceResponse({
        operation,
        response: new Response(JSON.stringify({ schemaVersion: 1 }), {
          status: 200,
          headers: {
            [SERVICE_VERSION_HEADER]: '1',
            'content-type': 'application/json',
          },
        }),
      })
    ).rejects.toThrow(/invalid response/);

    await expect(
      assertConformingServiceResponse({
        operation,
        response: new Response(
          JSON.stringify({
            type: 'https://exawatt.ai/problems/capacity',
            title: 'Capacity',
            status: 503,
            code: 'capacity_reached',
            retryable: true,
            schemaVersion: 1,
          }),
          {
            status: 429,
            headers: {
              [SERVICE_VERSION_HEADER]: '1',
              'content-type': 'application/problem+json',
            },
          }
        ),
      })
    ).rejects.toThrow(/problem status does not match HTTP status/);
  });
});
