import Link from 'next/link';
import { resolvedDistribution } from '@/lib/distribution/resolved';

/**
 * Decision `0053`'s 2026-10-15 amendment: a person who signs in reads, at
 * that moment, that their in-app activity is recorded to their account
 * (ENG-047 F5). Shown only where the build carries analytics; signing in
 * stays optional, and the Product analytics switch turns this off too.
 */
export function AccountActivityNotice() {
  const distribution = resolvedDistribution();
  if (!distribution.analytics) return null;
  return (
    <p
      data-account-activity-notice
      className="mt-4 text-xs leading-relaxed text-muted-foreground"
    >
      Signed in, the app records your activity to your account: Projects you
      open, and Agents you start, direct and finish, with the engine and where
      each ran. Never a prompt, output, file name or path. Product analytics in
      Settings turns it off.{' '}
      <Link href="/privacy" className="underline hover:text-foreground">
        Privacy
      </Link>
    </p>
  );
}
