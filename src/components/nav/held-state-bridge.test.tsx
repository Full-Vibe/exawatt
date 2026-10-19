import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetHeldStateForTest } from '@/lib/app-lifecycle/held-state';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

afterEach(() => {
  removeBridgeDouble();
  resetHeldStateForTest();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

function bridge(held: Record<string, unknown> | null) {
  const takeHeldState = vi.fn(() => held);
  const reportRenderError = vi.fn(async () => undefined);
  installBridgeDouble({
    app: {
      takeHeldState,
      reportRenderError,
      onHeldStateRequest: () => () => undefined,
      completeHeldState: async () => undefined,
    },
  });
  return { takeHeldState, reportRenderError };
}

describe('HeldStateBridge', () => {
  // Review of 0.1.22: the hand-back ran when the root layout's module was
  // evaluated, outside every boundary.
  it('takes nothing when its module loads', async () => {
    const { takeHeldState } = bridge({ 'session-storage': {} });
    await import('./held-state-bridge');
    expect(takeHeldState).not.toHaveBeenCalled();
  });

  it("puts the previous run's per-run storage back once it mounts", async () => {
    bridge({
      'session-storage': { 'exawatt:spatial-return': '/fleet/spatial' },
    });
    const { HeldStateBridge } = await import('./held-state-bridge');
    render(<HeldStateBridge />);
    expect(window.sessionStorage.getItem('exawatt:spatial-return')).toBe(
      '/fleet/spatial'
    );
  });

  it('keeps the window up and reports it when storage refuses an entry', async () => {
    const { reportRenderError } = bridge({
      'session-storage': {
        'exawatt:spatial-return': '/fleet/spatial',
        'exawatt:spatial-viewport': '{"zoom":2}',
      },
    });
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (key === 'exawatt:spatial-viewport') {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    });
    const { HeldStateBridge } = await import('./held-state-bridge');
    expect(() => render(<HeldStateBridge />)).not.toThrow();
    expect(window.sessionStorage.getItem('exawatt:spatial-return')).toBe(
      '/fleet/spatial'
    );
    expect(reportRenderError).toHaveBeenCalledOnce();
    const [report] = reportRenderError.mock.calls[0] as unknown as [
      { message: string },
    ];
    expect(report.message).toContain('exawatt:spatial-viewport');
    expect(report.message).not.toContain('zoom');
  });
});
