import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountCard } from './usage-bars';
import { scenarioOverview, usageScenario } from './usage-scenarios';

describe('AccountCard', () => {
  it('labels each meter with exactly one percent reading, full and compact', () => {
    const overview = scenarioOverview(usageScenario('runs-out-before-reset'));
    const meters = overview.accounts.flatMap(account => account.meters);
    expect(meters.length).toBeGreaterThan(0);
    for (const compact of [false, true]) {
      const { container, unmount } = render(
        <>
          {overview.accounts.map(account => (
            <AccountCard
              key={account.key}
              account={account}
              nowMs={overview.nowMs}
              windowLabel={overview.windowLabel}
              compact={compact}
            />
          ))}
        </>
      );
      const rendered = container.querySelectorAll('[data-usage-meter]');
      expect(rendered).toHaveLength(meters.length);
      for (const meter of rendered) {
        expect(meter.querySelectorAll('[data-usage-percent]')).toHaveLength(1);
      }
      unmount();
    }
  });
});
