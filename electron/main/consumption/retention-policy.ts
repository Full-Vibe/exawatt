/**
 * The one owner of the consumption sample horizon (BUG-141).
 *
 * The horizon is a function of the Operator-profile publication preference:
 * off means the 14-day default; on with a known first-consent anchor means
 * wide enough to cover everything since that anchor; on with the anchor still
 * unknown means the ceiling, because the renderer's first sync will recover
 * the hosted `joined_at` minutes after boot and may republish everything since
 * it. (Since BUG-164 a publication never covers dates this horizon pruned, so
 * a narrow horizon costs republishing reach, not hosted history.)
 *
 * It is a LIVE read rather than a boot-time value on purpose. `main.ts` used
 * to snapshot `resolveSampleHorizonMs(...)` once while constructing the
 * scanner; a v0.1.10 profile (`{ autoPublish: true }` with no `startedAt`,
 * a field added two days after that release) resolved to 14 days, the
 * hydrate pruned everything older, the first compaction rewrote the log
 * without it, and the same launch's sync published those 14 days over a
 * hosted history that had been months long. The scanner consults this
 * function at hydrate and again at the end of every pass, so the anchor the
 * sync writes is honoured by the next compaction without a relaunch.
 *
 * A failed settings read is not "not publishing": it resolves to the ceiling,
 * because pruning on a misread is the one outcome this module exists to
 * prevent, and retaining too much for one pass costs nothing.
 */
import {
  CONSUMPTION_SAMPLE_MAX_HORIZON_MS,
  resolveSampleHorizonMs,
  type ConsumptionRetentionAnchor,
} from '@exawatt/core';
import { loadSettings } from '../settings-store';

interface SampleRetentionPolicyOptions {
  /** The publication preference, read fresh on every call. */
  readProfile?: () => ConsumptionRetentionAnchor | undefined;
  now?: () => number;
}

/** Builds the live horizon read the scanner is constructed with. */
export function sampleRetentionPolicy(
  options: SampleRetentionPolicyOptions = {}
): () => number {
  const readProfile =
    options.readProfile ?? (() => loadSettings().operatorProfile);
  const now = options.now ?? Date.now;
  return () => {
    let profile: ConsumptionRetentionAnchor | undefined;
    try {
      profile = readProfile();
    } catch (error) {
      console.error(
        '[consumption] publication preference unreadable; retaining everything',
        error
      );
      return CONSUMPTION_SAMPLE_MAX_HORIZON_MS;
    }
    return resolveSampleHorizonMs(profile, now());
  };
}
