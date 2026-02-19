import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-[calc(100vh-theme(spacing.12))] items-center justify-center bg-background">
      <main className="flex flex-col items-center gap-8 text-center px-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Exawatt
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Mission control for your AI agents. Monitor, manage, and unblock your fleet of autonomous workers.
        </p>
        <div className="flex gap-4">
          {user ? (
            <Button asChild>
              <Link href="/dashboard">Go to Lattice</Link>
            </Button>
          ) : (
            <>
              <Button asChild>
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/sign-up">Sign Up</Link>
              </Button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
