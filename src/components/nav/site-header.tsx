import { createClient } from '@/lib/supabase/server';
import { SiteHeaderNav } from './site-header-nav';

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <SiteHeaderNav
      isAuthenticated={!!user}
      userName={user?.user_metadata?.full_name ?? undefined}
      userEmail={user?.email ?? undefined}
    />
  );
}
