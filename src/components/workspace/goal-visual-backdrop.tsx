'use client';

import { useState } from 'react';
import type { GoalVisual } from '@/types/electron';
import styles from './goal-visual-backdrop.module.css';
import { withThemeAlpha } from './workspace-theme';

/**
 * Source-agnostic Team-tile projection. Live Mode may fill `dataUrl` through
 * its private generation/cache boundary; Demo Mode may provide an authored
 * raster fixture. The renderer never needs a provider URL or credential.
 */
export type GoalVisualReadout = GoalVisual;

interface GoalVisualBackdropProps {
  visual?: GoalVisualReadout | null;
  /** Durable fallback identity used before the Objective Engine accepts a Why. */
  fallbackIdentity: string;
  projectColor: string;
}

/** Small stable hash: visual placement must survive restarts and tab movement. */
export function goalVisualHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function goalVisualFallbackBackground(
  identity: string,
  projectColor: string
): string {
  const hash = goalVisualHash(identity);
  const x = 20 + (hash % 61);
  const y = 14 + ((hash >>> 7) % 55);
  const counterX = 18 + ((hash >>> 13) % 65);
  const angle = 118 + ((hash >>> 19) % 125);
  return [
    `radial-gradient(92% 74% at ${x}% ${y}%, ${withThemeAlpha(projectColor, 0.26)}, transparent 68%)`,
    `radial-gradient(64% 88% at ${counterX}% 102%, ${withThemeAlpha(projectColor, 0.13)}, transparent 72%)`,
    `linear-gradient(${angle}deg, ${withThemeAlpha(projectColor, 0.09)}, transparent 62%)`,
  ].join(', ');
}

function rasterDataUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^data:image\/(?:avif|jpeg|png|webp);base64,/i.test(value)
    ? value
    : null;
}

function ReadyGoalVisualImage({
  dataUrl,
  position,
}: {
  dataUrl: string;
  position: string;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    // Deliberately decorative and already private/cached at this boundary;
    // next/image optimization would turn a local data URL back into IO.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      draggable={false}
      data-goal-visual-image
      className={`${styles.image}${loaded ? ` ${styles.imageReady}` : ''}`}
      src={dataUrl}
      style={{ objectPosition: position }}
      onLoad={() => setLoaded(true)}
    />
  );
}

/**
 * Quiet, non-semantic identity atmosphere for a Team tile. It intentionally
 * owns no status marks: Project paint supplies the fallback hue while the
 * existing D40 glyphs remain the sole operational channel above the scrim.
 */
export function GoalVisualBackdrop({
  visual,
  fallbackIdentity,
  projectColor,
}: GoalVisualBackdropProps) {
  const identity = visual?.identityKey || fallbackIdentity;
  const dataUrl =
    visual?.state === 'ready' ? rasterDataUrl(visual.dataUrl) : null;
  const positionHash = goalVisualHash(identity);
  const position = `${46 + (positionHash % 9)}% ${46 + ((positionHash >>> 9) % 9)}%`;

  return (
    <span
      aria-hidden="true"
      data-goal-visual-backdrop
      data-goal-visual-identity={identity}
      data-goal-visual-revision={visual?.revision ?? 0}
      data-goal-visual-state={visual?.state ?? 'fallback'}
      className={styles.root}
    >
      <span
        className={styles.fallback}
        style={{
          background: goalVisualFallbackBackground(identity, projectColor),
        }}
      />
      {dataUrl && (
        <ReadyGoalVisualImage
          key={`${identity}:${visual?.revision ?? 0}`}
          dataUrl={dataUrl}
          position={position}
        />
      )}
      <span className={styles.scrim} />
    </span>
  );
}
