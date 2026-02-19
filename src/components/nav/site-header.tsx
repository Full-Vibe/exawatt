import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Zap, LayoutDashboard } from 'lucide-react';

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="flex h-12 items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6">
      {/* Left: Logo → Home */}
      <Link
        href="/"
        className="flex items-center gap-2 text-sm font-semibold hover:opacity-80 transition-opacity"
      >
        <Zap className="h-4 w-4" />
        Exawatt
      </Link>

      {/* Right: Auth-dependent links */}
      <div className="flex items-center gap-3">
        {user ? (
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted active:bg-foreground/10 transition-colors"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Lattice
          </Link>
        ) : (
          <Link
            href="/sign-in"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted active:bg-foreground/10 transition-colors"
          >
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
