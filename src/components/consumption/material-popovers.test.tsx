import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeterPopover } from './meter/meter-popover';
import { scenarioOverview, usageScenario } from './usage-scenarios';

// The live overlay-material contract, asserted through the chrome meter's
// popover (its only remaining floating Consumption panel).
describe('Consumption material popovers', () => {
  it('projects the chrome meter popover through the shared overlay material', () => {
    const view = render(
      <MeterPopover overview={scenarioOverview(usageScenario('runs-out-before-reset'))} />
    );
    expect(
      view.container.querySelector('[data-meter-popover]')?.classList
    ).toContain('exa-material-overlay');
  });
});
