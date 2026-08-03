import { createClient } from '@supabase/supabase-js';
import type { LeaderboardAxis, LeaderboardWindow } from '@exawatt/core';

export interface PublicLeaderboardRow {
  rank: number;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  value: number;
  agent_ms: number;
  longest_hands_off_ms: number;
  peak_fleet: number;
  normalized_tokens: number;
}

export interface PublicOperatorDay {
  localDate: string;
  agentMs: number;
  runCount: number;
  peakFleet: number;
  longestHandsOffMs: number;
  rawTokens: number;
  normalizedTokens: number;
}

export interface PublicOperatorRun {
  publicId: string;
  localDate: string;
  elapsedMs: number;
  activeMs: number;
  longestHandsOffMs: number;
  interventionCount: number | null;
  peakActiveMembers: number;
  agentMs: number;
  rawTokens: number;
  normalizedTokens: number;
  sources: string[];
  assurance: string[];
  outcome: string;
}

export interface PublicOperatorProfile {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  links: string[];
  identityProvider: string;
  joinedAt: string;
  days: PublicOperatorDay[];
  runs: PublicOperatorRun[];
}

export interface PublicRunReceipt extends PublicOperatorRun {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }),
    },
  });
}

export async function readLeaderboard(
  metric: LeaderboardAxis,
  window: LeaderboardWindow
): Promise<PublicLeaderboardRow[]> {
  const client = publicClient();
  if (!client) return [];
  const { data, error } = await client.rpc('get_operator_leaderboard', {
    metric,
    ranking_window: window,
  });
  if (error) throw error;
  return (data ?? []) as PublicLeaderboardRow[];
}

export async function readOperatorProfile(
  handle: string
): Promise<PublicOperatorProfile | null> {
  const client = publicClient();
  if (!client) return null;
  const { data, error } = await client.rpc('get_public_operator_profile', {
    profile_handle: handle,
  });
  if (error) throw error;
  return (data as PublicOperatorProfile | null) ?? null;
}

export async function readRunReceipt(
  publicId: string
): Promise<PublicRunReceipt | null> {
  const client = publicClient();
  if (!client) return null;
  const { data, error } = await client.rpc('get_public_operator_run', {
    run_id: publicId,
  });
  if (error) throw error;
  return (data as PublicRunReceipt | null) ?? null;
}
