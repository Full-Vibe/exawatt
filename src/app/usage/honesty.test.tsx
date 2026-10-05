/**
 * The Usage honesty contract, pinned on the rendered cards (ENG-008 E15,
 * carrying the rules the 2026-08-13 audit found failing silently).
 *
 *   1. An account that cannot be read keeps its card and says why, in its
 *      own sentence, and never draws a bar or a percentage it did not read.
 *   2. Cards are named for the ACCOUNT, never for the harness that shares
 *      its credential (claude.ai chat burns the same plan).
 *   3. Vendor money renders the vendor's own figure in its own row.
 *   4. The glance and the page show the same thing: the popover renders the
 *      page's projection, never its own.
 */
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProviderPlanAccountState } from '@exawatt/core';
import { UsageOverviewBody } from '@/components/consumption/usage-overview';
import { MeterPopover } from '@/components/consumption/meter/meter-popover';
import {
  SCENARIO_TIME_ZONE,
  scenarioOverview,
  usageScenario,
  type UsageScenario,
} from '@/components/consumption/usage-scenarios';

const phrase = { timeZone: SCENARIO_TIME_ZONE };

function renderScenario(scenario: UsageScenario) {
  const overview = scenarioOverview(scenario);
  const view = render(<UsageOverviewBody overview={overview} phrase={phrase} />);
  return { overview, view };
}

function claudeCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>('[data-usage-account="claude-code"]');
  if (!card) throw new Error('no Claude card');
  return card;
}

/** The runs-out scenario with the Claude read in one failure state. */
function claudeRead(status: ProviderPlanAccountState['status']): UsageScenario {
  const base = usageScenario('runs-out-before-reset');
  return {
    ...base,
    planWindows: base.planWindows.filter(w => w.source !== 'claude-code'),
    accounts: base.accounts.map(a =>
      a.source === 'claude-code'
        ? { ...a, status, observedAt: null, planType: null, spend: null }
        : a
    ),
  };
}

describe('an account Exawatt cannot read keeps its card', () => {
  const sentences = new Map<string, string>();
  for (const status of ['disabled', 'unavailable'] as const) {
    it(`${status}: says why, with no bar and no percentage`, () => {
      const { view } = renderScenario(claudeRead(status));
      const card = claudeCard(view.container);
      expect(card.querySelector('[data-usage-bar]')).toBeNull();
      expect(card.textContent).not.toMatch(/% used/u);
      const note = card.querySelector('[data-usage-health-note]')?.textContent ?? '';
      expect(note.length).toBeGreaterThan(0);
      // Local token counts still show: the account is busy, not idle.
      expect(note).toMatch(/tokens in the last/u);
      sentences.set(status, note);
    });
  }

  it('gives each cause its own sentence (off is never "couldn\'t read")', () => {
    expect(new Set(sentences.values()).size).toBe(sentences.size);
  });

  it('keeps a failing read on screen at its true age', () => {
    const { view } = renderScenario(usageScenario('claude-read-failing'));
    const card = claudeCard(view.container);
    expect(card.getAttribute('data-usage-health')).toBe('stale');
    expect(card.querySelector('[data-usage-as-of]')?.textContent).toBe('Updated 1 day ago');
    expect(card.querySelectorAll('[data-usage-bar]').length).toBeGreaterThan(0);
  });
});

describe('cards wear the account name', () => {
  it('names the Claude account "Claude", never the harness "Claude Code"', () => {
    const { view } = renderScenario(usageScenario('runs-out-before-reset'));
    const card = claudeCard(view.container);
    expect(within(card).getByRole('heading').textContent).toBe('Claude');
    expect(view.container.textContent).not.toContain('Claude Code');
  });
});

describe('vendor money stays the vendor’s figure', () => {
  it('renders extra usage exactly, in its own row', () => {
    const { view } = renderScenario(usageScenario('runs-out-before-reset'));
    const spend = claudeCard(view.container).querySelector('[data-usage-fact="spend"]');
    expect(spend?.textContent).toContain('$235.22 of $220.00 this month');
  });
});

describe('the glance and the page say the same thing', () => {
  it('the popover renders the same cards in the same order', () => {
    const scenario = usageScenario('runs-out-before-reset');
    const { overview, view } = renderScenario(scenario);
    view.unmount();
    render(<MeterPopover overview={overview} />);
    const cards = document.querySelectorAll('[data-meter-popover] [data-usage-account]');
    expect([...cards].map(c => c.getAttribute('data-usage-account'))).toEqual(
      overview.accounts.map(a => a.key)
    );
  });
});
