import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENT_PROPERTIES,
  ANALYTICS_EXCEPTION_PROPERTIES,
  HOSTED_FAILURES,
} from './events';
import { ANALYTICS_PROPERTY_DENYLIST } from './redact';

/**
 * Decision `0031` requires the repository to carry the exact outbound-data
 * manifest. A manifest that drifts from the allowlist is worse than none, so
 * the two are pinned to each other here.
 */
const MANIFEST = readFileSync(
  path.join(process.cwd(), 'docs/engineering/outbound-data.md'),
  'utf8'
);

describe('outbound-data manifest', () => {
  it('names every allowlisted event and property', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(MANIFEST).toContain(name);
      for (const property of ANALYTICS_EVENT_PROPERTIES[name]) {
        expect(MANIFEST).toContain(property);
      }
    }
  });

  it('names every crash payload property that may leave', () => {
    for (const property of ANALYTICS_EXCEPTION_PROPERTIES) {
      expect(MANIFEST).toContain(property);
    }
    // The manifest must say the crash payload is closed, not merely filtered.
    expect(MANIFEST).toContain('$exception_steps');
  });

  it('names every failure bucket a hosted call can be counted in', () => {
    for (const failure of HOSTED_FAILURES) {
      expect(MANIFEST).toContain(failure);
    }
  });

  it('names the denylisted properties it claims to strip', () => {
    const stripped = ['$current_url', '$pathname', '$referrer', '$title'];
    for (const property of stripped) {
      expect(ANALYTICS_PROPERTY_DENYLIST).toContain(property);
      expect(MANIFEST).toContain(property);
    }
  });

  it('documents both ends of the proxy decision 0034 requires', () => {
    expect(MANIFEST).toContain('https://us.i.posthog.com/:path*');
    expect(MANIFEST).toContain('https://us-assets.i.posthog.com/static/:path*');
    expect(MANIFEST).toContain('https://www.exawatt.ai/ingest');
  });

  it('documents every off switch', () => {
    expect(MANIFEST).toContain('NEXT_PUBLIC_ANALYTICS_DISABLED');
    expect(MANIFEST).toContain('NEXT_PUBLIC_POSTHOG_KEY');
    expect(MANIFEST).toContain('NEXT_PUBLIC_POSTHOG_HOST');
    expect(MANIFEST).toContain('exawatt.analytics.opt-out.v1');
  });

  it('names the other outbound destinations, not only analytics', () => {
    for (const destination of [
      'api.anthropic.com',
      'fal.run',
      'supabase.co',
      '/api/context-labels',
      '/api/conversations/summarize',
      '/api/goal-visuals',
    ]) {
      expect(MANIFEST).toContain(destination);
    }
  });
});
