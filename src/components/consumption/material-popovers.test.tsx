import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { METER_STATES } from './meter/fixtures';
import { readMeter } from './meter/meter-model';
import { MeterPopover } from './meter/meter-popover';

// The `CapacityPopover` sibling case retired with `capacity.tsx` on
// 2026-08-03 (ENG-036/ENG-008 study retirement — its only mount was the
// deleted consumption-lab). The live overlay-material contract stays
// asserted here through the ambient meter's popover.
describe('Consumption material popovers', () => {
  const fixture = METER_STATES[0]!;

  it('projects the ambient meter through the shared overlay material', () => {
    const view = render(
      <MeterPopover snapshot={readMeter(fixture.sources, fixture.nowMs)} />
    );

    expect(
      view.container.querySelector('[data-meter-popover]')?.classList
    ).toContain('exa-material-overlay');
  });
});
