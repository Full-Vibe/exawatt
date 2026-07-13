import type { CookieMethodsBrowser, CookieOptions } from '@supabase/ssr';
import type { Cookies, CookiesSetDetails } from 'electron';
import {
  describeAuthError,
  type AuthDiagnosticRecorder,
} from './auth-diagnostics';

export function createElectronAuthCookies(
  cookies: Pick<Cookies, 'get' | 'set' | 'remove'>,
  rendererOrigin: string,
  recordDiagnostic: AuthDiagnosticRecorder = () => {}
): CookieMethodsBrowser {
  const origin = new URL(rendererOrigin).origin;

  return {
    getAll: async () => {
      let stored: Awaited<ReturnType<Pick<Cookies, 'get'>['get']>>;
      try {
        stored = await cookies.get({ url: origin });
      } catch (error) {
        recordDiagnostic('auth.cookies.read_failure', {
          error: describeAuthError(error),
        });
        throw error;
      }
      recordDiagnostic('auth.cookies.read', {
        count: stored.length,
        verifierCount: stored.filter(cookie =>
          cookie.name.includes('code-verifier')
        ).length,
        sessionCount: stored.filter(cookie =>
          cookie.name.includes('auth-token')
        ).length,
      });
      return stored.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
      }));
    },
    setAll: async cookiesToSet => {
      let setCount = 0;
      let removeCount = 0;
      try {
        for (const { name, value, options } of cookiesToSet) {
          if (
            !value ||
            (typeof options.maxAge === 'number' && options.maxAge <= 0)
          ) {
            await cookies.remove(origin, name);
            removeCount += 1;
            continue;
          }

          await cookies.set(toElectronCookie(origin, name, value, options));
          setCount += 1;
        }
      } catch (error) {
        recordDiagnostic('auth.cookies.mutation_failure', {
          requestedCount: cookiesToSet.length,
          setCount,
          removeCount,
          error: describeAuthError(error),
        });
        throw error;
      }
      recordDiagnostic('auth.cookies.mutated', {
        requestedCount: cookiesToSet.length,
        setCount,
        removeCount,
        verifierCount: cookiesToSet.filter(cookie =>
          cookie.name.includes('code-verifier')
        ).length,
        sessionCount: cookiesToSet.filter(cookie =>
          cookie.name.includes('auth-token')
        ).length,
      });
    },
  };
}

function toElectronCookie(
  origin: string,
  name: string,
  value: string,
  options: CookieOptions
): CookiesSetDetails {
  return {
    url: origin,
    name,
    value,
    path: options.path,
    secure: options.secure,
    httpOnly: options.httpOnly,
    ...(typeof options.maxAge === 'number'
      ? { expirationDate: Date.now() / 1_000 + options.maxAge }
      : {}),
    ...(electronSameSite(options.sameSite)
      ? { sameSite: electronSameSite(options.sameSite) }
      : {}),
  };
}

function electronSameSite(
  sameSite: CookieOptions['sameSite']
): CookiesSetDetails['sameSite'] | undefined {
  if (sameSite === true || sameSite === 'strict') return 'strict';
  if (sameSite === 'lax') return 'lax';
  if (sameSite === 'none') return 'no_restriction';
  return undefined;
}
