import type { CookieMethodsBrowser, CookieOptions } from '@supabase/ssr';
import type { Cookies, CookiesSetDetails } from 'electron';

export function createElectronAuthCookies(
  cookies: Pick<Cookies, 'get' | 'set' | 'remove'>,
  rendererOrigin: string
): CookieMethodsBrowser {
  const origin = new URL(rendererOrigin).origin;

  return {
    getAll: async () =>
      (await cookies.get({ url: origin })).map(cookie => ({
        name: cookie.name,
        value: cookie.value,
      })),
    setAll: async cookiesToSet => {
      for (const { name, value, options } of cookiesToSet) {
        if (
          !value ||
          (typeof options.maxAge === 'number' && options.maxAge <= 0)
        ) {
          await cookies.remove(origin, name);
          continue;
        }

        await cookies.set(toElectronCookie(origin, name, value, options));
      }
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
