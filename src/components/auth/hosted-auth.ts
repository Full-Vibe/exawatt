import type { DistributionContractV1 } from '@exawatt/core/distribution';

/**
 * Where a desktop operator has to finish an auth flow that leaves the app
 * (ENG-030 OS0.2).
 *
 * The packaged app serves its renderer from an ephemeral
 * `http://127.0.0.1:<port>` origin that does not survive a relaunch, and a
 * password-reset email is opened later, in the system browser, by a client
 * that holds none of the desktop renderer's PKCE state. So the reset is
 * requested and completed on the stable hosted origin, and the operator
 * returns to the desktop app to sign in with the new password.
 */
export const HOSTED_ORIGIN = 'https://www.exawatt.ai';

export const FORGOT_PASSWORD_PATH = '/auth/forgot-password';
export const UPDATE_PASSWORD_PATH = '/auth/update-password';

export const HOSTED_FORGOT_PASSWORD_URL = `${HOSTED_ORIGIN}${FORGOT_PASSWORD_PATH}`;

export interface HostedAuthTargets {
  forgotPasswordUrl: string;
  recoveryOrigin: string;
}

/** Nullable distribution-aware seam. WP2b migrates the legacy constant user. */
export function resolveHostedAuthTargets(
  distribution: DistributionContractV1
): HostedAuthTargets | null {
  const origin = distribution.account?.recoveryOrigin;
  if (!origin) return null;
  return {
    recoveryOrigin: origin,
    forgotPasswordUrl: `${origin}${FORGOT_PASSWORD_PATH}`,
  };
}

/** The landing the recovery email must return to: the shared callback route
 *  exchanges the recovery code, then hands off to the update form. */
export function passwordResetRedirect(origin: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(UPDATE_PASSWORD_PATH)}`;
}
