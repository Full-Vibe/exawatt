import type { DistributionEndpointRefV1 } from './contract';
import { SERVICE_VERSION_HEADER } from '../service-protocol';

/** The wire header is deliberately independent of the distribution schema. */
export const EXAWATT_SERVICE_VERSION_HEADER = SERVICE_VERSION_HEADER;

export type CompatibleServiceProtocolErrorCode =
  | 'missing_response_version'
  | 'incompatible_response_version'
  | 'invalid_response_status'
  | 'invalid_response_body'
  | 'invalid_problem_body';

/**
 * A service answered, but not in the codec the distribution selected.
 *
 * These errors are never retryable. In particular, a mutating request must not
 * be replayed against another version in an attempt to negotiate a codec.
 */
export class CompatibleServiceProtocolError extends Error {
  readonly retryable = false as const;

  constructor(
    readonly code: CompatibleServiceProtocolErrorCode,
    message: string,
    readonly expectedVersion: number,
    readonly receivedVersion: string | null = null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CompatibleServiceProtocolError';
  }
}

export interface CompatibleServiceProblemV1 {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  retryable: boolean;
  schemaVersion?: 1;
}

/** A conforming service refusal, distinct from transport and codec failures. */
export class CompatibleServiceProblemError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  /** Validated delta-seconds from Retry-After, or null when not supplied. */
  readonly retryAfterSeconds: number | null;

  constructor(
    readonly problem: CompatibleServiceProblemV1,
    retryAfterSeconds: number | null = null
  ) {
    super(`${problem.status}: ${problem.detail ?? problem.title}`);
    this.name = 'CompatibleServiceProblemError';
    this.status = problem.status;
    this.code = problem.code;
    this.retryable = problem.retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type CompatibleServiceFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

function boundedString(
  value: unknown,
  maximum: number,
  optional = false
): string | undefined {
  if (value === undefined && optional) return undefined;
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : undefined;
}

function uriReference(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) {
    return undefined;
  }
  try {
    // A base admits relative references while URL parsing rejects malformed
    // percent escapes and other strings that are not URI references.
    new URL(value, 'https://compatible-service.invalid/');
    return value;
  } catch {
    return undefined;
  }
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (value === null) return null;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new TypeError('Retry-After is not a positive delta-seconds value');
  }
  const seconds = Number(value);
  // setTimeout cannot represent a larger delay without wrapping.
  if (!Number.isSafeInteger(seconds) || seconds > 2_147_483) {
    throw new TypeError('Retry-After is outside the supported range');
  }
  return seconds;
}

function protocolError(
  endpoint: DistributionEndpointRefV1,
  code: CompatibleServiceProtocolErrorCode,
  message: string,
  receivedVersion: string | null,
  cause?: unknown
): CompatibleServiceProtocolError {
  return new CompatibleServiceProtocolError(
    code,
    message,
    endpoint.protocolVersion,
    receivedVersion,
    cause === undefined ? undefined : { cause }
  );
}

/** Add the exact selected codec without mutating caller-owned headers. */
export function compatibleServiceRequestHeaders(
  endpoint: DistributionEndpointRefV1,
  headers?: HeadersInit
): Headers {
  const result = new Headers(headers);
  result.set(EXAWATT_SERVICE_VERSION_HEADER, String(endpoint.protocolVersion));
  return result;
}

/**
 * Fetch the exact configured operation URL and refuse a response encoded with
 * any codec other than the one selected by the distribution contract.
 */
export async function fetchCompatibleService(
  endpoint: DistributionEndpointRefV1,
  init: RequestInit,
  fetcher: CompatibleServiceFetch = fetch
): Promise<Response> {
  const response = await fetcher(endpoint.url, {
    ...init,
    headers: compatibleServiceRequestHeaders(endpoint, init.headers),
  });
  const received = response.headers.get(EXAWATT_SERVICE_VERSION_HEADER);
  if (received === null) {
    throw protocolError(
      endpoint,
      'missing_response_version',
      `Compatible service response omitted ${EXAWATT_SERVICE_VERSION_HEADER}`,
      null
    );
  }
  if (received !== String(endpoint.protocolVersion)) {
    throw protocolError(
      endpoint,
      'incompatible_response_version',
      `Compatible service responded with protocol ${received}; expected ${endpoint.protocolVersion}`,
      received
    );
  }
  if (!response.ok) {
    const problem = await decodeCompatibleServiceProblem(endpoint, response);
    let retryAfter: number | null;
    try {
      retryAfter = retryAfterSeconds(response);
    } catch (cause) {
      throw protocolError(
        endpoint,
        'invalid_problem_body',
        'Compatible service returned an invalid Retry-After header',
        received,
        cause
      );
    }
    throw new CompatibleServiceProblemError(problem, retryAfter);
  }
  return response;
}

/** Parse a JSON success envelope and turn decoder failures into one typed seam. */
export async function decodeCompatibleServiceJson<T>(
  endpoint: DistributionEndpointRefV1,
  response: Response,
  decode: (value: unknown) => T
): Promise<T> {
  try {
    const mediaType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      throw new TypeError('response has invalid media type');
    }
    return decode(await response.json());
  } catch (cause) {
    if (cause instanceof CompatibleServiceProtocolError) throw cause;
    throw protocolError(
      endpoint,
      'invalid_response_body',
      'Compatible service returned an invalid response body',
      String(endpoint.protocolVersion),
      cause
    );
  }
}

/** Decode the bounded RFC 9457-compatible V1 error published by the spec. */
export async function decodeCompatibleServiceProblem(
  endpoint: DistributionEndpointRefV1,
  response: Response
): Promise<CompatibleServiceProblemV1> {
  try {
    const mediaType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== 'application/problem+json') {
      throw new TypeError('problem has invalid media type');
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('problem is not an object');
    }
    const input = value as Record<string, unknown>;
    const type = uriReference(input.type);
    const title = boundedString(input.title, 160);
    const detail =
      input.detail === undefined
        ? undefined
        : typeof input.detail === 'string' && input.detail.length <= 500
          ? input.detail
          : undefined;
    const instance =
      input.instance === undefined ? undefined : uriReference(input.instance);
    const code = boundedString(input.code, 64);
    if (
      !type ||
      !title ||
      !code ||
      (input.detail !== undefined && detail === undefined) ||
      (input.instance !== undefined && instance === undefined) ||
      !/^[a-z][a-z0-9_]{0,63}$/.test(code) ||
      !Number.isInteger(input.status) ||
      Number(input.status) < 400 ||
      Number(input.status) > 599 ||
      Number(input.status) !== response.status ||
      typeof input.retryable !== 'boolean' ||
      (input.schemaVersion !== undefined && input.schemaVersion !== 1)
    ) {
      throw new TypeError('problem has invalid fields');
    }
    return {
      type,
      title,
      status: Number(input.status),
      ...(detail === undefined ? {} : { detail }),
      ...(instance === undefined ? {} : { instance }),
      code,
      retryable: input.retryable,
      ...(input.schemaVersion === 1 ? { schemaVersion: 1 as const } : {}),
    };
  } catch (cause) {
    if (cause instanceof CompatibleServiceProtocolError) throw cause;
    throw protocolError(
      endpoint,
      'invalid_problem_body',
      'Compatible service returned an invalid problem body',
      String(endpoint.protocolVersion),
      cause
    );
  }
}

export function isCompatibleServiceProtocolError(
  value: unknown
): value is CompatibleServiceProtocolError {
  return value instanceof CompatibleServiceProtocolError;
}

export function isCompatibleServiceProblemError(
  value: unknown
): value is CompatibleServiceProblemError {
  return value instanceof CompatibleServiceProblemError;
}
