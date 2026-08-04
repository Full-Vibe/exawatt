import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ActivityGraph } from '@/components/operator-stats/activity-graph';
import { OperatorAvatar } from '@/components/operator-stats/avatar';
import {
  formatAgentHours,
  formatDuration,
  formatTokens,
} from '@/components/operator-stats/format';
import styles from '@/components/operator-stats/operator-stats.module.css';
import { readOperatorProfile } from '@/lib/operator-stats/public';

export const dynamic = 'force-dynamic';

const getProfile = cache(readOperatorProfile);
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

interface OperatorPageProps {
  params: Promise<{ handle: string }>;
}

function cleanHandle(value: string) {
  const handle = decodeURIComponent(value).toLowerCase();
  return HANDLE_PATTERN.test(handle) ? handle : null;
}

export async function generateMetadata({
  params,
}: OperatorPageProps): Promise<Metadata> {
  const { handle: rawHandle } = await params;
  const handle = cleanHandle(rawHandle);
  if (!handle) return { title: 'Operator not found' };
  const profile = await getProfile(handle);
  if (!profile) return { title: `@${handle}` };
  const description = `${formatAgentHours(
    profile.days.reduce((total, day) => total + day.agentMs, 0)
  )} under command. See @${profile.handle}'s public AI agent operator record.`;
  return {
    title: `@${profile.handle} · Agentmaxxing`,
    description,
    openGraph: {
      title: `${profile.displayName} (@${profile.handle}) — Agentmaxxing`,
      description,
      type: 'profile',
      images: profile.avatarUrl ? [profile.avatarUrl] : undefined,
    },
    twitter: {
      card: profile.avatarUrl ? 'summary_large_image' : 'summary',
      title: `${profile.displayName} (@${profile.handle})`,
      description,
      images: profile.avatarUrl ? [profile.avatarUrl] : undefined,
    },
  };
}

export default async function OperatorPage({ params }: OperatorPageProps) {
  const { handle: rawHandle } = await params;
  const handle = cleanHandle(rawHandle);
  if (!handle) notFound();
  const profile = await getProfile(handle);
  if (!profile) notFound();

  const records = {
    agentMs: profile.days.reduce((total, day) => total + day.agentMs, 0),
    enduranceMs: Math.max(0, ...profile.days.map(day => day.longestHandsOffMs)),
    peakFleet: Math.max(0, ...profile.days.map(day => day.peakFleet)),
    tokens: profile.days.reduce(
      (total, day) => total + day.normalizedTokens,
      0
    ),
  };
  const publicLinks = profile.links.filter(link => link.startsWith('https://'));

  return (
    <main className={styles.surface}>
      <div className={styles.shell}>
        <header className={styles.profileHeader}>
          <OperatorAvatar
            src={profile.avatarUrl}
            name={profile.displayName}
            large
          />
          <div>
            <p className={styles.eyebrow}>Public operator</p>
            <h1 className={styles.profileName}>{profile.displayName}</h1>
            <p className={styles.profileHandle}>
              @{profile.handle}
              {publicLinks.map(link => (
                <span key={link}>
                  {' · '}
                  <a href={link} target="_blank" rel="noreferrer">
                    {profile.identityProvider}
                  </a>
                </span>
              ))}
            </p>
          </div>
        </header>

        <div className={styles.recordRail} aria-label="All-time records">
          <div className={styles.record}>
            <span className={styles.proofLabel}>Command</span>
            <strong className={styles.recordValue}>
              {formatAgentHours(records.agentMs)}
            </strong>
          </div>
          <div className={styles.record}>
            <span className={styles.proofLabel}>Endurance</span>
            <strong className={styles.recordValue}>
              {formatDuration(records.enduranceMs)}
            </strong>
          </div>
          <div className={styles.record}>
            <span className={styles.proofLabel}>Peak fleet</span>
            <strong className={styles.recordValue}>{records.peakFleet}</strong>
          </div>
          <div className={styles.record}>
            <span className={styles.proofLabel}>Tokens</span>
            <strong className={styles.recordValue}>
              {formatTokens(records.tokens)}
            </strong>
          </div>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Command activity</h2>
            <span className={styles.meta}>24 agent-hours saturates a day</span>
          </div>
          <ActivityGraph days={profile.days} />
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recent runs</h2>
            <Link href="/agentmaxxing" className={styles.control}>
              Global leaderboard
            </Link>
          </div>
          {profile.runs.length === 0 ? (
            <p className={styles.empty}>No public Runs yet.</p>
          ) : (
            <ol className={styles.runList}>
              {profile.runs.slice(0, 20).map(run => (
                <li key={run.publicId}>
                  <Link
                    href={`/run/${encodeURIComponent(run.publicId)}`}
                    className={styles.runLink}
                  >
                    <span>
                      <span className={styles.handle}>{run.localDate}</span>
                      {run.outcome !== 'unknown' ? (
                        <span className={styles.displayName}>
                          {run.outcome}
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.metricPrimary}>
                      {formatDuration(run.longestHandsOffMs)} hands-off
                    </span>
                    <span className={styles.metric}>
                      Fleet {run.peakActiveMembers}
                    </span>
                    <span className={styles.metric}>
                      {formatAgentHours(run.agentMs)}
                    </span>
                    <span className={styles.metric}>
                      {formatTokens(run.normalizedTokens)} tokens
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
