import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CONSUMPTION_CHROME, FLUX_CSS } from '@/components/consumption/flux';
import { resetLiveConsumptionForTests } from '@/components/consumption/live-store';
import { UsageClient } from './usage-client';

afterEach(() => {
  document.documentElement.style.removeProperty('--exa-foundation-canvas');
  document.documentElement.style.removeProperty('--exa-consumption-panel');
  document.documentElement.style.removeProperty('--exa-consumption-unknown');
  resetLiveConsumptionForTests();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('Usage theme percolation', () => {
  it('keeps one mounted surface on generated root variables', () => {
    const view = render(<UsageClient />);
    const surface = view.container.querySelector<HTMLElement>(
      '[data-consumption-surface]'
    );
    expect(surface).not.toBeNull();
    expect(surface?.style.background).toBe(CONSUMPTION_CHROME.canvas);

    const firstPanel = view.container.querySelector<HTMLElement>(
      '[data-consumption-surface] section'
    );
    expect(firstPanel?.style.background).toBe(CONSUMPTION_CHROME.surface);

    document.documentElement.style.setProperty(
      '--exa-foundation-canvas',
      '#f3f5f2'
    );
    document.documentElement.style.setProperty(
      '--exa-consumption-panel',
      '#f4f1f8'
    );
    expect(view.container.querySelector('[data-consumption-surface]')).toBe(
      surface
    );
    expect(surface?.style.background).toBe('var(--exa-foundation-canvas)');
    expect(firstPanel?.style.background).toBe('var(--exa-consumption-panel)');
  });

  it('renders unknown Consumption state from its own channel, not readiness', () => {
    const view = render(<UsageClient />);
    const unknown = screen.getAllByText(/no plan record/i)[0];
    expect(unknown.style.color).toBe(FLUX_CSS.unknown);
    expect(unknown.getAttribute('style')).not.toContain('readiness');
    expect(FLUX_CSS.unknown).not.toBe('var(--exa-readiness-neutral)');
    fireEvent.click(screen.getByRole('button', { name: 'raw tokens' }));
    expect(view.container.innerHTML).toContain('--exa-consumption-units-');
  });
});

/* ------------------------------------------------------------------ */
/* BUG-016 — three states, not two                                     */
/* ------------------------------------------------------------------ */

/**
 * The page used to have two presentations for three situations. Without a
 * desktop bridge it showed the demo week under a Demo banner, which is honest
 * on the hosted web app. With a bridge whose command engine had died it showed
 * a COMPLETE LIVE READ OF ZERO, with no banner at all — a stronger claim than
 * the demo corpus it was reported as, because it says this machine burned
 * nothing. A field report of "usage shows demo data" could not be told apart
 * from a stale build, a crashed scanner, or a deliberate Demo tenant.
 */
function installBridge(options: {
  phase?: 'starting' | 'ready' | 'paused';
  snapshotRejects?: boolean;
}): void {
  (window as unknown as { electron: unknown }).electron = {
    isElectron: true,
    consumption: {
      snapshot: async () => {
        if (options.snapshotRejects) {
          throw new Error("No handler registered for 'consumption:snapshot'");
        }
        const { emptyLiveConsumptionSnapshot } = await import('@exawatt/core');
        return emptyLiveConsumptionSnapshot(Date.now());
      },
      rescan: async () => {},
      cancelScan: async () => {},
      onUpdated: () => () => {},
    },
    ...(options.phase
      ? {
          commandEngine: {
            phase: async () => options.phase,
            onChanged: () => () => {},
          },
        }
      : {}),
    pty: { list: async () => [], closedSessions: async () => [] },
    workspace: { load: async () => ({ projects: [] }), onChanged: () => () => {} },
  };
}

describe('Usage tells the three read states apart', () => {
  it('shows the demo corpus, bannered, where there is no desktop bridge', () => {
    render(<UsageClient />);
    expect(screen.getByText('Demo data')).toBeTruthy();
    expect(screen.queryByText('Command engine paused')).toBeNull();
  });

  it('names a paused command engine instead of reading zero', async () => {
    installBridge({ phase: 'paused', snapshotRejects: true });
    const view = render(<UsageClient />);
    await waitFor(() =>
      expect(screen.getByText('Command engine paused')).toBeTruthy()
    );
    // not a demo: the demo corpus is the honest answer only with no bridge
    expect(screen.queryByText('Demo data')).toBeNull();
    expect(
      view.container.querySelector('[data-consumption-engine="paused"]')
    ).not.toBeNull();
    expect(
      screen.getByText(/nothing on this page was read from this machine/i)
    ).toBeTruthy();
  });

  it('shows neither banner once the local read answers', async () => {
    installBridge({ phase: 'ready' });
    const view = render(<UsageClient />);
    await waitFor(() => expect(screen.queryByText('Demo data')).toBeNull());
    expect(screen.queryByText('Command engine paused')).toBeNull();
    expect(
      view.container.querySelector('[data-consumption-engine="paused"]')
    ).toBeNull();
  });
});
