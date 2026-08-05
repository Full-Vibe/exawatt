import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { OperatorAvatar } from '@/components/operator-stats/avatar';
import {
  formatAgentHours,
  formatAgentHoursLong,
  formatDuration,
  formatTokens,
} from '@/components/operator-stats/format';
import { ShareButton } from '@/components/operator-stats/share-button';
import styles from '@/components/operator-stats/operator-stats.module.css';
import { readRunReceipt } from '@/lib/operator-stats/public';

export const dynamic = 'force-dynamic';

const getRun = cache(readRunReceipt);
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{12,80}$/;

interface RunPageProps {
  params: Promise<{ id: string }>;
}

function cleanId(value: string) {
  const id = decodeURIComponent(value);
  return PUBLIC_ID_PATTERN.test(id) ? id : null;
}

export async function generateMetadata({
  params,
}: RunPageProps): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = cleanId(rawId);
  if (!id) return { title: 'Run not found' };
  const run = await getRun(id);
  if (!run) return { title: 'Run not found' };
  const duration = formatDuration(run.longestHandsOffMs);
  const description = `${duration} without needing @${run.handle}. Peak fleet ${run.peakActiveMembers} · ${formatAgentHoursLong(run.agentMs)} under command.`;
  return {
    title: `${duration} hands-off · @${run.handle}`,
    description,
    openGraph: {
      title: `${duration} without needing @${run.handle}`,
      description,
      type: 'article',
      images: run.avatarUrl ? [run.avatarUrl] : undefined,
    },
    twitter: {
      card: run.avatarUrl ? 'summary_large_image' : 'summary',
      title: `${duration} without needing @${run.handle}`,
      description,
      images: run.avatarUrl ? [run.avatarUrl] : undefined,
    },
  };
}

export default async function RunPage({ params }: RunPageProps) {
  const { id: rawId } = await params;
  const id = cleanId(rawId);
  if (!id) notFound();
  const run = await getRun(id);
  if (!run) notFound();

  const handsOff = formatDuration(run.longestHandsOffMs);
  const operatorHref = `/operator/${encodeURIComponent(run.handle)}`;

  return (
    <main className={styles.surface}>
      <div className={`${styles.shell} ${styles.receipt}`}>
        <header className={styles.profileHeader}>
          <OperatorAvatar src={run.avatarUrl} name={run.displayName} large />
          <div>
            <p className={styles.eyebrow}>Agentmaxxing run</p>
            <h1 className={styles.profileName}>{run.displayName}</h1>
            <Link href={operatorHref} className={styles.profileHandle}>
              @{run.handle}
            </Link>
          </div>
        </header>

        <section className={styles.receiptHero}>
          <span className={styles.proofLabel}>Useful work continued</span>
          <strong className={styles.receiptValue}>{handsOff}</strong>
          <p className={styles.lede}>without needing @{run.handle}</p>
        </section>

        <div className={styles.recordRail} aria-label="Run proof">
          <div className={styles.record}>
            <span className={styles.proofLabel}>Peak fleet size</span>
            <strong className={styles.recordValue}>
              {run.peakActiveMembers}
            </strong>
          </div>
          <div className={styles.record}>
            <span className={styles.proofLabel}>Agent hours</span>
            <strong className={styles.recordValue}>
              {formatAgentHours(run.agentMs)}
            </strong>
          </div>
          <div className={styles.record}>
            <span className={styles.proofLabel}>Elapsed</span>
            <strong className={styles.recordValue}>
              {formatDuration(run.elapsedMs)}
            </strong>
          </div>
          <div className={styles.record}>
            <span className={styles.proofLabel}>Tokens used</span>
            <strong className={styles.recordValue}>
              {formatTokens(run.normalizedTokens)}
            </strong>
          </div>
        </div>

        <div className={styles.receiptActions}>
          <p className={styles.proofLine}>
            <span>
              Recorded by Exawatt ·{' '}
              {run.assurance.join(' + ') || 'assurance unavailable'}
            </span>
            <span>
              {run.interventionCount === null
                ? 'interventions unavailable'
                : `${run.interventionCount} interventions`}
            </span>
            <span>{formatDuration(run.activeMs)} active</span>
            <span>{run.sources.join(' + ') || 'source unavailable'}</span>
            {run.outcome !== 'unknown' ? <span>{run.outcome}</span> : null}
          </p>
          <ShareButton label={`${handsOff} hands-off by @${run.handle}`} />
        </div>
      </div>
    </main>
  );
}
