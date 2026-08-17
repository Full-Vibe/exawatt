'use server';

import { accountServerClient } from '@/lib/supabase/server';
import type { ShortcutOverride } from '@/types/shortcuts';

/**
 * The ACCOUNT arm of keyboard overrides (BUG-044).
 *
 * Overrides live on the device — `src/lib/shortcuts/override-store.ts` owns
 * that, and it is what makes a rebind stick. These actions only sync the
 * device copy to an account, so every one of them has to be able to answer
 * "this distribution has no account service" without failing.
 *
 * `unavailable` is deliberately distinct from an empty array. Returning `[]`
 * for "there is no account here" is what silently discarded saved overrides:
 * the caller could not tell "you have no overrides" from "I could not read
 * them", and adopted the empty answer over the operator's real bindings.
 */
export type RemoteShortcutOverrides =
  | { status: 'unavailable' }
  | { status: 'signed-out' }
  | { status: 'error' }
  | { status: 'loaded'; overrides: ShortcutOverride[] };

export type ShortcutSyncOutcome =
  | { status: 'unavailable' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'synced' };

export async function getKeyboardShortcuts(): Promise<RemoteShortcutOverrides> {
  const supabase = await accountServerClient();
  if (!supabase) return { status: 'unavailable' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'signed-out' };

  const { data, error } = await supabase
    .from('user_preferences')
    .select('keyboard_shortcuts')
    .eq('user_id', user.id)
    .single();

  if (error) {
    // No row yet is the ordinary first-sync state, not a failure.
    if (error.code === 'PGRST116') return { status: 'loaded', overrides: [] };
    console.error('Error fetching keyboard shortcuts:', error);
    return { status: 'error' };
  }

  return {
    status: 'loaded',
    overrides: (data?.keyboard_shortcuts as ShortcutOverride[]) || [],
  };
}

export async function updateKeyboardShortcuts(
  overrides: ShortcutOverride[]
): Promise<ShortcutSyncOutcome> {
  const supabase = await accountServerClient();
  if (!supabase) return { status: 'unavailable' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'signed-out' };

  const { error } = await supabase.from('user_preferences').upsert(
    {
      user_id: user.id,
      keyboard_shortcuts: overrides,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    console.error('Error updating keyboard shortcuts:', error);
    return { status: 'error', message: error.message };
  }

  return { status: 'synced' };
}

export async function resetKeyboardShortcuts(): Promise<ShortcutSyncOutcome> {
  const supabase = await accountServerClient();
  if (!supabase) return { status: 'unavailable' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'signed-out' };

  const { error } = await supabase
    .from('user_preferences')
    .update({
      keyboard_shortcuts: [],
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);

  if (error) {
    console.error('Error resetting keyboard shortcuts:', error);
    return { status: 'error', message: error.message };
  }

  return { status: 'synced' };
}
