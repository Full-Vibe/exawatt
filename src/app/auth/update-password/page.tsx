'use client';

/**
 * Completes a password reset (ENG-030 OS0.2).
 *
 * `/auth/callback` has already exchanged the recovery code for a session by
 * the time this renders, so the only work left is writing the new password.
 * No session means the link was already used or has expired — say that
 * instead of showing a form that cannot succeed.
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
import { FORGOT_PASSWORD_PATH } from '@/components/auth/hosted-auth';

const MIN_PASSWORD_CHARS = 6;

type Stage = 'checking' | 'ready' | 'expired' | 'done';

export default function UpdatePasswordPage() {
  const [stage, setStage] = useState<Stage>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      setStage('expired');
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setStage(data.session ? 'ready' : 'expired');
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError('Those passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setStage('done');
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
          <CardTitle>
            {stage === 'done' ? 'Password updated' : 'New password'}
          </CardTitle>
          <CardDescription>
            {stage === 'expired'
              ? 'That reset link has expired or was already used.'
              : stage === 'done'
                ? 'Sign in with it anywhere Exawatt runs, including the desktop app.'
                : 'Set the password you will sign in with from now on.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stage === 'checking' && (
            <p role="status" className="text-sm text-muted-foreground">
              Checking the link…
            </p>
          )}
          {stage === 'expired' && (
            <Button asChild className="w-full">
              <Link href={FORGOT_PASSWORD_PATH}>Request a new link</Link>
            </Button>
          )}
          {stage === 'done' && (
            <Button asChild className="w-full">
              <Link href="/workspace">Continue</Link>
            </Button>
          )}
          {stage === 'ready' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  required
                  disabled={loading}
                  minLength={MIN_PASSWORD_CHARS}
                />
                <p className="text-xs text-muted-foreground">
                  Must be at least {MIN_PASSWORD_CHARS} characters
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmation">Confirm password</Label>
                <Input
                  id="confirmation"
                  type="password"
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  required
                  disabled={loading}
                  minLength={MIN_PASSWORD_CHARS}
                />
              </div>
              {error && (
                <div
                  role="alert"
                  data-update-password-error
                  className="text-sm text-destructive"
                >
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Saving…' : 'Save password'}
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
