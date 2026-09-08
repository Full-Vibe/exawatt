const SERVICE_VERSION = 1 as const;

export const SERVICE_VERSION_HEADER = 'Exawatt-Service-Version';

interface ServiceResponseInit {
  status?: number;
  headers?: HeadersInit;
}

interface ServiceProblemInput extends ServiceResponseInit {
  code: string;
  title: string;
  retryable: boolean;
  detail?: string;
  instance?: string;
}

function headersWithVersion(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set(SERVICE_VERSION_HEADER, String(SERVICE_VERSION));
  // Official desktop renderers run on a loopback origin, while compatible
  // services may run anywhere. Bearer authority stays in the Authorization
  // header; CORS only makes that explicit client/service relationship usable.
  result.set('Access-Control-Allow-Origin', '*');
  result.set(
    'Access-Control-Expose-Headers',
    `${SERVICE_VERSION_HEADER}, Exawatt-Cache, Retry-After`
  );
  return result;
}

function bounded(value: string, maximum: number): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

/**
 * Official services may temporarily accept an absent version header for an
 * installed pre-contract client. Once a client names a version, however, it
 * must name V1 exactly. Run this before auth, body parsing, quota, database,
 * cache, or provider work in every compatible-service route.
 */
export function rejectUnsupportedServiceVersion(
  request: Request
): Response | null {
  const declared = request.headers.get(SERVICE_VERSION_HEADER);
  if (declared === null || declared === String(SERVICE_VERSION)) return null;
  return serviceProblem({
    status: 400,
    code: 'unsupported_service_version',
    title: 'Unsupported service version',
    detail: `This endpoint supports ${SERVICE_VERSION_HEADER} ${SERVICE_VERSION}.`,
    retryable: false,
  });
}

/**
 * Body-bearing V1 operations accept JSON and nothing else. Call this only
 * after version and authentication checks, but before reading the body.
 */
export function rejectUnsupportedServiceMediaType(
  request: Request
): Response | null {
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType === 'application/json') return null;
  return serviceProblem({
    status: 415,
    code: 'unsupported_media_type',
    title: 'Content-Type must be application/json',
    retryable: false,
  });
}

/**
 * Headerless installed clients may predate the envelope field on a service
 * family. An explicitly versioned request does not get that exception.
 */
export function assertServiceRequestSchemaVersion(
  request: Request,
  value: unknown
): void {
  if (request.headers.get(SERVICE_VERSION_HEADER) === null) return;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== SERVICE_VERSION
  ) {
    throw new Error('Schema version is unsupported');
  }
}

export function serviceJson<T extends object>(
  value: T,
  { status = 200, headers }: ServiceResponseInit = {}
): Response {
  return Response.json(
    { ...value, schemaVersion: SERVICE_VERSION },
    { status, headers: headersWithVersion(headers) }
  );
}

export function serviceNoContent({
  status = 204,
  headers,
}: ServiceResponseInit = {}): Response {
  return new Response(null, { status, headers: headersWithVersion(headers) });
}

export function serviceOptions(methods: readonly string[]): Response {
  const allowed = [...new Set([...methods, 'OPTIONS'])].join(', ');
  return serviceNoContent({
    headers: {
      'Access-Control-Allow-Headers': `Authorization, Content-Type, ${SERVICE_VERSION_HEADER}`,
      'Access-Control-Allow-Methods': allowed,
      'Access-Control-Max-Age': '86400',
    },
  });
}

/** RFC 9457 problem detail with the bounded V1 extensions clients consume. */
export function serviceProblem({
  status = 500,
  code,
  title,
  retryable,
  detail,
  instance,
  headers,
}: ServiceProblemInput): Response {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new Error(`Service problem status is invalid: ${status}`);
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(code)) {
    throw new Error(`Service problem code is invalid: ${code}`);
  }
  const responseHeaders = headersWithVersion(headers);
  responseHeaders.set('content-type', 'application/problem+json');
  return new Response(
    JSON.stringify({
      type: `/problems/${code.replaceAll('_', '-')}`,
      title: bounded(title, 160) || 'Service request failed',
      status,
      code,
      retryable,
      schemaVersion: SERVICE_VERSION,
      ...(detail ? { detail: bounded(detail, 500) } : {}),
      ...(instance ? { instance: bounded(instance, 500) } : {}),
    }),
    { status, headers: responseHeaders }
  );
}
