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

describe('the unreported mark (ENG-010)', () => {
  function markOf(state: 'off' | 'unreported') {
    const { container, unmount } = render(<StatusLight state={state} />);
    const host = container.querySelector<HTMLElement>('[data-status-light]')!;
    const shape = host.innerHTML;
    const name = host.getAttribute('aria-label') ?? '';
    const color = host.style.color;
    unmount();
    return { shape, name, color };
  }

  it('draws a different shape from a quietly waiting Agent', () => {
    const off = markOf('off');
    const unreported = markOf('unreported');
    expect(unreported.shape).not.toBe(off.shape);
    expect(unreported.shape.length).toBeGreaterThan(0);
  });

  it('survives colour being switched off', () => {
    const off = markOf('off');
    const unreported = markOf('unreported');
    // Same paint on purpose: hue is the channel that disappears first.
    expect(unreported.color).toBe(off.color);
    // So the two channels that remain both have to carry it.
    expect(unreported.shape).not.toBe(off.shape);
    expect(unreported.name).not.toBe(off.name);
  });

  it('announces silence rather than idleness', () => {
    const { name } = markOf('unreported');
    expect(name).toContain('Not reported');
    expect(name).not.toMatch(/\bidle\b/i);
    expect(name).not.toMatch(/stopped|paused|lost|ended|finished/i);
  });

  it('marks itself in the DOM as its own reading', () => {
    const { container } = render(<StatusLight state="unreported" />);
    expect(
      container.querySelector('[data-status-light="unreported"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('.status-light-active-rotor')
    ).not.toBeInTheDocument();
  });
});
