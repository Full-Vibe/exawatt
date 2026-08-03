'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// The legacy Supabase demo-project CRUD that lived here retired with the
// /fleet · /dashboard · /board demo trio (decision 0023). ENG-027's Demo
// Workspace supersedes that machinery; only the auth verb remains.

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
}
