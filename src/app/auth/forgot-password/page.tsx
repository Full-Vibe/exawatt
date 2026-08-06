'use client';

/**
 * Password-reset request (ENG-030 OS0.2).
 *
 * Desktop and web take different routes to the same place. On the web the
 * form runs here: the browser that asks for the link is the browser that
 * opens it, so the PKCE verifier written by `@supabase/ssr` is still present
 * when `/auth/callback` exchanges the recovery code. In the packaged app it
 * is not — the renderer's origin is an ephemeral `127.0.0.1` port that dies
 * with the process, and the email opens in the system browser. So the desktop
 * hands the whole flow to that browser on the hosted origin, and the operator
 * comes back to sign in with the new password.
 */

import { useEffect, useState } from 'react';
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
import {
  HOSTED_FORGOT_PASSWORD_URL,
  passwordResetRedirect,
} from '@/components/auth/hosted-auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // detected post-mount for hydration safety, as the header chrome does
  const [inElectron, setInElectron] = useState(false);
  useEffect(() => setInElectron(!!window.electron?.isElectron), []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: passwordResetRedirect(window.location.origin),
      });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setSent(true);
    } catch (thrown) {
      setError(
        thrown instanceof Error
          ? thrown.message
          : 'Could not reach the authentication service.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
          <CardDescription>
            {inElectron
              ? 'Finish in your browser, then sign in here with the new password.'
              : 'We email a link that lets you set a new password.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inElectron ? (
            <Button
              type="button"
              className="w-full"
              data-open-hosted-reset
              onClick={() =>
                void window.electron?.pty?.openExternal(
                  HOSTED_FORGOT_PASSWORD_URL
                )
              }
            >
              Continue in browser
            </Button>
          ) : sent ? (
            <div
              role="status"
              data-reset-sent
              className="space-y-2 text-sm text-muted-foreground"
            >
              <p className="text-foreground">Check your email.</p>
              <p>
                If an account uses {email || 'that address'}, a reset link is on
                its way. The link expires in one hour.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              {error && (
                <div
                  role="alert"
                  data-reset-error
                  className="text-sm text-destructive"
                >
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          )}
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            <Link
              href="/sign-in"
              className="cursor-pointer underline hover:text-primary"
            >
              Back to sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
