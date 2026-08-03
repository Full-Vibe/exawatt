import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  FLUX_CSS,
  pressureColorCss,
} from '@/components/consumption/flux';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionOverviewCardContent } from './session-overview-card';

describe('Session overview Consumption theme projection', () => {
  it('uses the generated Consumption channel for the embedded burn readout', () => {
    const view = render(
      <TooltipProvider>
        <SessionOverviewCardContent
          title="Theme migration"
          color="#5AA7E8"
          harness="codex"
          glyphState="working"
          current="Percolating the shared theme"
          next="Verify every surface"
          consumption={{ rawTokens: 12_400, share: 0.32, intensity: 0.73 }}
        />
      </TooltipProvider>
    );

    const readout = view.container.querySelector<HTMLElement>(
      '[data-session-consumption]'
    );
    const track = readout?.querySelector<HTMLElement>('[aria-hidden="true"]');
    const fill = track?.firstElementChild as HTMLElement | null;

    expect(readout).not.toBeNull();
    expect(track?.style.background).toBe(FLUX_CSS.track);
    expect(fill?.style.background).toBe(pressureColorCss(73));
    expect(readout?.textContent).toContain('12.4K tokens');
  });
});
