import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_STREAM_LIB,
  ANALYTICS_INSIGHTS,
  ANALYTICS_READ_FROM,
  POSTHOG_OWN_EVENTS,
  insightQuery,
} from './dashboard';
import {
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENT_PROPERTIES,
  type AnalyticsEventName,
} from './events';
import { INGEST_LIBS } from './ingest';

/**
 * The dashboard reads only what the allowlist sends. A query naming an event
 * or a property `events.ts` does not declare would read nothing and show a
 * zero that looks like a fact (the 2026-10-21 zeros were exactly that).
 */

const KNOWN_EVENTS = new Set<string>([
  ...ANALYTICS_EVENT_NAMES,
  ...POSTHOG_OWN_EVENTS,
]);

function declared(event: string): readonly string[] {
  return ANALYTICS_EVENT_PROPERTIES[event as AnalyticsEventName] ?? [];
}

/** Every event the query names: `event = 'x'` and `event IN ('x', 'y')`. */
function eventsNamed(query: string): string[] {
  const named = [...query.matchAll(/\bevent\s*=\s*'([^']+)'/g)].map(m => m[1]);
  for (const list of query.matchAll(/\bevent\s+IN\s*\(([^)]*)\)/g)) {
    named.push(...[...list[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
  }
  return named;
}

/** Allowlisted properties the query reads; PostHog's `$` properties aside. */
function propertiesRead(query: string): string[] {
  return [...query.matchAll(/\bproperties\.([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map(m => m[1])
    .filter(name => !name.startsWith('$'));
}

/** `event = 'x' AND properties.y`: y is read on x, so x must declare it. */
function pairedReads(query: string): Array<[string, string]> {
  return [
    ...query.matchAll(
      /\bevent\s*=\s*'([^']+)'\s+AND\s+properties\.([A-Za-z_][A-Za-z0-9_]*)/g
    ),
  ].map(m => [m[1], m[2]] as [string, string]);
}

describe('the dashboard against the allowlist', () => {
  it('reads the account stream by the lib the sender stamps', () => {
    expect(ACCOUNT_STREAM_LIB).toBe(INGEST_LIBS.accountStream);
  });

  it('declares each insight once', () => {
    const names = ANALYTICS_INSIGHTS.map(insight => insight.name);
    expect(new Set(names).size).toBe(names.length);
    const ids = ANALYTICS_INSIGHTS.flatMap(insight =>
      insight.shortId ? [insight.shortId] : []
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(ANALYTICS_INSIGHTS.map(insight => [insight.name, insight]))(
    '%s',
    (_name, insight) => {
      const events = eventsNamed(insight.query);

      it('names only allowlisted events', () => {
        expect(events.length).toBeGreaterThan(0);
        for (const event of events) expect(KNOWN_EVENTS).toContain(event);
      });

      it('reads only properties one of its events declares', () => {
        const available = new Set(events.flatMap(declared));
        for (const property of propertiesRead(insight.query)) {
          expect(available, `properties.${property}`).toContain(property);
        }
      });

      it('reads a property on an event only where that event declares it', () => {
        for (const [event, property] of pairedReads(insight.query)) {
          expect(declared(event), `${event}.${property}`).toContain(property);
        }
      });

      it('binds the date range, never before F0, and leaves the team out', () => {
        expect(insight.query).toContain('{filters}');
        expect(insight.query).toContain(
          `timestamp >= toDateTime('${ANALYTICS_READ_FROM} 00:00:00')`
        );
        expect(insight.query).toContain('properties.internal');
      });

      it('saves as a HogQL query with its default range', () => {
        const query = insightQuery(insight) as {
          kind: string;
          source: {
            kind: string;
            filters: { dateRange: { date_from: string } };
          };
        };
        expect(query.source.kind).toBe('HogQLQuery');
        expect(query.source.filters.dateRange.date_from).toBe(insight.dateFrom);
        expect(query.kind).toBe(
          insight.display === 'Table'
            ? 'DataTableNode'
            : 'DataVisualizationNode'
        );
      });
    }
  );

  it('catches a drifted query', () => {
    const drifted =
      "SELECT count() FROM events WHERE event = 'project_opened' AND properties.path = '/'";
    expect(KNOWN_EVENTS).toContain(eventsNamed(drifted)[0]);
    expect(declared('project_opened')).not.toContain(
      pairedReads(drifted)[0][1]
    );
    expect(KNOWN_EVENTS).not.toContain(eventsNamed("event = 'app_opened'")[0]);
  });
});
