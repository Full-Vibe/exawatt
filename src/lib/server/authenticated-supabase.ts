import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolvedDistribution } from '@/lib/distribution/resolved';

export async function authenticatedSupabase(
  token: string
): Promise<SupabaseClient | null> {
  const account = resolvedDistribution().account;
  if (!account) return null;
  const supabase = createClient(account.supabaseUrl, account.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }),
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  return user ? supabase : null;
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}
