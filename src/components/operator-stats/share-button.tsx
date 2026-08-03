'use client';

import { useState } from 'react';
import styles from './operator-stats.module.css';

export function ShareButton({ label }: { label: string }) {
  const [state, setState] = useState<'idle' | 'shared'>('idle');

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: label, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setState('shared');
    } catch {
      // A dismissed native share sheet is not an error state worth showing.
    }
  }

  return (
    <button type="button" className={styles.button} onClick={share}>
      {state === 'shared' ? 'Link copied' : 'Share this run'}
    </button>
  );
}
