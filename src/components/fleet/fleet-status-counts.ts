import type { ExawattAgent } from '@exawatt/core';
import {
  workStateReading,
  type StatusLightReading,
} from '@/components/status-light';

interface FleetStatusCounts {
  /** One tally per reading. `active` includes `delegated`. */
  readings: Record<StatusLightReading, number>;
  /** Delegated children the sources report, all counted as Working. */
  delegated: number;
}

/**
 * The fleet headcount the counts bar shows, in the board's vocabulary.
 *
 * Counted by READING. An Agent whose source reported no work state has its
 * own tally, so the Idle figure only counts Agents somebody reported as idle.
 * A stopped Session still counts by its last reading, which the board draws
 * inside the stopped outline.
 *
 * Delegated children count as Working (BUG-225). The board lights every
 * child the source reports with the Active mark, or folds the ones past the
 * satellite cap into its "+N" lobe, so a Working total that left them out
 * disagreed with the board by exactly the delegated team. This reads the
 * ENG-023 census as the board does: a reported child is running; a source
 * that reports no delegation adds nothing.
 */
export function fleetStatusCounts(
  agents: readonly ExawattAgent[]
): FleetStatusCounts {
  const readings: Record<StatusLightReading, number> = {
    active: 0,
    'needs-you': 0,
    fault: 0,
    result: 0,
    off: 0,
    unreported: 0,
  };
  let delegated = 0;
  for (const agent of agents) {
    readings[workStateReading(agent.status)] += 1;
    delegated += agent.delegation?.children.length ?? 0;
  }
  readings.active += delegated;
  return { readings, delegated };
}
