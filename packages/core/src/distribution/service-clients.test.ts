import { describe, expect, it, vi } from 'vitest';
import type { OperatorStatsPublishPayload } from '../operator-stats';
import type { DistributionEndpointRefV1 } from './contract';
import {
  createContextLabel,
  createGoalVisual,
  disableOperatorStatsProfile,
  getOperatorStatsProfile,
  publishOperatorStats,
  submitProductFeedback,
  summarizeConversations,
} from './service-clients';
import {
  CompatibleServiceProblemError,
  EXAWATT_SERVICE_VERSION_HEADER,
} from './service-protocol';

const endpoint: DistributionEndpointRefV1 = {
  url: 'https://service.example.test/operation',
  protocolVersion: 1,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      [EXAWATT_SERVICE_VERSION_HEADER]: '1',
    },
  });
}

function problem(
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Response {
  const status = Number(overrides.status ?? 503);
  return new Response(
    JSON.stringify({
      type: 'https://service.example.test/problems/unavailable',
      title: 'Unavailable',
      status,
      code: 'service_unavailable',
      retryable: true,
      ...overrides,
    }),
    {
      status,
      headers: {
        'content-type': 'application/problem+json',
        [EXAWATT_SERVICE_VERSION_HEADER]: '1',
        ...headers,
      },
    }
  );
}

describe('production compatible-service operations', () => {
  it('builds and decodes all seven published operations', async () => {
    const identityKey = 'a'.repeat(64);
    const cases = [
      {
        method: 'POST',
        call: (fetcher: typeof fetch) =>
          createContextLabel(
            endpoint,
            'token',
            {
              schemaVersion: 1,
              sessionKey: 'session',
              recentInstructions: [{ text: 'Ship it', submittedAt: 1 }],
            },
            { fetcher }
          ),
        response: {
          schemaVersion: 1,
          label: 'Ship release',
          relationship: 'same_context',
          confidence: 0.9,
          serviceTrace: 'ignored',
        },
      },
      {
        method: 'POST',
        call: (fetcher: typeof fetch) =>
          summarizeConversations(
            endpoint,
            'token',
            {
              schemaVersion: 1,
              conversations: [{ key: 'one', turns: ['Ship it'] }],
            },
            { fetcher }
          ),
        response: {
          schemaVersion: 1,
          conversations: [
            { key: 'one', title: 'Release', summary: 'Shipped release' },
          ],
          serviceTrace: 'ignored',
        },
      },
      {
        method: 'POST',
        call: (fetcher: typeof fetch) =>
          createGoalVisual(
            endpoint,
            'token',
            { schemaVersion: 1, identityKey },
            { fetcher }
          ),
        response: {
          schemaVersion: 1,
          identityKey,
          dataUrl: 'data:image/jpeg;base64,YQ==',
          serviceTrace: 'ignored',
        },
      },
      {
        method: 'POST',
        status: 201,
        call: (fetcher: typeof fetch) =>
          submitProductFeedback(
            endpoint,
            'token',
            {
              schemaVersion: 1,
              kind: 'bug',
              message: 'It broke',
              surface: 'test',
              idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
            },
            { fetcher }
          ),
        response: {
          schemaVersion: 1,
          id: '550e8400-e29b-41d4-a716-446655440000',
          duplicate: false,
          attachmentStored: false,
          serviceTrace: 'ignored',
        },
      },
      {
        method: 'GET',
        call: (fetcher: typeof fetch) =>
          getOperatorStatsProfile(endpoint, 'token', { fetcher }),
        response: { schemaVersion: 1, profile: null, serviceTrace: 'ignored' },
      },
      {
        method: 'POST',
        call: (fetcher: typeof fetch) =>
          publishOperatorStats(
            endpoint,
            'token',
            {} as OperatorStatsPublishPayload,
            { fetcher }
          ),
        response: {
          schemaVersion: 1,
          handle: 'operator',
          days: 1,
          runs: 2,
          serviceTrace: 'ignored',
        },
      },
    ] as const;

    for (const operation of cases) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json(
            operation.response,
            'status' in operation ? operation.status : 200
          )
        );
      const value = await operation.call(fetcher);
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(endpoint.url);
      expect(init?.method).toBe(operation.method);
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer token'
      );
      expect(
        new Headers(init?.headers).get(EXAWATT_SERVICE_VERSION_HEADER)
      ).toBe('1');
      expect(value).not.toHaveProperty('serviceTrace');
    }

    const deleteFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { [EXAWATT_SERVICE_VERSION_HEADER]: '1' },
      })
    );
    await disableOperatorStatsProfile(endpoint, 'token', {
      fetcher: deleteFetch,
    });
    expect(deleteFetch.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('rejects operation-specific success statuses without replay', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          schemaVersion: 1,
          label: 'Label',
          relationship: 'same_context',
          confidence: 1,
        },
        202
      )
    );
    await expect(
      createContextLabel(
        endpoint,
        'token',
        {
          schemaVersion: 1,
          sessionKey: 'session',
          recentInstructions: [{ text: 'Ship it', submittedAt: 1 }],
        },
        { fetcher }
      )
    ).rejects.toMatchObject({
      code: 'invalid_response_status',
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('requires DELETE to return exactly 204 with an empty body', async () => {
    const wrongStatus = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { [EXAWATT_SERVICE_VERSION_HEADER]: '1' },
      })
    );
    await expect(
      disableOperatorStatsProfile(endpoint, 'token', { fetcher: wrongStatus })
    ).rejects.toMatchObject({ code: 'invalid_response_status' });

    // Fetch implementations discard 204 bodies, so a declared non-empty body
    // is independently non-conforming even when the exposed stream is empty.
    const declaredBody = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: {
          [EXAWATT_SERVICE_VERSION_HEADER]: '1',
          'content-length': '1',
        },
      })
    );
    await expect(
      disableOperatorStatsProfile(endpoint, 'token', { fetcher: declaredBody })
    ).rejects.toMatchObject({ code: 'invalid_response_body' });
  });

  it('rejects malformed JPEG padding in the production goal decoder', async () => {
    const identityKey = 'a'.repeat(64);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        schemaVersion: 1,
        identityKey,
        dataUrl: 'data:image/jpeg;base64,a=b',
      })
    );
    await expect(
      createGoalVisual(
        endpoint,
        'token',
        { schemaVersion: 1, identityKey },
        { fetcher }
      )
    ).rejects.toMatchObject({ code: 'invalid_response_body' });
  });

  it('retains a validated Retry-After and rejects malformed problem metadata', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(problem({}, { 'retry-after': '3600' }));
    const thrown = await getOperatorStatsProfile(endpoint, 'token', { fetcher })
      .then(() => null)
      .catch(value => value);
    expect(thrown).toBeInstanceOf(CompatibleServiceProblemError);
    expect(thrown).toMatchObject({
      status: 503,
      retryable: true,
      retryAfterSeconds: 3600,
    });

    for (const response of [
      problem({}, { 'retry-after': 'tomorrow' }),
      problem({ type: 'bad uri with spaces' }),
    ]) {
      const invalid = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        getOperatorStatsProfile(endpoint, 'token', { fetcher: invalid })
      ).rejects.toMatchObject({ code: 'invalid_problem_body' });
    }
  });
});
