'use server';

import { createClient } from '@/lib/supabase/server';
import type { ShortcutOverride } from '@/types/shortcuts';

export async function getKeyboardShortcuts(): Promise<ShortcutOverride[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from('user_preferences')
    .select('keyboard_shortcuts')
    .eq('user_id', user.id)
    .single();

  if (error) {
    // No preferences yet, return empty array
    if (error.code === 'PGRST116') {
      return [];
    }
    console.error('Error fetching keyboard shortcuts:', error);
    return [];
  }

  return (data?.keyboard_shortcuts as ShortcutOverride[]) || [];
}

export async function updateKeyboardShortcuts(
  overrides: ShortcutOverride[]
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        user_id: user.id,
        keyboard_shortcuts: overrides,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('Error updating keyboard shortcuts:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function resetKeyboardShortcuts(): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { error } = await supabase
    .from('user_preferences')
    .update({
      keyboard_shortcuts: [],
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);

  if (error) {
    console.error('Error resetting keyboard shortcuts:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}
