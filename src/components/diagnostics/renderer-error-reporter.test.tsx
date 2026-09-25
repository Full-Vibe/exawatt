import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderErrorReport } from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { RendererErrorReporter } from './renderer-error-reporter';

function installReporter() {
  const reports: RenderErrorReport[] = [];
  installBridgeDouble({
    platform: 'darwin',
    app: {
      reportRenderError: vi.fn(async (report: RenderErrorReport) => {
        reports.push(report);
      }),
    },
  });
  render(<RendererErrorReporter />);
  return reports;
}

function windowError(message: string, error?: Error) {
  act(() => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message,
        error,
        filename: 'http://127.0.0.1/app.js',
        lineno: 3,
        colno: 7,
      })
    );
  });
}

/** jsdom has no PromiseRejectionEvent; the browser's carries `reason`. */
function unhandledRejection(reason: unknown) {
  act(() => {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: reason });
    window.dispatchEvent(event);
  });
}

afterEach(() => {
  cleanup();
  removeBridgeDouble();
});

describe('RendererErrorReporter', () => {
  it('reports a window error with where it came from', () => {
    const reports = installReporter();
    windowError('x is undefined', new TypeError('x is undefined'));
    expect(reports).toEqual([
      expect.objectContaining({
        kind: 'error',
        message: 'x is undefined',
        source: 'http://127.0.0.1/app.js:3:7',
      }),
    ]);
    expect(reports[0].stack).toContain('TypeError');
  });

  it('reports a rejection nothing awaited, Error or not', () => {
    const reports = installReporter();
    unhandledRejection(new Error('invoke failed'));
    unhandledRejection('plain reason');
    expect(reports.map(r => [r.kind, r.message])).toEqual([
      ['unhandled-rejection', 'invoke failed'],
      ['unhandled-rejection', 'plain reason'],
    ]);
  });

  it('skips browser noise and an immediate repeat', () => {
    const reports = installReporter();
    windowError(
      'ResizeObserver loop completed with undelivered notifications.'
    );
    windowError('Script error.');
    windowError('same');
    windowError('same');
    expect(reports.map(r => r.message)).toEqual(['same']);
  });

  it('sends at most ten reports a minute from a page stuck in an error loop', () => {
    const reports = installReporter();
    for (let i = 0; i < 30; i += 1) windowError(`loop ${i}`);
    expect(reports).toHaveLength(10);
  });

  it('does nothing outside the desktop app', () => {
    removeBridgeDouble();
    render(<RendererErrorReporter />);
    expect(() => windowError('no bridge')).not.toThrow();
  });
});
