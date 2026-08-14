import { describe, expect, it } from 'vitest';
import { MAX_FEEDBACK_CONTEXT_BYTES } from '@/lib/feedback/contract';
import type { DiagnosticsReport } from '@/types/electron';
import {
  resolveQuickDiagnostics,
  withDiagnostics,
} from './quick-capture-payload';

const REPORT: DiagnosticsReport = {
  reportVersion: 1,
  generatedAt: '2026-08-14T12:00:00.000Z',
  app: {
    version: '0.1.10',
    sha: 'abc123',
    branch: 'master',
    delivery: 'signed',
    packaged: true,
    installPath: '/Applications/Exawatt.app',
  },
  system: {
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '15.0',
    electron: '43.1.0',
    node: '24.18.0',
    locale: 'en-US',
  },
  update: { phase: 'error' },
  session: { signedIn: true, liveSessions: 1 },
  logs: [],
};

const BASE = { schemaVersion: 1, url: 'http://127.0.0.1:5000/workspace' };

describe('resolveQuickDiagnostics', () => {
  it('attaches on a Bug when the toggle is on', () => {
    expect(resolveQuickDiagnostics('bug', true, REPORT)).toBe(REPORT);
  });

  it('never attaches on a kind whose chip is not rendered', () => {
    // The regression: the toggle survives a kind change, so reading it alone
    // sent the bundle with no affordance on screen.
    for (const kind of ['general', 'idea'] as const) {
      expect(resolveQuickDiagnostics(kind, true, REPORT)).toBeNull();
    }
  });

  it('does not attach when the toggle is off', () => {
    expect(resolveQuickDiagnostics('bug', false, REPORT)).toBeNull();
  });

  it('does not attach when no report was collected', () => {
    expect(resolveQuickDiagnostics('bug', true, null)).toBeNull();
  });
});

describe('withDiagnostics', () => {
  it('returns the base context untouched when there is nothing to attach', () => {
    expect(withDiagnostics(BASE, null)).toEqual(BASE);
  });

  it('attaches a report that fits the intake cap', () => {
    const out = withDiagnostics(BASE, REPORT);
    expect(out.diagnostics).toBe(REPORT);
  });

  it('drops the report rather than pushing the context past the cap', () => {
    const oversized = {
      ...REPORT,
      logs: [
        {
          name: 'updater.jsonl',
          present: true,
          lines: [{ pad: 'p'.repeat(MAX_FEEDBACK_CONTEXT_BYTES) }],
        },
      ],
    };
    const out = withDiagnostics(BASE, oversized);
    expect(out.diagnostics).toBeUndefined();
    expect(out).toEqual(BASE);
  });

  it('keeps the surviving context under the cap in every case', () => {
    const oversized = {
      ...REPORT,
      logs: [
        {
          name: 'auth.jsonl',
          present: true,
          lines: [{ pad: 'p'.repeat(MAX_FEEDBACK_CONTEXT_BYTES * 2) }],
        },
      ],
    };
    const bytes = new TextEncoder().encode(
      JSON.stringify(withDiagnostics(BASE, oversized))
    ).byteLength;
    expect(bytes).toBeLessThanOrEqual(MAX_FEEDBACK_CONTEXT_BYTES);
  });
});
