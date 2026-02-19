import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Zap, LayoutDashboard } from 'lucide-react';

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="absolute top-0 left-0 right-0 z-40 flex h-12 items-center justify-between px-4 md:px-6">
      {/* Left: Logo → Home */}
      <Button variant="ghost" size="sm" asChild>
        <Link href="/" className="gap-2 font-semibold">
          <Zap className="h-4 w-4" />
          Exawatt
        </Link>
      </Button>

      {/* Right: Auth-dependent links */}
      <div className="flex items-center gap-1">
        {user ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Lattice
            </Link>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
