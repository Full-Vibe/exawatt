'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { useElectronAuth } from '@/hooks/use-electron-auth';
import { FORGOT_PASSWORD_PATH } from '@/components/auth/hosted-auth';
import {
  analyticsSurface,
  captureAnalyticsEvent,
  type SignInFailure,
} from '@/lib/analytics';

/**
 * ENG-030 OS1.2. The audit that opened this work could not answer "did the
 * invited user ever try to sign in, and did it work?" — this is the event
 * that answers it. Only the closed enums cross the boundary; the provider's
 * message text never does.
 */
function signInFailureKind(message: string): SignInFailure {
  const text = message.toLowerCase();
  if (text.includes('invalid login') || text.includes('invalid credentials'))
    return 'invalid_credentials';
  if (text.includes('not configured')) return 'not_configured';
  if (text.includes('fetch') || text.includes('network')) return 'network';
  return 'provider_error';
}

export default function SignInPage() {
  return (
    // the page is client-rendered anyway; the fallback owns the same opaque
    // ground so the prerendered shell never flashes a different surface
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const searchParams = useSearchParams();
  // ENG-030 OS0.3: /auth/callback reports a failed exchange here instead of
  // dropping the operator on a signed-out /workspace with no explanation.
  const callbackError = searchParams.get('error');
  // a new attempt supersedes the previous callback's verdict
  const [callbackErrorStale, setCallbackErrorStale] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();
  const { signInWithGoogle } = useElectronAuth(supabase, {
    onError: setError,
    onLoadingChange: setLoading,
  });
  const visibleError = error ?? (callbackErrorStale ? null : callbackError);

  // OS0.3 routes a failed code exchange here. That is the one sign-in
  // outcome no client-side handler can observe, so report it once on arrival
  // — the reason string itself never leaves; only the closed enum does.
  const reportedCallbackFailure = useRef(false);
  useEffect(() => {
    if (!callbackError || reportedCallbackFailure.current) return;
    reportedCallbackFailure.current = true;
    captureAnalyticsEvent({
      name: 'sign_in_attempted',
      surface: analyticsSurface(),
      method: 'unknown',
      outcome: 'failed',
      failure: 'callback_exchange',
    });
  }, [callbackError]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCallbackErrorStale(true);
    captureAnalyticsEvent({
      name: 'sign_in_attempted',
      surface: analyticsSurface(),
      method: 'password',
      outcome: 'started',
      failure: null,
    });

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      captureAnalyticsEvent({
        name: 'sign_in_attempted',
        surface: analyticsSurface(),
        method: 'password',
        outcome: 'failed',
        failure: signInFailureKind(error.message),
      });
      setError(error.message);
      setLoading(false);
    } else {
      captureAnalyticsEvent({
        name: 'sign_in_attempted',
        surface: analyticsSurface(),
        method: 'password',
        outcome: 'succeeded',
        failure: null,
      });
      router.push('/workspace');
      router.refresh();
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    setCallbackErrorStale(true);

    captureAnalyticsEvent({
      name: 'sign_in_attempted',
      surface: analyticsSurface(),
      method: 'google',
      outcome: 'started',
      failure: null,
    });

    try {
      await signInWithGoogle();
      // Google does not resolve to a session here — the system browser and
      // the deep link finish it, so 'started' is the last honest word this
      // path can say. The callback route reports the outcome.
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Google sign-in failed';
      captureAnalyticsEvent({
        name: 'sign_in_attempted',
        surface: analyticsSurface(),
        method: 'google',
        outcome: 'failed',
        failure: signInFailureKind(message),
      });
      setError(message);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign In to Exawatt</CardTitle>
          <CardDescription>
            Enter your credentials to access your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleEmailSignIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="password">Password</Label>
                <Link
                  href={FORGOT_PASSWORD_PATH}
                  data-forgot-password
                  className="text-chrome-label text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            {visibleError && (
              <div
                role="alert"
                data-sign-in-error
                className="text-sm text-destructive"
              >
                {visibleError}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            Google
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link
              href="/sign-up"
              className="cursor-pointer underline hover:text-primary"
            >
              Sign up
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
