import { describe, expect, it, vi } from 'vitest';
import { createElectronAuthCookies } from './auth-cookies';

describe('Electron auth cookie adapter', () => {
  it('reads the renderer cookie jar and maps Supabase cookie options', async () => {
    const get = vi
      .fn()
      .mockResolvedValue([
        { name: 'sb-project-auth-token', value: 'encoded-session' },
      ]);
    const set = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const recordDiagnostic = vi.fn();
    const adapter = createElectronAuthCookies(
      { get, set, remove },
      'http://127.0.0.1:43123/workspace',
      recordDiagnostic
    );

    await expect(adapter.getAll()).resolves.toEqual([
      { name: 'sb-project-auth-token', value: 'encoded-session' },
    ]);
    await adapter.setAll([
      {
        name: 'sb-project-auth-token',
        value: 'new-session',
        options: {
          path: '/',
          sameSite: 'lax',
          httpOnly: false,
          maxAge: 3_600,
        },
      },
    ]);

    expect(get).toHaveBeenCalledWith({ url: 'http://127.0.0.1:43123' });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://127.0.0.1:43123',
        name: 'sb-project-auth-token',
        value: 'new-session',
        path: '/',
        sameSite: 'lax',
        httpOnly: false,
        expirationDate: expect.any(Number),
      })
    );
    expect(recordDiagnostic).toHaveBeenCalledWith('auth.cookies.read', {
      count: 1,
      verifierCount: 0,
      sessionCount: 1,
    });
    expect(recordDiagnostic).toHaveBeenCalledWith('auth.cookies.mutated', {
      requestedCount: 1,
      setCount: 1,
      removeCount: 0,
      verifierCount: 0,
      sessionCount: 1,
    });
  });

  it('removes expired or empty chunks instead of retaining stale session data', async () => {
    const cookies = {
      get: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = createElectronAuthCookies(
      cookies,
      'http://127.0.0.1:43123'
    );

    await adapter.setAll([
      {
        name: 'sb-project-auth-token.1',
        value: '',
        options: { maxAge: 0 },
      },
    ]);

    expect(cookies.remove).toHaveBeenCalledWith(
      'http://127.0.0.1:43123',
      'sb-project-auth-token.1'
    );
    expect(cookies.set).not.toHaveBeenCalled();
  });
});
