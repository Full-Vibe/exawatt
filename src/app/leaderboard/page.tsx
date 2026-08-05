import type { Metadata } from 'next';
import Link from 'next/link';
import type { LeaderboardAxis, LeaderboardWindow } from '@exawatt/core';
import { OperatorAvatar } from '@/components/operator-stats/avatar';
import {
  formatAgentHours,
  formatDuration,
  formatTokens,
} from '@/components/operator-stats/format';
import { PublishPanel } from '@/components/operator-stats/publish-panel';
import styles from '@/components/operator-stats/operator-stats.module.css';
import { readLeaderboard } from '@/lib/operator-stats/public';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description:
    'Agentmaxxing: the global high-score table for people who command fleets of AI agents.',
  openGraph: {
    title: 'Leaderboard — Exawatt',
    description:
      'See who commands the most machine intelligence, stays hands-off longest, and runs the largest fleet.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Leaderboard — Exawatt',
    description: 'The global high-score table for AI agent operators.',
  },
};

// Ids are the `?metric=` value and the RPC argument, so they say what the
// column says. Labels are written for a first-time visitor who has never seen
// Exawatt — the previous set ("Command: 51 h") read as nonsense to the
// operator and to a cold reviewer (FIX-003, ENG-035).
const AXES: ReadonlyArray<{
  id: LeaderboardAxis;
  label: string;
  description: string;
}> = [
  {
    id: 'agent-hours',
    label: 'Agent hours',
    description: 'Hours of agent work run under your command.',
  },
  {
    id: 'hands-off',
    label: 'Longest hands-off',
    description: 'Longest stretch your agents ran without needing you.',
  },
  {
    id: 'peak-fleet',
    label: 'Peak fleet size',
    description: 'Most agents running at the same time.',
  },
  {
    id: 'tokens',
    label: 'Tokens used',
    description: 'Tokens your agents used, normalized across models.',
  },
];

const DEFAULT_AXIS: LeaderboardAxis = 'agent-hours';

const WINDOWS: ReadonlyArray<{ id: LeaderboardWindow; label: string }> = [
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All time' },
];

function axisFrom(value: string | string[] | undefined): LeaderboardAxis {
  const candidate = Array.isArray(value) ? value[0] : value;
  return AXES.some(axis => axis.id === candidate)
    ? (candidate as LeaderboardAxis)
    : DEFAULT_AXIS;
}

function windowFrom(value: string | string[] | undefined): LeaderboardWindow {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === 'all' ? 'all' : 'week';
}

function metricHref(metric: LeaderboardAxis, window: LeaderboardWindow) {
  const params = new URLSearchParams({ metric, window });
  return `/leaderboard?${params.toString()}`;
}

function formatMetric(metric: LeaderboardAxis, value: number) {
  switch (metric) {
    case 'agent-hours':
      return formatAgentHours(value);
    case 'hands-off':
      return formatDuration(value);
    case 'peak-fleet':
      return String(value);
    case 'tokens':
      return formatTokens(value);
  }
}

interface LeaderboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LeaderboardPage({
  searchParams,
}: LeaderboardPageProps) {
  const query = await searchParams;
  const metric = axisFrom(query.metric);
  const window = windowFrom(query.window);
  let rows: Awaited<ReturnType<typeof readLeaderboard>> = [];
  let unavailable = false;
  try {
    rows = await readLeaderboard(metric, window);
  } catch {
    unavailable = true;
  }
  const activeAxis = AXES.find(axis => axis.id === metric)!;

  return (
    <main className={styles.surface}>
      <div className={styles.shell}>
        <header className={styles.masthead}>
          <div>
            <p className={styles.eyebrow}>Global operator rankings</p>
            <h1 className={styles.title}>Command more.</h1>
          </div>
          <p className={styles.lede}>
            Agentmaxxing is the high-score table for people who command fleets
            of AI agents. {activeAxis.description}
          </p>
        </header>

        <nav className={styles.controls} aria-label="Leaderboard rankings">
          <div className={styles.controlGroup} aria-label="Ranking metric">
            {AXES.map(axis => (
              <Link
                key={axis.id}
                href={metricHref(axis.id, window)}
                className={`${styles.control} ${
                  metric === axis.id ? styles.controlActive : ''
                }`}
                aria-current={metric === axis.id ? 'page' : undefined}
                title={axis.description}
              >
                {axis.label}
              </Link>
            ))}
          </div>
          <div className={styles.controlGroup} aria-label="Ranking period">
            {WINDOWS.map(candidate => (
              <Link
                key={candidate.id}
                href={metricHref(metric, candidate.id)}
                className={`${styles.control} ${
                  window === candidate.id ? styles.controlActive : ''
                }`}
                aria-current={window === candidate.id ? 'page' : undefined}
              >
                {candidate.label}
              </Link>
            ))}
          </div>
        </nav>

        {unavailable ? (
          <div className={styles.empty}>
            Rankings are temporarily unavailable. Your local agent work is
            unaffected.
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            The board is open. The first operator to publish takes #1.
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Operator</th>
                {AXES.map(axis => (
                  <th key={axis.id} scope="col">
                    {axis.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.handle}>
                  <td
                    className={`${styles.rank} ${
                      row.rank === 1 ? styles.rankFirst : ''
                    }`}
                  >
                    #{row.rank}
                  </td>
                  <td>
                    <Link
                      href={`/operator/${encodeURIComponent(row.handle)}`}
                      className={styles.operatorLink}
                    >
                      <OperatorAvatar
                        src={row.avatar_url}
                        name={row.display_name}
                      />
                      <span>
                        <span className={styles.handle}>@{row.handle}</span>
                        <span className={styles.displayName}>
                          {row.display_name}
                        </span>
                      </span>
                    </Link>
                  </td>
                  {AXES.map(axis => {
                    const value =
                      axis.id === 'agent-hours'
                        ? row.agent_ms
                        : axis.id === 'hands-off'
                          ? row.longest_hands_off_ms
                          : axis.id === 'peak-fleet'
                            ? row.peak_fleet
                            : row.normalized_tokens;
                    return (
                      <td
                        key={axis.id}
                        data-label={axis.label}
                        className={
                          metric === axis.id
                            ? styles.metricPrimary
                            : styles.metric
                        }
                      >
                        {formatMetric(axis.id, value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <PublishPanel />
      </div>
    </main>
  );
}
