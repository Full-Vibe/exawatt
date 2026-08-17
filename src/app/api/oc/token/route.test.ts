import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('retired OpenClaw token route', () => {
  it('never returns a credential, endpoint, or account-dependent response', async () => {
    const response = await GET();
    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({
      error:
        'OpenClaw credentials are available only to the desktop capability',
    });
    expect(JSON.stringify(body)).not.toMatch(/token|password|host|port|ws:/i);
  });
});
