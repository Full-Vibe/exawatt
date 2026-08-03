import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CapacityPopover } from './capacity';
import { ConsumptionClockProvider } from './clock';
import { METER_STATES } from './meter/fixtures';
import { readMeter } from './meter/meter-model';
import { MeterPopover } from './meter/meter-popover';

describe('Consumption material popovers', () => {
  const fixture = METER_STATES[0]!;

  it('projects capacity through the shared overlay material', () => {
    const view = render(
      <ConsumptionClockProvider nowMs={fixture.nowMs}>
        <CapacityPopover
          sources={fixture.sources}
          onClose={vi.fn()}
          labelledBy="capacity-label"
        />
      </ConsumptionClockProvider>
    );

    expect(
      view.container.querySelector('[data-consumption-popover]')?.classList
    ).toContain('exa-material-overlay');
  });

  it('projects the ambient meter through the same overlay material', () => {
    const view = render(
      <MeterPopover snapshot={readMeter(fixture.sources, fixture.nowMs)} />
    );

    expect(
      view.container.querySelector('[data-meter-popover]')?.classList
    ).toContain('exa-material-overlay');
  });
});
