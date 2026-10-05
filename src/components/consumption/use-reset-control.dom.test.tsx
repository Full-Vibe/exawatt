import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanResetOutcome } from '@exawatt/core';
import { UsageOverviewBody } from './usage-overview';
import { scenarioOverview, usageScenario } from './usage-scenarios';

/** The real overview with a Codex read that can spend a reset. */
function renderSpendable(onUseReset?: () => Promise<PlanResetOutcome>) {
  const base = usageScenario('runs-out-before-reset');
  const overview = scenarioOverview({
    ...base,
    accounts: base.accounts.map(a =>
      a.source === 'codex' ? { ...a, canUseReset: true } : a
    ),
  });
  return render(<UsageOverviewBody overview={overview} onUseReset={onUseReset} />);
}

describe('Use reset', () => {
  it('spends nothing until the operator confirms, and nothing on cancel', async () => {
    const spend = vi.fn(async (): Promise<PlanResetOutcome> => 'reset');
    renderSpendable(spend);
    fireEvent.click(screen.getByRole('button', { name: 'Use reset' }));
    expect(spend).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(spend).not.toHaveBeenCalled();
  });

  it('spends one reset on confirm and says what happened in place', async () => {
    const spend = vi.fn(async (): Promise<PlanResetOutcome> => 'nothing-to-reset');
    const view = renderSpendable(spend);
    fireEvent.click(screen.getByRole('button', { name: 'Use reset' }));
    const dialog = await waitFor(() => {
      const found = document.querySelector('[data-usage-reset-confirm="codex"]');
      if (!found) throw new Error('no confirm');
      return found as HTMLElement;
    });
    const confirm = [...dialog.querySelectorAll('button')].find(b =>
      b.textContent?.startsWith('Use reset')
    )!;
    fireEvent.click(confirm);
    await waitFor(() => expect(spend).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-usage-reset-outcome="nothing-to-reset"]')
      ).not.toBeNull()
    );
  });

  it('offers no button where nothing can spend a reset', () => {
    renderSpendable(undefined);
    expect(screen.queryByRole('button', { name: 'Use reset' })).toBeNull();
  });
});
