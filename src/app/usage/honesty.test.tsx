/**
 * The `/usage` honesty contract, pinned at the band level (ENG-008, from the
 * 2026-08-13 audit of the real surface on the operator's real corpus).
 *
 * Three rules are asserted here because all three failed in production and
 * all three fail SILENTLY — the page looked fine while it lied:
 *
 *   1. a source that cannot be read is named as unknown, never as a vendor
 *      that "keeps no plan record" (the D1 honesty inversion);
 *   2. an account-scoped window is labelled by its ACCOUNT (D4);
 *   3. vendor plan credits render in their own lane, never summed into the
 *      modelled dollar figure (D2).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AccountReadView,
  CapacityWindowView,
  ConsumptionSourceView,
} from '@/components/consumption/model';
import { readAllWindows } from '@/components/consumption/meter/meter-model';
import { Verdict } from './verdict';
import { Spend } from './answers';
import type { PlanCreditRow, SpendView } from './derive';

const NOW = Date.parse('2026-08-13T18:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function codexSource(usedPercent: number): ConsumptionSourceView {
  const window: CapacityWindowView = {
    limitId: 'codex-weekly',
    label: 'Weekly window',
    usedPercent,
    windowMinutes: 10_080,
    resetsAtMs: NOW + 5 * 24 * HOUR,
    burnPercentPerHour: 0.05,
    observedAtMs: NOW - MIN,
  };
  return {
    key: 'codex',
    harness: 'codex',
    label: 'Codex',
    planType: 'pro',
    credits: null,
    windows: [window],
    observedTokens5h: 35_200_000,
    observedSessions: 3,
    observedDelegatedShare: null,
    burn: [0.2, 0.3],
  };
}

function claudeSource(accountRead?: AccountReadView): ConsumptionSourceView {
  return {
    key: 'claude-code',
    harness: 'claude-code',
    label: 'Claude Code',
    planType: null,
    credits: null,
    windows: [],
    observedTokens5h: 208_100_000,
    observedSessions: 12,
    observedDelegatedShare: 0.31,
    burn: [0.9, 1],
    unreportedReason:
      'Claude Code keeps no plan, quota, or rate-limit record in its local files.',
    ...(accountRead ? { accountRead } : {}),
  };
}

function claudeAccountSource(): ConsumptionSourceView {
  const window: CapacityWindowView = {
    limitId: 'claude-weekly-fable',
    label: 'Weekly — Fable',
    usedPercent: 97,
    windowMinutes: 10_080,
    resetsAtMs: NOW + 2 * 24 * HOUR + 11 * HOUR,
    burnPercentPerHour: 0.4,
    observedAtMs: NOW - 4 * MIN,
    planLevel: true,
  };
  return {
    ...claudeSource({
      status: 'ok',
      observedAtMs: NOW - 4 * MIN,
      planType: 'max',
      spend: null,
    }),
    windows: [window],
  };
}

describe('Headroom names what it cannot see (D1)', () => {
  it('shows a failed read as an unknown position, not as an absent capability', () => {
    const claude = claudeSource({
      status: 'unavailable',
      observedAtMs: NOW - 3 * HOUR,
      planType: 'max',
      spend: null,
    });
    render(
      <Verdict
        paces={readAllWindows(codexSource(5), NOW, true)}
        silent={[claude]}
        nowMs={NOW}
        unknownNote="Claude account is not readable — this verdict covers the sources that reported."
      />
    );
    expect(screen.getByText('position unknown')).toBeTruthy();
    expect(screen.getByText(/Claude account last read 3h ago/)).toBeTruthy();
    // the capability sentence must NOT be worn by a credential failure
    expect(screen.queryByText(/keeps no plan, quota/)).toBeNull();
    expect(screen.queryByText('no plan record')).toBeNull();
    expect(
      screen.getByText(/this verdict covers the sources that reported/)
    ).toBeTruthy();
  });

  it('says a read is turned off rather than implying nothing exists', () => {
    render(
      <Verdict
        paces={readAllWindows(codexSource(5), NOW, true)}
        silent={[
          claudeSource({
            status: 'disabled',
            observedAtMs: null,
            planType: null,
            spend: null,
          }),
        ]}
        nowMs={NOW}
      />
    );
    expect(screen.getByText('read turned off')).toBeTruthy();
    expect(screen.getByText(/turned off in Settings/)).toBeTruthy();
  });

  it('keeps the capability sentence for a source with no account read at all', () => {
    // The pre-ENG-038 fleet, and the case this split must NOT disturb.
    render(
      <Verdict
        paces={readAllWindows(codexSource(5), NOW, false)}
        silent={[claudeSource()]}
        nowMs={NOW}
      />
    );
    expect(screen.getByText('no plan record')).toBeTruthy();
    expect(screen.getByText(/keeps no plan, quota/)).toBeTruthy();
  });

  it('drops the free-to-spend framing while a source is unreadable', () => {
    const unknown = render(
      <Verdict
        paces={readAllWindows(codexSource(5), NOW, true)}
        silent={[
          claudeSource({
            status: 'disabled',
            observedAtMs: null,
            planType: null,
            spend: null,
          }),
        ]}
        nowMs={NOW}
      />
    );
    expect(unknown.container.textContent).not.toContain('free to spend');
    expect(unknown.container.textContent).toContain('behind even pace');
    unknown.unmount();

    // and still speaks it when the whole fleet IS readable
    const readable = render(
      <Verdict
        paces={readAllWindows(codexSource(5), NOW, false)}
        silent={[claudeSource()]}
        nowMs={NOW}
      />
    );
    expect(readable.container.textContent).toContain('free to spend');
  });
});

describe('account-scoped windows wear the account name (D4)', () => {
  it('headlines the account, not the harness that shares its credential', () => {
    const view = render(
      <Verdict
        paces={readAllWindows(claudeAccountSource(), NOW)}
        silent={[]}
        nowMs={NOW}
      />
    );
    expect(view.container.textContent).toContain('Claude account · Weekly — Fable');
    expect(view.container.textContent).not.toContain('Claude Code · Weekly');
  });

  it('states the plan-wide disclosure on the page that shows the number', () => {
    // It previously existed only inside the meter's hover popover.
    const view = render(
      <Verdict
        paces={readAllWindows(claudeAccountSource(), NOW)}
        silent={[]}
        nowMs={NOW}
      />
    );
    expect(view.container.textContent).toContain('plan-wide');
  });

  it('leaves a locally-parsed window under its harness', () => {
    const view = render(
      <Verdict
        paces={readAllWindows(codexSource(41), NOW)}
        silent={[]}
        nowMs={NOW}
      />
    );
    expect(view.container.textContent).toContain('Codex · Weekly window');
    expect(view.container.textContent).not.toContain('OpenAI account');
  });
});

describe('Spend keeps plan credits in their own ledger (D2)', () => {
  const spend: SpendView = {
    operatorWeighted: 1_289_000_000,
    bySource: [
      { key: 'claude-code', label: 'Claude Code', weighted: 1_250_000_000 },
      { key: 'codex', label: 'Codex', weighted: 39_000_000 },
    ],
    overheadWeighted: 630_000,
  };
  const credits: PlanCreditRow[] = [
    {
      key: 'claude-code',
      label: 'Claude account',
      spend: {
        usedMinor: 20_160,
        limitMinor: 20_000,
        currency: 'USD',
        exponent: 2,
        percent: 100.8,
        enabled: true,
      },
    },
  ];

  it("renders the vendor's own figure with its own basis label", () => {
    const view = render(
      <Spend spend={spend} planCredits={credits} windowLabel="seven days" />
    );
    expect(screen.getByText('$201.60 of $200.00')).toBeTruthy();
    expect(screen.getByText('Claude account')).toBeTruthy();
    expect(screen.getByText('plan credits · vendor-reported')).toBeTruthy();
    // the modelled lane keeps its own basis; the two never share one
    expect(view.container.textContent).toContain('list-price model');
  });

  it('never folds plan credits into the modelled dollar figure', () => {
    const withCredits = render(
      <Spend spend={spend} planCredits={credits} windowLabel="seven days" />
    );
    const modelled = screen.getByText(/modelled$/).textContent;
    withCredits.unmount();
    const without = render(<Spend spend={spend} windowLabel="seven days" />);
    expect(screen.getByText(/modelled$/).textContent).toBe(modelled);
    // and the lane disappears entirely when no vendor reports credits
    expect(without.container.textContent).not.toContain('plan credits');
  });
});
