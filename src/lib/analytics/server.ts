/**
 * ENG-047 — analytics the website's server records itself.
 *
 * One event today: `download_requested`, when `/download/artifact` hands over
 * a build. It is keyed by the visitor's anonymous web id, which the download
 * page adds to the artifact link only while analytics are on in that browser,
 * so an opted-out visitor (whose choice lives in their own browser) is never
 * counted, and nothing here mints an id for anyone. Same gate, allowlist and
 * ingest endpoint as every other event; a community build sends nothing.
 */

import type { DistributionContractV2 } from '@exawatt/core/distribution';
import { isAnalyticsId } from '@exawatt/core/desktop-bridge';
import { resolveDistributionAnalyticsDecision } from './config';
import type { AnalyticsEvent } from './events';
import { INGEST_LIBS, ingestRecordFor, sendToIngest } from './ingest';

export async function captureServerEvent(
  event: AnalyticsEvent,
  visitorId: unknown,
  context: {
    distribution: DistributionContractV2;
    nodeEnv: string | undefined;
    send?: typeof sendToIngest;
  }
): Promise<boolean> {
  const decision = resolveDistributionAnalyticsDecision(
    context.distribution,
    { optedOut: false },
    context.nodeEnv
  );
  if (!decision.enabled || !isAnalyticsId(visitorId)) return false;
  // Anonymous like the browser stream it joins: no person profile.
  const record = ingestRecordFor(event, visitorId, {
    personless: true,
    lib: INGEST_LIBS.server,
  });
  if (!record) return false;
  return (context.send ?? sendToIngest)(
    { apiHost: decision.apiHost, key: decision.key },
    [record]
  );
}
