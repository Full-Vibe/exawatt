/**
 * The `app_launched` properties, resolved from what the renderer can see.
 *
 * Kept separate from `client.ts` so the mapping from Electron build info to
 * allowlisted enum members is testable without a PostHog instance, and so the
 * mapping is one obvious place to audit: build channel and platform go out,
 * nothing else does.
 */

import type {
  AnalyticsBuildDelivery,
  AnalyticsPlatform,
  AnalyticsSurface,
  AppLaunchedEvent,
} from './events';
import { PLATFORMS, sanitizeAppVersion } from './events';

export interface LaunchContextInput {
  isElectron: boolean;
  platform?: string | null;
  /** `ExawattBuildInfo['delivery']` — `signed` or `dogfood` in packaged apps. */
  delivery?: string | null;
  version?: string | null;
  signedIn: boolean;
}

function surfaceOf(isElectron: boolean): AnalyticsSurface {
  return isElectron ? 'desktop' : 'web';
}

function platformOf(
  isElectron: boolean,
  platform: string | null | undefined
): AnalyticsPlatform {
  if (!isElectron) return 'web';
  return (PLATFORMS as readonly string[]).includes(platform ?? '')
    ? (platform as AnalyticsPlatform)
    : 'unknown';
}

function deliveryOf(
  isElectron: boolean,
  delivery: string | null | undefined
): AnalyticsBuildDelivery {
  if (!isElectron) return 'hosted';
  if (delivery === 'signed' || delivery === 'dogfood') return delivery;
  return 'unknown';
}

/**
 * Whether an Exawatt account session exists — the boolean `signed_in`, and
 * nothing more. `@supabase/ssr` stores the session in `sb-<ref>-auth-token`
 * cookies (chunked as `.0`, `.1`). Presence is read; the value never is, and
 * no auth call is made, so startup analytics cannot disturb the session.
 */
const SUPABASE_AUTH_COOKIE = /(?:^|;\s*)sb-[a-z0-9-]+-auth-token(?:\.\d+)?=/i;

export function hasAccountSession(cookie: string | undefined | null): boolean {
  return typeof cookie === 'string' && SUPABASE_AUTH_COOKIE.test(cookie);
}

export function readLaunchContext(input: LaunchContextInput): AppLaunchedEvent {
  return {
    name: 'app_launched',
    surface: surfaceOf(input.isElectron),
    platform: platformOf(input.isElectron, input.platform),
    delivery: deliveryOf(input.isElectron, input.delivery),
    appVersion: sanitizeAppVersion(input.version),
    signedIn: input.signedIn === true,
  };
}
