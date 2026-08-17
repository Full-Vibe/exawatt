import { describe, expect, it, vi } from 'vitest';
import { AUTH_LINK_OUTCOMES } from '@/components/auth/callback-failures';
import { handleElectronCallback } from './route';

const officialIdentity = {
  productName: 'Exawatt',
  protocolScheme: 'exawatt',
};

function callback(query: string): Request {
  return new Request(`https://app.test/auth/electron-callback${query}`);
}

/** Every case below describes a distribution that HAS an account service; the
 *  community answer is asserted on its own in the runtime-degradation suite. */
function relayed(
  request: Request,
  logFailure?: Parameters<typeof handleElectronCallback>[2]
): Response {
  return handleElectronCallback(request, officialIdentity, logFailure, true);
}

async function deepLink(response: Response): Promise<URL> {
  const body = await response.text();
  const match = body.match(/href="([a-z][a-z0-9+.-]*:\/\/[^"]+)"/);
  expect(match, 'no deep link in the relay page').toBeTruthy();
  return new URL(match![1]);
}

describe('the desktop callback relays a code', () => {
  it('hands the authorization code to the app unchanged', async () => {
    const response = relayed(callback('?code=abc123'));

    expect(response.status).toBe(200);
    const link = await deepLink(response);
    expect(link.searchParams.get('code')).toBe('abc123');
    expect(link.searchParams.get('link')).toBeNull();
  });
});

describe('a desktop link that comes back without a code', () => {
  it('tells the app "already linked" instead of dead-ending in a tab', async () => {
    const logFailure = vi.fn();

    const response = relayed(
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

    const response = relayed(
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
    const response = relayed(callback('?intent=link'));

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
      const response = relayed(callback(query), () => {});
      const link = await deepLink(response);

      expect(AUTH_LINK_OUTCOMES).toContain(link.searchParams.get('link'));
      expect(link.href).not.toContain('555');
      expect([...link.searchParams.keys()]).toEqual(['link']);
    }
  });
});

describe('a sign-in callback is unchanged', () => {
  it('still refuses a callback with no code and no link intent', async () => {
    const response = relayed(callback(''));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain(
      'Missing authorization code.'
    );
  });
});

describe('distribution-owned callback identity', () => {
  it('supports a downstream distributor without claiming exawatt://', async () => {
    const response = handleElectronCallback(
      callback('?code=downstream'),
      {
        productName: 'Acme Agent Console',
        protocolScheme: 'acme-agents',
      },
      undefined,
      true
    );

    const body = await response.clone().text();
    const link = await deepLink(response);
    expect(link.protocol).toBe('acme-agents:');
    expect(link.searchParams.get('code')).toBe('downstream');
    expect(body).not.toContain('exawatt://');
    expect(body).toContain('Returning to Acme Agent Console');
  });

  it('does not emit a desktop deep link for the community build', async () => {
    const response = handleElectronCallback(callback('?code=ignored'), {
      productName: 'Exawatt Community',
      protocolScheme: null,
    });

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain('Desktop authentication is not configured');
    expect(body).not.toMatch(/[a-z][a-z0-9+.-]*:\/\/auth\/callback/);
  });
});
