import fs from 'fs';
import path from 'path';

export type AuthDiagnosticFields = Record<string, unknown>;
export type AuthDiagnosticRecorder = (
  event: string,
  fields?: AuthDiagnosticFields
) => void;

const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_TEXT_LENGTH = 2_000;

interface PersistentAuthDiagnosticsOptions {
  logPath: string;
  context: AuthDiagnosticFields;
  maxBytes?: number;
}

export function createPersistentAuthDiagnostics(
  options: PersistentAuthDiagnosticsOptions
): AuthDiagnosticRecorder {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  fs.mkdirSync(path.dirname(options.logPath), {
    recursive: true,
    mode: 0o700,
  });

  return (event, fields = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      event: sanitizeAuthDiagnosticText(event),
      ...sanitizeAuthDiagnosticFields(options.context),
      ...sanitizeAuthDiagnosticFields(fields),
    };
    const line = `${JSON.stringify(entry)}\n`;

    try {
      rotateIfNeeded(options.logPath, Buffer.byteLength(line), maxBytes);
      fs.appendFileSync(options.logPath, line, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (error) {
      console.error('[auth-diagnostic] Could not persist auth event', {
        event: entry.event,
        error: describeAuthError(error),
      });
    }

    console.info('[auth-diagnostic]', entry);
  };
}

export function instrumentAuthFetch(
  transport: typeof fetch,
  record: AuthDiagnosticRecorder,
  transportName: string
): typeof fetch {
  return async (input, init) => {
    const startedAt = Date.now();
    const request = describeRequest(input, init);
    record('auth.transport.request', {
      transport: transportName,
      ...request,
    });

    try {
      const response = await transport(input, init);
      record('auth.transport.response', {
        transport: transportName,
        ...request,
        elapsedMs: Date.now() - startedAt,
        status: response.status,
        ok: response.ok,
        responseType: response.type,
      });
      return response;
    } catch (error) {
      record('auth.transport.failure', {
        transport: transportName,
        ...request,
        elapsedMs: Date.now() - startedAt,
        error: describeAuthError(error),
      });
      throw error;
    }
  };
}

export function describeAuthError(
  error: unknown,
  seen = new Set<unknown>()
): AuthDiagnosticFields {
  if (!error || typeof error !== 'object') {
    return { value: sanitizeAuthDiagnosticText(String(error)) };
  }
  if (seen.has(error)) return { circular: true };
  seen.add(error);

  const candidate = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    address?: unknown;
    port?: unknown;
    status?: unknown;
    stack?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  const details: AuthDiagnosticFields = {};
  for (const key of [
    'name',
    'message',
    'code',
    'errno',
    'syscall',
    'address',
    'port',
    'status',
  ] as const) {
    const value = candidate[key];
    if (typeof value === 'string') {
      details[key] = sanitizeAuthDiagnosticText(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      details[key] = value;
    }
  }
  if (typeof candidate.stack === 'string') {
    details.stack = sanitizeAuthDiagnosticText(
      candidate.stack.split('\n').slice(0, 16).join('\n')
    );
  }
  if (candidate.cause !== undefined) {
    details.cause = describeAuthError(candidate.cause, new Set(seen));
  }
  if (Array.isArray(candidate.errors)) {
    details.errors = candidate.errors
      .slice(0, 8)
      .map(nested => describeAuthError(nested, new Set(seen)));
  }
  return details;
}

function describeRequest(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): AuthDiagnosticFields {
  const inputRecord =
    input && typeof input === 'object'
      ? (input as { url?: unknown; method?: unknown; headers?: unknown })
      : null;
  const rawUrl =
    input instanceof URL
      ? input.toString()
      : typeof input === 'string'
        ? input
        : typeof inputRecord?.url === 'string'
          ? inputRecord.url
          : '';
  const url = safeUrlMetadata(rawUrl);
  const body = init?.body;

  return {
    ...url,
    method:
      init?.method ??
      (typeof inputRecord?.method === 'string' ? inputRecord.method : 'GET'),
    headerNames: headerNames(init?.headers ?? inputRecord?.headers),
    bodyType: bodyType(body),
    ...(bodyByteLength(body) === undefined
      ? {}
      : { bodyByteLength: bodyByteLength(body) }),
    hasSignal: Boolean(init?.signal),
    signalAborted: init?.signal?.aborted ?? false,
    redirect: init?.redirect ?? 'follow',
  };
}

function safeUrlMetadata(rawUrl: string): AuthDiagnosticFields {
  try {
    const url = new URL(rawUrl);
    return {
      scheme: url.protocol,
      host: url.host,
      path: url.pathname,
      queryNames: [...new Set(url.searchParams.keys())].sort(),
    };
  } catch {
    return { urlParseFailed: true };
  }
}

function headerNames(headers: unknown): string[] {
  if (!headers) return [];
  try {
    return [
      ...new Headers(
        headers as ConstructorParameters<typeof Headers>[0]
      ).keys(),
    ].sort();
  } catch {
    return ['unreadable'];
  }
}

function bodyType(body: unknown): string {
  if (body === undefined || body === null) return 'none';
  if (typeof body === 'string') return 'string';
  if (body instanceof URLSearchParams) return 'url-search-params';
  if (body instanceof ArrayBuffer) return 'array-buffer';
  if (ArrayBuffer.isView(body)) return body.constructor.name;
  return body.constructor?.name ?? typeof body;
}

function bodyByteLength(body: unknown): number | undefined {
  if (typeof body === 'string') return Buffer.byteLength(body);
  if (body instanceof URLSearchParams) {
    return Buffer.byteLength(body.toString());
  }
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
}

function sanitizeAuthDiagnosticFields(
  fields: AuthDiagnosticFields
): AuthDiagnosticFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      sanitizeAuthDiagnosticValue(value, 0),
    ])
  );
}

function sanitizeAuthDiagnosticValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeAuthDiagnosticText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 5) return '[MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value
      .slice(0, 16)
      .map(item => sanitizeAuthDiagnosticValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sanitizeAuthDiagnosticValue(nested, depth + 1),
      ])
    );
  }
  return sanitizeAuthDiagnosticText(String(value));
}

function sanitizeAuthDiagnosticText(value: string): string {
  return value
    .slice(0, MAX_TEXT_LENGTH)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,}]+/gi, '$1[REDACTED]')
    .replace(
      /([?&](?:access_token|refresh_token|token|code|code_verifier)=)[^&\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /(["']?(?:access_token|refresh_token|token|code|code_verifier)["']?\s*[:=]\s*["'])[^"']+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /\b(access_token|refresh_token|token|code|code_verifier)\s*[:=]\s*["']?(?!\[REDACTED\])[^\s,"';}\]]+/gi,
      '$1=[REDACTED]'
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[REDACTED_JWT]'
    )
    .replace(/\b[A-Za-z0-9_-]{96,}\b/g, '[REDACTED_LONG_VALUE]');
}

function rotateIfNeeded(
  logPath: string,
  incomingBytes: number,
  maxBytes: number
): void {
  let currentBytes = 0;
  try {
    currentBytes = fs.statSync(logPath).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (currentBytes + incomingBytes <= maxBytes) return;

  const previousPath = `${logPath}.1`;
  fs.rmSync(previousPath, { force: true });
  fs.renameSync(logPath, previousPath);
}
