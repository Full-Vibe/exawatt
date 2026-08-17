'use server';

import { accountServerClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// The legacy Supabase demo-project CRUD that lived here retired with the
// /fleet · /dashboard · /board demo trio (decision 0023). ENG-027's Demo
// Workspace supersedes that machinery; only the auth verb remains.

/**
 * A distribution with no account service has no session to end, so this is a
 * no-op there rather than a 500 (BUG-044). The revalidate still runs: whatever
 * put the caller on this path expects the layout to re-render either way.
 */
export async function signOut() {
  const supabase = await accountServerClient();
  if (supabase) await supabase.auth.signOut();
  revalidatePath('/', 'layout');
}
