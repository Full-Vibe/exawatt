import { describe, expect, it, vi } from 'vitest';
import {
  CompatibleServiceProblemError,
  CompatibleServiceProtocolError,
  decodeCompatibleServiceJson,
  decodeCompatibleServiceProblem,
  EXAWATT_SERVICE_VERSION_HEADER,
  fetchCompatibleService,
  type CompatibleServiceFetch,
} from './service-protocol';

const endpoint = {
  url: 'https://services.example.test/v1/context-labels',
  protocolVersion: 1,
} as const;

function response(
  body: unknown,
  version: string | null = '1',
  status = 200,
  contentType = 'application/json'
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': contentType,
      ...(version === null
        ? {}
        : { [EXAWATT_SERVICE_VERSION_HEADER]: version }),
    },
  });
}

describe('compatible service client protocol', () => {
  it('sends the selected codec to the exact configured URL', async () => {
    const fetcher = vi.fn<CompatibleServiceFetch>(async () =>
      response({ schemaVersion: 1 })
    );
    const result = await fetchCompatibleService(
      endpoint,
      { method: 'POST', headers: { authorization: 'Bearer account-token' } },
      fetcher
    );

    expect(result.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(endpoint.url);
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer account-token'
    );
    expect(new Headers(init?.headers).get(EXAWATT_SERVICE_VERSION_HEADER)).toBe(
      '1'
    );
  });

  it.each([
    ['missing_response_version', null],
    ['incompatible_response_version', '2'],
    ['incompatible_response_version', 'unknown'],
  ] as const)('refuses %s without replaying', async (code, version) => {
    const fetcher = vi.fn<CompatibleServiceFetch>(async () =>
      response({}, version)
    );
    const failure = await fetchCompatibleService(
      endpoint,
      { method: 'POST' },
      fetcher
    ).catch(error => error);

    expect(failure).toBeInstanceOf(CompatibleServiceProtocolError);
    expect(failure).toMatchObject({ code, retryable: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('allows additive response fields while the operation decoder owns invariants', async () => {
    const result = await decodeCompatibleServiceJson(
      endpoint,
      response({ schemaVersion: 1, value: 'kept', trace: 'ignored' }),
      value => {
        const input = value as Record<string, unknown>;
        if (input.schemaVersion !== 1 || typeof input.value !== 'string') {
          throw new TypeError('invalid');
        }
        return { value: input.value };
      }
    );
    expect(result).toEqual({ value: 'kept' });
  });

  it('turns malformed success bodies into non-retryable protocol errors', async () => {
    const failure = await decodeCompatibleServiceJson(
      endpoint,
      response({ schemaVersion: 2 }),
      () => {
        throw new TypeError('wrong schema');
      }
    ).catch(error => error);
    expect(failure).toMatchObject({
      code: 'invalid_response_body',
      retryable: false,
    });
  });

  it('rejects JSON-shaped success under an undeclared media type', async () => {
    await expect(
      decodeCompatibleServiceJson(
        endpoint,
        response({ schemaVersion: 1 }, '1', 200, 'text/plain'),
        value => value
      )
    ).rejects.toMatchObject({
      code: 'invalid_response_body',
      retryable: false,
    });
  });

  it('decodes the published bounded problem envelope', async () => {
    await expect(
      decodeCompatibleServiceProblem(
        endpoint,
        response(
          {
            type: 'https://example.test/problems/capacity',
            title: 'Service is at capacity',
            status: 429,
            detail: 'Try again later.',
            code: 'capacity_reached',
            retryable: true,
            schemaVersion: 1,
            additiveTrace: 'ignored',
          },
          '1',
          429,
          'application/problem+json'
        )
      )
    ).resolves.toMatchObject({
      status: 429,
      code: 'capacity_reached',
      retryable: true,
    });
  });

  it.each([
    [429, 'capacity_reached', true],
    [422, 'request_rejected', false],
  ] as const)(
    'turns a conforming %i refusal into a typed service problem',
    async (status, code, retryable) => {
      const fetcher = vi.fn<CompatibleServiceFetch>(async () =>
        response(
          {
            type: `https://example.test/problems/${code}`,
            title: 'Service refused the request',
            status,
            code,
            retryable,
            schemaVersion: 1,
          },
          '1',
          status,
          'application/problem+json; charset=utf-8'
        )
      );

      const failure = await fetchCompatibleService(
        endpoint,
        { method: 'POST', body: '{}' },
        fetcher
      ).catch(error => error);

      expect(failure).toBeInstanceOf(CompatibleServiceProblemError);
      expect(failure).toMatchObject({
        name: 'CompatibleServiceProblemError',
        status,
        code,
        retryable,
        problem: { schemaVersion: 1, status, code, retryable },
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  );

  it.each([
    ['wrong media type', 429, 'capacity_reached', 'application/json'],
    [
      'contradictory status',
      503,
      'capacity_reached',
      'application/problem+json',
    ],
    ['invalid code', 429, 'CAPACITY-REACHED', 'application/problem+json'],
  ] as const)(
    'rejects a problem with %s as a non-retryable protocol error',
    async (_case, httpStatus, code, contentType) => {
      const fetcher = vi.fn<CompatibleServiceFetch>(async () =>
        response(
          {
            type: 'https://example.test/problems/capacity',
            title: 'Service is at capacity',
            status: 429,
            code,
            retryable: true,
          },
          '1',
          httpStatus,
          contentType
        )
      );

      await expect(
        fetchCompatibleService(
          endpoint,
          { method: 'POST', body: '{}' },
          fetcher
        )
      ).rejects.toMatchObject({
        code: 'invalid_problem_body',
        retryable: false,
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  );
});
