import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { STATUS_LIGHT_ACTIVE_ROTATION_SECONDS } from './protocol';
import { STATUS_LIGHT_STATES } from './protocol';
import { StatusLight } from './status-light';

afterEach(cleanup);

describe('StatusLight Active motion', () => {
  it('rotates only the Active half-fill at the shared protocol cadence', () => {
    expect(STATUS_LIGHT_ACTIVE_ROTATION_SECONDS).toBe(2.4);
    const { container, rerender } = render(<StatusLight state="active" />);
    const rotor = container.querySelector('.status-light-active-rotor');

    expect(rotor).toBeInTheDocument();
    expect(rotor).toHaveStyle(
      `animation-duration: ${STATUS_LIGHT_ACTIVE_ROTATION_SECONDS}s`
    );

    rerender(<StatusLight state="result" />);
    expect(
      container.querySelector('.status-light-active-rotor')
    ).not.toBeInTheDocument();
  });

  it('projects every D40 state through the generated appearance role', () => {
    const expectedRole = {
      off: '--exa-status-off',
      active: '--exa-status-active',
      result: '--exa-status-result',
      'needs-you': '--exa-status-needs-you',
      fault: '--exa-status-fault',
    } as const;

    for (const state of STATUS_LIGHT_STATES) {
      const { container, unmount } = render(<StatusLight state={state} />);
      expect(
        container.querySelector<HTMLElement>('[data-status-light]')?.style.color
      ).toContain(expectedRole[state]);
      unmount();
    }
  });
});
