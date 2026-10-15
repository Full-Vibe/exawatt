/**
 * ENG-047 — the one sender that does not go through `posthog-js`.
 *
 * `posthog-js` keeps one distinct id per instance and refuses an alias when
 * person profiles are off, so three things post to the same configured
 * ingest endpoint directly, each with an explicit `distinct_id`:
 *
 *  - the server's `download_requested`, keyed by the visitor's web id;
 *  - the one web-to-app alias (`$create_alias`), from the installation id;
 *  - a signed-in account's activity stream, keyed by the account id.
 *
 * Same destination as the SDK (decision `0034`: the distribution's
 * `analytics.ingestOrigin`, Exawatt's own proxy officially), same
 * allowlist (`scrubEventProperties`), and only ever reached after
 * `resolveDistributionAnalyticsDecision` says analytics are on. Failure is
 * silent: analytics never propagate into product behavior.
 */

import { toAnalyticsPayload, type AnalyticsEvent } from './events';
import { scrubEventProperties } from './redact';

/**
 * Which direct sender a record came from, as PostHog's own `$lib` (SDK
 * metadata, never content). The dashboard reads the account stream apart
 * from the installation funnel by it.
 */
export const INGEST_LIBS = {
  server: 'exawatt-server',
  webLink: 'exawatt-web-link',
  accountStream: 'exawatt-account-stream',
} as const;
type IngestLib = (typeof INGEST_LIBS)[keyof typeof INGEST_LIBS];

export interface IngestTarget {
  /** The decision's `apiHost`: absolute, no trailing slash. */
  apiHost: string;
  /** The public project key. */
  key: string;
}

export interface IngestRecord {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}

/** PostHog's batch capture endpoint, through the configured ingest origin. */
export function ingestBatchUrl(target: IngestTarget): string {
  return `${target.apiHost}/batch/`;
}

/**
 * One allowlisted event as an ingest record. `personless` marks the event as
 * anonymous (`$process_person_profile: false`), which is how the SDK streams
 * send every event; the account stream leaves it off so the operator can read
 * an account's activity as one person.
 */
export function ingestRecordFor(
  event: AnalyticsEvent,
  distinctId: string,
  options: { personless: boolean; lib: IngestLib }
): IngestRecord | null {
  const payload = toAnalyticsPayload(event);
  if (!payload) return null;
  const properties = scrubEventProperties(payload.name, payload.properties);
  if (!properties) return null;
  return {
    event: payload.name,
    distinctId,
    properties: {
      ...properties,
      $lib: options.lib,
      ...(options.personless ? { $process_person_profile: false } : {}),
    },
  };
}

export async function sendToIngest(
  target: IngestTarget,
  records: readonly IngestRecord[],
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (records.length === 0) return true;
  const timestamp = new Date().toISOString();
  try {
    const response = await fetchImpl(ingestBatchUrl(target), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        api_key: target.key,
        batch: records.map(record => ({
          event: record.event,
          distinct_id: record.distinctId,
          properties: record.properties,
          timestamp,
        })),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
