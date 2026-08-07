import { describe, expect, it, vi } from 'vitest';
import { AUTH_LINK_OUTCOMES } from '@/components/auth/callback-failures';
import { handleElectronCallback } from './route';

function callback(query: string): Request {
  return new Request(`https://app.test/auth/electron-callback${query}`);
}

async function deepLink(response: Response): Promise<URL> {
  const body = await response.text();
  const match = body.match(/href="(exawatt:\/\/[^"]+)"/);
  expect(match, 'no deep link in the relay page').toBeTruthy();
  return new URL(match![1]);
}

describe('the desktop callback relays a code', () => {
  it('hands the authorization code to the app unchanged', async () => {
    const response = handleElectronCallback(callback('?code=abc123'));

    expect(response.status).toBe(200);
    const link = await deepLink(response);
    expect(link.searchParams.get('code')).toBe('abc123');
    expect(link.searchParams.get('link')).toBeNull();
  });
});

describe('a desktop link that comes back without a code', () => {
  it('tells the app "already linked" instead of dead-ending in a tab', async () => {
    const logFailure = vi.fn();

    const response = handleElectronCallback(
      callback(
        '?intent=link&error=server_error&error_code=identity_already_exists' +
          '&error_description=Identity%20is%20already%20linked'
      ),
      logFailure
    );

    expect(response.status).toBe(200);
    const link = await deepLink(response);
    expect(link.searchParams.get('link')).toBe('already_linked');
    // a success has nothing to diagnose
    expect(logFailure).not.toHaveBeenCalled();
  });

  it('relays a real failure as a code and logs the provider text', async () => {
    const logFailure = vi.fn();

    const response = handleElectronCallback(
      callback(
        '?intent=link&error_description=Identity%20is%20already%20linked%20to%20another%20user'
      ),
      logFailure
    );

    const link = await deepLink(response);
    expect(link.searchParams.get('link')).toBe('link_claimed');
    expect(logFailure).toHaveBeenCalledWith(
      'link_claimed',
      'Identity is already linked to another user'
    );
  });

  it('reports an empty link callback rather than saying nothing', async () => {
    const response = handleElectronCallback(callback('?intent=link'));

    const link = await deepLink(response);
    expect(link.searchParams.get('link')).toBe('link_incomplete');
  });

  it('never puts the provider’s words on the deep link', async () => {
    const attempts = [
      '?intent=link&error_description=Your%20account%20is%20suspended,%20call%20555-0100',
      '?intent=link&error=access_denied',
      '?intent=link',
    ];

    for (const query of attempts) {
      const response = handleElectronCallback(callback(query), () => {});
      const link = await deepLink(response);

      expect(AUTH_LINK_OUTCOMES).toContain(link.searchParams.get('link'));
      expect(link.href).not.toContain('555');
      expect([...link.searchParams.keys()]).toEqual(['link']);
    }
  });
});

describe('a sign-in callback is unchanged', () => {
  it('still refuses a callback with no code and no link intent', async () => {
    const response = handleElectronCallback(callback(''));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain(
      'Missing authorization code.'
    );
  });
});
