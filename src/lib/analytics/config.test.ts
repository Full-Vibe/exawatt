import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_INGEST_PATH,
  DESKTOP_ANALYTICS_HOST,
  resolveAnalyticsApiHost,
  resolveAnalyticsDecision,
} from './config';

const PRODUCTION = { key: 'phc_test', nodeEnv: 'production' };

describe('analytics api host', () => {
  it('keeps the web app same-origin so the Next rewrite proxies it', () => {
    expect(resolveAnalyticsApiHost({ isElectron: false })).toBe('/ingest');
    expect(ANALYTICS_INGEST_PATH).toBe('/ingest');
  });

  it('sends the desktop renderer to the hosted origin, not to loopback', () => {
    // The packaged renderer is served from http://127.0.0.1:<ephemeral port>.
    // A relative /ingest would make the user's own machine talk to PostHog,
    // which is exactly what decision 0034 forbids.
    expect(resolveAnalyticsApiHost({ isElectron: true })).toBe(
      'https://www.exawatt.ai/ingest'
    );
    expect(DESKTOP_ANALYTICS_HOST).toBe('https://www.exawatt.ai/ingest');
  });

  it('never resolves the desktop host to a loopback origin', () => {
    const host = resolveAnalyticsApiHost({ isElectron: true });
    expect(host.startsWith('https://')).toBe(true);
    expect(host).not.toContain('127.0.0.1');
    expect(host).not.toContain('localhost');
  });

  it('lets a distributor redirect or self-host the sink on either surface', () => {
    for (const isElectron of [true, false]) {
      expect(
        resolveAnalyticsApiHost({
          isElectron,
          hostOverride: 'https://telemetry.example.com/ingest/',
        })
      ).toBe('https://telemetry.example.com/ingest');
    }
  });

  it('ignores a blank override rather than producing an empty host', () => {
    expect(resolveAnalyticsApiHost({ isElectron: true, hostOverride: '   ' })).toBe(
      DESKTOP_ANALYTICS_HOST
    );
  });
});

describe('analytics decision', () => {
  it('initializes in production with a key', () => {
    expect(
      resolveAnalyticsDecision(PRODUCTION, { isElectron: false, optedOut: false })
    ).toEqual({ enabled: true, key: 'phc_test', apiHost: '/ingest' });
  });

  it('carries the desktop host into the decision', () => {
    expect(
      resolveAnalyticsDecision(PRODUCTION, { isElectron: true, optedOut: false })
    ).toEqual({
      enabled: true,
      key: 'phc_test',
      apiHost: 'https://www.exawatt.ai/ingest',
    });
  });

  it('stays off in development and test', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      expect(
        resolveAnalyticsDecision(
          { ...PRODUCTION, nodeEnv },
          { isElectron: true, optedOut: false }
        )
      ).toEqual({ enabled: false, reason: 'not_production' });
    }
  });

  it('honors the build switch', () => {
    for (const disabled of ['1', 'true', 'TRUE', 'yes']) {
      expect(
        resolveAnalyticsDecision(
          { ...PRODUCTION, disabled },
          { isElectron: true, optedOut: false }
        )
      ).toEqual({ enabled: false, reason: 'disabled_by_build' });
    }
  });

  it('treats an unset or falsy build switch as opted in', () => {
    for (const disabled of [undefined, '', '0', 'false']) {
      expect(
        resolveAnalyticsDecision(
          { ...PRODUCTION, disabled },
          { isElectron: false, optedOut: false }
        ).enabled
      ).toBe(true);
    }
  });

  it('honors the runtime opt-out even in an official production build', () => {
    expect(
      resolveAnalyticsDecision(PRODUCTION, { isElectron: true, optedOut: true })
    ).toEqual({ enabled: false, reason: 'opted_out' });
  });

  it('stays off without a project key', () => {
    for (const key of [undefined, '', '  ']) {
      expect(
        resolveAnalyticsDecision(
          { ...PRODUCTION, key },
          { isElectron: false, optedOut: false }
        )
      ).toEqual({ enabled: false, reason: 'missing_key' });
    }
  });
});
