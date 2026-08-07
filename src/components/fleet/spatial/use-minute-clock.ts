'use client';

import { useEffect, useState } from 'react';

const MINUTE_MS = 60_000;

/**
 * A clock that ticks once a minute.
 *
 * Elapsed copy on the board is minute-granularity by contract (ENG-023 D3c
 * keeps second-granularity timers out of Fleet), so a minute is exactly the
 * resolution that needs a re-render. Reading `Date.now()` during render is the
 * alternative, and it is worse twice over: the value is not deterministic under
 * test, and it only refreshes when something else happens to re-render, so
 * "12m" can sit on screen for an hour.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Align the first tick to the next minute boundary so every elapsed label
    // on screen advances together instead of drifting per mount.
    let interval: number | undefined;
    const align = window.setTimeout(
      () => {
        setNow(Date.now());
        interval = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
      },
      MINUTE_MS - (Date.now() % MINUTE_MS)
    );
    return () => {
      window.clearTimeout(align);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  return now;
}
