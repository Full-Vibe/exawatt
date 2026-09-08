// SPDX-License-Identifier: Apache-2.0

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import {
  parseDistributionContract,
  type DistributionContractV2,
} from '@exawatt/core/distribution';
import Ajv2020, {
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js';

export const CONFORMANCE_ACCESS_TOKEN = 'conformance-access-token';
export const SERVICE_VERSION_HEADER = 'Exawatt-Service-Version';

export const SERVICE_FAMILIES = [
  'contextLabels',
  'conversationSummaries',
  'goalVisuals',
  'productFeedback',
  'operatorStats',
] as const;

export type ServiceFamily = (typeof SERVICE_FAMILIES)[number];
export type ServiceMethod = 'GET' | 'POST' | 'DELETE';
export type ServiceResponseMode =
  | 'current'
  | 'additive'
  | 'missing-version'
  | 'malformed-version'
  | 'unknown-version'
  | 'rollback'
  | 'schema-version-mismatch'
  | 'wrong-success-media'
  | 'wrong-success-status'
  | 'malformed-json'
  | 'malformed-envelope'
  | 'problem'
  | 'malformed-problem'
  | 'idempotent-repeat'
  | 'disconnect';

export interface ServiceOperation {
  id: string;
  family: ServiceFamily;
  method: ServiceMethod;
  path: string;
  requestFixture: string | null;
  responseFixture: string | null;
  requestSchema: string | null;
  responseSchema: string | null;
  successStatuses: readonly number[];
}

export interface RecordedServiceRequest {
  operation: string | null;
  method: string;
  path: string;
  version: string | null;
  authorization: string | null;
  body: unknown;
  bodyRead: boolean;
  accepted: boolean;
}

export interface StrictLoopbackDistributor {
  origin: string;
  distribution: DistributionContractV2;
  requests: RecordedServiceRequest[];
  setResponseMode(mode: ServiceResponseMode): void;
  reset(): void;
  close(): Promise<void>;
}

export interface ReferenceResponseInput {
  operation: ServiceOperation | string;
  response: Response;
}

export type ReferenceServiceHandler = (request: Request) => Promise<Response>;

export interface ReferenceHandlerInput {
  operation: ServiceOperation | string;
  handler: ReferenceServiceHandler;
  url?: string;
}

interface LoadedOperation extends ServiceOperation {
  request: unknown;
  response: unknown;
  validateRequest: ValidateFunction | null;
  validateResponse: ValidateFunction | null;
}

const FIXTURE_ROOT = fileURLToPath(
  new URL('../services/v1/fixtures/', import.meta.url)
);
const SCHEMA_ROOT = fileURLToPath(
  new URL('../services/v1/schemas/', import.meta.url)
);

export const SERVICE_OPERATIONS: readonly ServiceOperation[] = [
  {
    id: 'context-labels:create',
    family: 'contextLabels',
    method: 'POST',
    path: '/v1/context-labels',
    requestFixture: 'context-labels/valid-request.json',
    responseFixture: 'context-labels/valid-response.json',
    requestSchema: 'context-labels.schema.json#/$defs/request',
    responseSchema: 'context-labels.schema.json#/$defs/response',
    successStatuses: [200],
  },
  {
    id: 'conversation-summaries:create',
    family: 'conversationSummaries',
    method: 'POST',
    path: '/v1/conversation-summaries',
    requestFixture: 'conversation-summaries/valid-request.json',
    responseFixture: 'conversation-summaries/valid-response.json',
    requestSchema: 'conversation-summaries.schema.json#/$defs/request',
    responseSchema: 'conversation-summaries.schema.json#/$defs/response',
    successStatuses: [200],
  },
  {
    id: 'goal-visuals:create',
    family: 'goalVisuals',
    method: 'POST',
    path: '/v1/goal-visuals',
    requestFixture: 'goal-visuals/valid-request.json',
    responseFixture: 'goal-visuals/valid-response.json',
    requestSchema: 'goal-visuals.schema.json#/$defs/request',
    responseSchema: 'goal-visuals.schema.json#/$defs/response',
    successStatuses: [200],
  },
  {
    id: 'product-feedback:create',
    family: 'productFeedback',
    method: 'POST',
    path: '/v1/product-feedback',
    requestFixture: 'product-feedback/valid-request.json',
    responseFixture: 'product-feedback/valid-response.json',
    requestSchema: 'product-feedback.schema.json#/$defs/request',
    responseSchema: 'product-feedback.schema.json#/$defs/response',
    successStatuses: [200, 201],
  },
  {
    id: 'operator-stats:profile',
    family: 'operatorStats',
    method: 'GET',
    path: '/v1/operator-stats',
    requestFixture: null,
    responseFixture: 'operator-stats/valid-profile-response.json',
    requestSchema: null,
    responseSchema: 'operator-stats.schema.json#/$defs/profileResponse',
    successStatuses: [200],
  },
  {
    id: 'operator-stats:publish',
    family: 'operatorStats',
    method: 'POST',
    path: '/v1/operator-stats',
    requestFixture: 'operator-stats/valid-request.json',
    responseFixture: 'operator-stats/valid-response.json',
    requestSchema: 'operator-stats.schema.json#/$defs/publishRequest',
    responseSchema: 'operator-stats.schema.json#/$defs/publishResponse',
    successStatuses: [200],
  },
  {
    id: 'operator-stats:disable',
    family: 'operatorStats',
    method: 'DELETE',
    path: '/v1/operator-stats',
    requestFixture: null,
    responseFixture: null,
    requestSchema: null,
    responseSchema: null,
    successStatuses: [204],
  },
] as const;

const OPERATION_BY_ID = new Map(
  SERVICE_OPERATIONS.map(operation => [operation.id, operation])
);
const OPERATION_BY_WIRE = new Map(
  SERVICE_OPERATIONS.map(operation => [
    `${operation.method} ${operation.path}`,
    operation,
  ])
);

function createAjv(): Ajv2020 {
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

function errors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(error => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
    .join('; ');
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function schemaPointer(
  schemas: Map<string, AnySchema>,
  validator: Ajv2020,
  pointer: string | null
): ValidateFunction | null {
  if (!pointer) return null;
  const [file, fragment = ''] = pointer.split('#');
  const schema = schemas.get(file);
  if (!schema) throw new Error(`Unknown service schema ${file}`);
  const schemaId = String((schema as { $id?: unknown }).$id);
  const validate = validator.getSchema(
    fragment ? `${schemaId}#${fragment}` : schemaId
  );
  if (!validate) throw new Error(`Unresolved service schema ${pointer}`);
  return validate;
}

let loadedOperationsPromise: Promise<readonly LoadedOperation[]> | null = null;

async function loadedOperations(): Promise<readonly LoadedOperation[]> {
  loadedOperationsPromise ??= (async () => {
    const validator = createAjv();
    const files = [
      'problem.schema.json',
      'context-labels.schema.json',
      'conversation-summaries.schema.json',
      'goal-visuals.schema.json',
      'product-feedback.schema.json',
      'operator-stats.schema.json',
    ];
    const schemas = new Map<string, AnySchema>();
    for (const file of files) {
      const schema = (await json(`${SCHEMA_ROOT}${file}`)) as AnySchema;
      schemas.set(file, schema);
      validator.addSchema(schema);
    }
    return Promise.all(
      SERVICE_OPERATIONS.map(async operation => ({
        ...operation,
        request: operation.requestFixture
          ? await json(`${FIXTURE_ROOT}${operation.requestFixture}`)
          : null,
        response: operation.responseFixture
          ? await json(`${FIXTURE_ROOT}${operation.responseFixture}`)
          : null,
        validateRequest: schemaPointer(
          schemas,
          validator,
          operation.requestSchema
        ),
        validateResponse: schemaPointer(
          schemas,
          validator,
          operation.responseSchema
        ),
      }))
    );
  })();
  return loadedOperationsPromise;
}

function resolveOperation(
  operation: ServiceOperation | string
): ServiceOperation {
  if (typeof operation !== 'string') return operation;
  const resolved = OPERATION_BY_ID.get(operation);
  if (!resolved) throw new Error(`Unknown service operation ${operation}`);
  return resolved;
}

async function loadedOperation(
  operation: ServiceOperation | string
): Promise<LoadedOperation> {
  const resolved = resolveOperation(operation);
  const loaded = (await loadedOperations()).find(
    item => item.id === resolved.id
  );
  if (!loaded) throw new Error(`Unloaded service operation ${resolved.id}`);
  return loaded;
}

export async function canonicalServiceRequest(
  operation: ServiceOperation | string
): Promise<unknown> {
  return structuredClone((await loadedOperation(operation)).request);
}

export async function canonicalServiceResponse(
  operation: ServiceOperation | string
): Promise<unknown> {
  return structuredClone((await loadedOperation(operation)).response);
}

export async function decodeConformingServiceResponse<T = unknown>(
  operation: ServiceOperation | string,
  value: unknown
): Promise<T> {
  const loaded = await loadedOperation(operation);
  if (!loaded.validateResponse) {
    if (value !== null && value !== undefined) {
      throw new Error(`${loaded.id}: expected an empty response`);
    }
    return value as T;
  }
  if (!loaded.validateResponse(value)) {
    throw new Error(
      `${loaded.id}: invalid response: ${errors(loaded.validateResponse.errors)}`
    );
  }
  return value as T;
}

/**
 * The production client decoder is synchronous after JSON parsing. Loading the
 * schemas is asynchronous, so callers prepare this closure once and then pass
 * it directly to `decodeCompatibleServiceJson`.
 */
export async function conformingServiceResponseDecoder<T = unknown>(
  operation: ServiceOperation | string
): Promise<(value: unknown) => T> {
  const loaded = await loadedOperation(operation);
  return value => {
    if (!loaded.validateResponse) {
      throw new Error(`${loaded.id}: this operation has no JSON response`);
    }
    if (!loaded.validateResponse(value)) {
      throw new Error(
        `${loaded.id}: invalid response: ${errors(loaded.validateResponse.errors)}`
      );
    }
    return value as T;
  };
}

export async function assertConformingServiceResponse({
  operation,
  response,
}: ReferenceResponseInput): Promise<void> {
  const loaded = await loadedOperation(operation);
  const version = response.headers.get(SERVICE_VERSION_HEADER);
  if (version !== '1') {
    throw new Error(
      `${loaded.id}: response ${SERVICE_VERSION_HEADER} must be 1, received ${version ?? 'missing'}`
    );
  }

  if (!response.ok) {
    const type = response.headers.get('content-type') ?? '';
    if (!/^application\/problem\+json(?:\s*;|$)/i.test(type)) {
      throw new Error(
        `${loaded.id}: error response is not application/problem+json`
      );
    }
    const body = (await response.clone().json()) as unknown;
    const problem = createAjv();
    const schema = (await json(
      `${SCHEMA_ROOT}problem.schema.json`
    )) as AnySchema;
    const validate = problem.compile(schema);
    if (!validate(body)) {
      throw new Error(
        `${loaded.id}: invalid problem response: ${errors(validate.errors)}`
      );
    }
    if ((body as { status?: unknown }).status !== response.status) {
      throw new Error(
        `${loaded.id}: problem status does not match HTTP status`
      );
    }
    return;
  }

  if (!loaded.successStatuses.includes(response.status)) {
    throw new Error(
      `${loaded.id}: unexpected success status ${response.status}`
    );
  }
  if (response.status === 204) {
    if ((await response.clone().text()) !== '') {
      throw new Error(`${loaded.id}: 204 response must not carry a body`);
    }
    return;
  }
  const type = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(type)) {
    throw new Error(`${loaded.id}: success response is not application/json`);
  }
  await decodeConformingServiceResponse(loaded, await response.clone().json());
}

function problem(
  status: number,
  code: string,
  title: string,
  detail: string
): Record<string, unknown> {
  return {
    type: `https://exawatt.ai/problems/${code.replaceAll('_', '-')}`,
    title,
    status,
    detail,
    code,
    retryable: false,
    schemaVersion: 1,
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  contentType = 'application/json',
  version: string | null = '1'
): void {
  response.statusCode = status;
  response.setHeader('content-type', contentType);
  if (version !== null) response.setHeader(SERVICE_VERSION_HEADER, version);
  response.end(JSON.stringify(value));
}

function sendProblem(
  response: ServerResponse,
  status: number,
  code: string,
  title: string,
  detail: string
): void {
  sendJson(
    response,
    status,
    problem(status, code, title, detail),
    'application/problem+json'
  );
}

function requestHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.join(', ');
  return value ?? null;
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function responseForMode(
  mode: ServiceResponseMode,
  loaded: LoadedOperation,
  requestCount: number
): {
  status: number;
  body: unknown;
  version: string | null;
  contentType?: string;
  rawBody?: string;
  headers?: HeadersInit;
} {
  const status = loaded.successStatuses.at(-1) ?? 200;
  const current = structuredClone(loaded.response);
  switch (mode) {
    case 'current':
      return { status, body: current, version: '1' };
    case 'additive':
      return {
        status,
        body:
          current && typeof current === 'object'
            ? { ...current, serviceTrace: 'additive-v1-field' }
            : current,
        version: '1',
      };
    case 'missing-version':
      return { status, body: current, version: null };
    case 'malformed-version':
      return { status, body: current, version: 'one' };
    case 'unknown-version':
      return { status, body: current, version: '99' };
    case 'rollback':
      return {
        status,
        body:
          current && typeof current === 'object'
            ? { ...current, schemaVersion: 2 }
            : current,
        version: '2',
      };
    case 'schema-version-mismatch':
      return {
        status,
        body:
          current && typeof current === 'object'
            ? { ...current, schemaVersion: 2 }
            : current,
        version: '1',
      };
    case 'wrong-success-media':
      return {
        status,
        body: current,
        version: '1',
        contentType: 'text/plain',
      };
    case 'wrong-success-status':
      return {
        status: loaded.successStatuses.includes(202) ? 203 : 202,
        body: current ?? { schemaVersion: 1 },
        version: '1',
      };
    case 'malformed-json':
      return {
        status,
        body: null,
        version: '1',
        rawBody: '{"schemaVersion":1',
      };
    case 'malformed-envelope':
      return { status, body: { schemaVersion: 1 }, version: '1' };
    case 'problem':
      return {
        status: 429,
        body: {
          ...problem(
            429,
            'capacity_reached',
            'Service is at capacity',
            'Try again after Retry-After.'
          ),
          retryable: true,
        },
        version: '1',
        headers: { 'retry-after': '3600' },
      };
    case 'malformed-problem':
      return {
        status: 429,
        body: {
          ...problem(
            503,
            'capacity_reached',
            'Service is at capacity',
            'The body status deliberately disagrees with HTTP.'
          ),
          retryable: true,
        },
        version: '1',
      };
    case 'idempotent-repeat':
      return {
        status: requestCount === 1 ? 201 : 200,
        body:
          current && typeof current === 'object'
            ? { ...current, duplicate: requestCount > 1 }
            : current,
        version: '1',
      };
    case 'disconnect':
      throw new Error('disconnect responses are handled before serialization');
  }
}

function dynamicDistribution(origin: string): DistributionContractV2 {
  return parseDistributionContract({
    schemaVersion: 2,
    brand: {
      appId: 'dev.example.agentdesk',
      productName: 'Agent Desk',
      protocolScheme: 'agentdesk',
      iconPath: 'assets/community-icon.icns',
      updateChannel: 'stable',
    },
    account: {
      supabaseUrl: origin,
      supabaseAnonKey: 'conformance-public-anon-key',
      recoveryOrigin: origin,
    },
    services: {
      productFeedback: {
        url: `${origin}/v1/product-feedback`,
        protocolVersion: 1,
      },
      operatorStats: {
        url: `${origin}/v1/operator-stats`,
        protocolVersion: 1,
      },
      projects: null,
      preferences: null,
      accountData: null,
    },
    enrichment: {
      contextLabels: {
        url: `${origin}/v1/context-labels`,
        protocolVersion: 1,
      },
      conversationSummaries: {
        url: `${origin}/v1/conversation-summaries`,
        protocolVersion: 1,
      },
      goalVisuals: {
        url: `${origin}/v1/goal-visuals`,
        protocolVersion: 1,
      },
    },
    ownAccount: null,
    analytics: null,
    updates: null,
  });
}

export async function startStrictLoopbackDistributor(): Promise<StrictLoopbackDistributor> {
  const operations = await loadedOperations();
  const loadedById = new Map(
    operations.map(operation => [operation.id, operation])
  );
  const requests: RecordedServiceRequest[] = [];
  const acceptedByOperation = new Map<string, number>();
  let mode: ServiceResponseMode = 'current';

  const server = createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = `${requestUrl.pathname}${requestUrl.search}`;
    const operation = OPERATION_BY_WIRE.get(`${method} ${path}`) ?? null;
    const record: RecordedServiceRequest = {
      operation: operation?.id ?? null,
      method,
      path,
      version: requestHeader(
        request.headers[SERVICE_VERSION_HEADER.toLowerCase()]
      ),
      authorization: requestHeader(request.headers.authorization),
      body: null,
      bodyRead: false,
      accepted: false,
    };
    requests.push(record);

    if (!operation) {
      sendProblem(
        response,
        404,
        'unknown_operation',
        'Unknown operation',
        'The exact configured endpoint was not used.'
      );
      return;
    }
    if (record.version !== '1') {
      sendProblem(
        response,
        400,
        'unsupported_service_version',
        'Unsupported service version',
        'Send Exawatt-Service-Version: 1.'
      );
      return;
    }
    if (record.authorization !== `Bearer ${CONFORMANCE_ACCESS_TOKEN}`) {
      sendProblem(
        response,
        401,
        'unauthorized',
        'Unauthorized',
        'Use the conformance bearer token.'
      );
      return;
    }

    const loaded = loadedById.get(operation.id);
    if (!loaded) throw new Error(`Missing loaded operation ${operation.id}`);
    if (
      loaded.validateRequest &&
      !/^application\/json(?:\s*;|$)/i.test(
        String(request.headers['content-type'] ?? '')
      )
    ) {
      sendProblem(
        response,
        415,
        'unsupported_media_type',
        'Unsupported media type',
        'Requests with a body must use application/json.'
      );
      return;
    }

    const declaresBody =
      request.headers['content-length'] !== undefined ||
      request.headers['transfer-encoding'] !== undefined;
    if (!loaded.validateRequest && declaresBody) {
      sendProblem(
        response,
        400,
        'invalid_request',
        'Invalid request',
        'This operation has no request body.'
      );
      return;
    }

    let body: unknown = null;
    if (loaded.validateRequest) {
      try {
        body = await requestBody(request);
        record.body = body;
        record.bodyRead = true;
      } catch {
        record.bodyRead = true;
        sendProblem(
          response,
          400,
          'invalid_json',
          'Invalid JSON',
          'The request body is not JSON.'
        );
        return;
      }
    }

    if (loaded.validateRequest && !loaded.validateRequest(body)) {
      sendProblem(
        response,
        400,
        'invalid_request',
        'Invalid request',
        errors(loaded.validateRequest.errors)
      );
      return;
    }
    record.accepted = true;
    const requestCount = (acceptedByOperation.get(operation.id) ?? 0) + 1;
    acceptedByOperation.set(operation.id, requestCount);

    if (mode === 'disconnect') {
      request.socket.destroy();
      return;
    }
    const selected = responseForMode(mode, loaded, requestCount);
    if (selected.status === 204) {
      response.statusCode = 204;
      if (selected.version !== null) {
        response.setHeader(SERVICE_VERSION_HEADER, selected.version);
      }
      response.end();
      return;
    }
    if (selected.rawBody !== undefined) {
      response.statusCode = selected.status;
      response.setHeader('content-type', 'application/json');
      for (const [name, value] of new Headers(selected.headers)) {
        response.setHeader(name, value);
      }
      if (selected.version !== null) {
        response.setHeader(SERVICE_VERSION_HEADER, selected.version);
      }
      response.end(selected.rawBody);
      return;
    }
    for (const [name, value] of new Headers(selected.headers)) {
      response.setHeader(name, value);
    }
    sendJson(
      response,
      selected.status,
      selected.body,
      selected.contentType ??
        (selected.status >= 400
          ? 'application/problem+json'
          : 'application/json'),
      selected.version
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    distribution: dynamicDistribution(origin),
    requests,
    setResponseMode(next) {
      mode = next;
    },
    reset() {
      requests.length = 0;
      acceptedByOperation.clear();
      mode = 'current';
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    },
  };
}

export function endpointForFamily(
  distribution: DistributionContractV2,
  family: ServiceFamily
) {
  switch (family) {
    case 'contextLabels':
      return distribution.enrichment.contextLabels;
    case 'conversationSummaries':
      return distribution.enrichment.conversationSummaries;
    case 'goalVisuals':
      return distribution.enrichment.goalVisuals;
    case 'productFeedback':
      return distribution.services.productFeedback;
    case 'operatorStats':
      return distribution.services.operatorStats;
  }
}

export function requestInitForOperation(
  operation: ServiceOperation,
  body: unknown,
  headers: HeadersInit = {}
): RequestInit {
  const merged = new Headers(headers);
  merged.set('authorization', `Bearer ${CONFORMANCE_ACCESS_TOKEN}`);
  if (body !== null) merged.set('content-type', 'application/json');
  return {
    method: operation.method,
    headers: merged,
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  };
}

export async function referenceRequestForOperation(
  operation: ServiceOperation | string,
  url?: string
): Promise<Request> {
  const loaded = await loadedOperation(operation);
  const init = requestInitForOperation(loaded, loaded.request, {
    [SERVICE_VERSION_HEADER]: '1',
  });
  return new Request(url ?? `http://127.0.0.1${loaded.path}`, init);
}

/**
 * Portable adapter for composed private-route tests. This does not itself
 * prove the official implementation: a private test must bind an actual
 * route handler and its injected auth/database/provider ports here.
 */
export async function assertConformingReferenceHandler({
  operation,
  handler,
  url,
}: ReferenceHandlerInput): Promise<Response> {
  const request = await referenceRequestForOperation(operation, url);
  const response = await handler(request);
  await assertConformingServiceResponse({ operation, response });
  return response;
}
