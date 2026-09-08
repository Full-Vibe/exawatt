import { describe, expect, it } from 'vitest';
import {
  assertServiceRequestSchemaVersion,
  rejectUnsupportedServiceMediaType,
  rejectUnsupportedServiceVersion,
  SERVICE_VERSION_HEADER,
  serviceJson,
  serviceNoContent,
  serviceOptions,
  serviceProblem,
} from './service-protocol';

describe('compatible-service V1 server protocol', () => {
  it('temporarily accepts a missing header but rejects every explicit non-V1 value', async () => {
    expect(
      rejectUnsupportedServiceVersion(new Request('https://example.test'))
    ).toBeNull();
    expect(
      rejectUnsupportedServiceVersion(
        new Request('https://example.test', {
          headers: { [SERVICE_VERSION_HEADER]: '1' },
        })
      )
    ).toBeNull();

    for (const declared of ['0', '2', '1.0', 'latest', '1, 2']) {
      const response = rejectUnsupportedServiceVersion(
        new Request('https://example.test', {
          headers: { [SERVICE_VERSION_HEADER]: declared },
        })
      );
      expect(response?.status).toBe(400);
      expect(response?.headers.get(SERVICE_VERSION_HEADER)).toBe('1');
      expect(response?.headers.get('content-type')).toContain(
        'application/problem+json'
      );
      await expect(response?.json()).resolves.toMatchObject({
        schemaVersion: 1,
        code: 'unsupported_service_version',
        retryable: false,
      });
    }
  });

  it('accepts JSON media parameters and rejects absent or non-JSON bodies', async () => {
    expect(
      rejectUnsupportedServiceMediaType(
        new Request('https://example.test', {
          headers: { 'content-type': 'Application/JSON; charset=utf-8' },
        })
      )
    ).toBeNull();

    for (const contentType of [undefined, 'text/plain', 'application/cbor']) {
      const response = rejectUnsupportedServiceMediaType(
        new Request('https://example.test', {
          headers: contentType ? { 'content-type': contentType } : {},
        })
      );
      expect(response?.status).toBe(415);
      await expect(response?.json()).resolves.toMatchObject({
        schemaVersion: 1,
        code: 'unsupported_media_type',
        retryable: false,
      });
    }
  });

  it('requires the V1 body envelope once the request declares V1', () => {
    const legacy = new Request('https://example.test');
    expect(() => assertServiceRequestSchemaVersion(legacy, {})).not.toThrow();

    const versioned = new Request('https://example.test', {
      headers: { [SERVICE_VERSION_HEADER]: '1' },
    });
    expect(() =>
      assertServiceRequestSchemaVersion(versioned, { schemaVersion: 1 })
    ).not.toThrow();
    expect(() => assertServiceRequestSchemaVersion(versioned, {})).toThrow(
      'Schema version is unsupported'
    );
  });

  it('puts the response version and schema version on success and no-content responses', async () => {
    const response = serviceJson({ value: 'ok', schemaVersion: 99 });
    expect(response.headers.get(SERVICE_VERSION_HEADER)).toBe('1');
    await expect(response.json()).resolves.toEqual({
      value: 'ok',
      schemaVersion: 1,
    });

    const noContent = serviceNoContent();
    expect(noContent.status).toBe(204);
    expect(noContent.headers.get(SERVICE_VERSION_HEADER)).toBe('1');
    expect(await noContent.text()).toBe('');
  });

  it('allows the protocol header through browser preflight and exposes response metadata', () => {
    const response = serviceOptions(['POST']);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toBe(
      'POST, OPTIONS'
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      SERVICE_VERSION_HEADER
    );
    expect(response.headers.get('access-control-expose-headers')).toContain(
      SERVICE_VERSION_HEADER
    );
  });

  it('emits bounded RFC 9457 problems with retry metadata', async () => {
    const response = serviceProblem({
      status: 503,
      code: 'quota_unavailable',
      title: `  ${'title '.repeat(50)}  `,
      detail: 'detail '.repeat(100),
      retryable: true,
      headers: { 'Retry-After': '60' },
    });
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json'
    );
    expect(response.headers.get(SERVICE_VERSION_HEADER)).toBe('1');
    expect(response.headers.get('retry-after')).toBe('60');
    const body = await response.json();
    expect(body).toMatchObject({
      type: '/problems/quota-unavailable',
      status: 503,
      code: 'quota_unavailable',
      retryable: true,
      schemaVersion: 1,
    });
    expect(body.title.length).toBeLessThanOrEqual(160);
    expect(body.detail.length).toBeLessThanOrEqual(500);
  });
});
