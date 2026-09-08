import { afterEach, describe, expect, it } from 'vitest';
import { GET } from './route';

const ENV_NAME = 'EXAWATT_RESOLVED_WEB_ICON_BASE64';
const before = process.env[ENV_NAME];

afterEach(() => {
  if (before === undefined) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = before;
});

describe('distribution web icon route', () => {
  it('serves the prepared bytes as a cache-bounded PNG', async () => {
    const icon = Buffer.from('fixture-png-bytes');
    process.env[ENV_NAME] = icon.toString('base64');

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(icon.length));
    expect(response.headers.get('cache-control')).toContain('must-revalidate');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(icon);
  });

  it('fails loudly when Next bypasses distribution preparation', () => {
    delete process.env[ENV_NAME];

    expect(() => GET()).toThrow(/Prepared distribution web icon is missing/);
  });
});
