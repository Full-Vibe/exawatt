import { describe, expect, it } from 'vitest';
import {
  CONSUMPTION_CHROME,
  FLUX,
  FLUX_CSS,
  UNIT_COLOR_CSS,
  consumptionAlpha,
  pressureColor,
  pressureColorCss,
  unknownHatchCss,
} from './flux';

describe('Consumption theme adapter', () => {
  it('keeps the concrete Classic ramp stable for non-DOM consumers', () => {
    expect(FLUX).toMatchObject({
      calm: '#5D6BE8',
      mid: '#9B6BF5',
      warm: '#D95CEE',
      hot: '#FF4FB4',
      unknown: '#77839A',
    });
    expect(pressureColor(0)).toBe('rgb(93, 107, 232)');
    expect(pressureColor(100)).toBe('rgb(255, 79, 180)');
  });

  it('maps every DOM role to the generated Consumption channel', () => {
    for (const [role, value] of Object.entries(FLUX_CSS)) {
      expect(value, role).toBe(
        `var(--exa-consumption-${role.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)})`
      );
    }
    expect(UNIT_COLOR_CSS).toEqual({
      cacheRead: 'var(--exa-consumption-units-cache-read)',
      cacheWrite: 'var(--exa-consumption-units-cache-write)',
      input: 'var(--exa-consumption-units-input)',
      output: 'var(--exa-consumption-units-output)',
      reasoning: 'var(--exa-consumption-units-reasoning)',
    });
  });

  it('keeps interpolation and alpha live through root custom properties', () => {
    expect(pressureColorCss(0)).toBe(FLUX_CSS.calm);
    expect(pressureColorCss(62)).toBe(FLUX_CSS.mid);
    expect(pressureColorCss(85)).toBe(FLUX_CSS.warm);
    expect(pressureColorCss(100)).toBe(FLUX_CSS.hot);
    expect(pressureColorCss(73)).toContain('var(--exa-consumption-mid)');
    expect(pressureColorCss(73)).toContain('var(--exa-consumption-warm)');
    expect(consumptionAlpha(FLUX_CSS.hot, 0.5)).toBe(
      'color-mix(in srgb, var(--exa-consumption-hot) 50%, transparent)'
    );
    expect(unknownHatchCss()).toContain('var(--exa-consumption-unknown)');
  });

  it('uses generated foundation chrome without collapsing channels', () => {
    expect(CONSUMPTION_CHROME.canvas).toBe('var(--exa-foundation-canvas)');
    expect(CONSUMPTION_CHROME.focus).toBe('var(--exa-foundation-focus)');
    expect(FLUX_CSS.unknown).not.toBe('var(--exa-readiness-neutral)');
    expect(Object.values(FLUX_CSS)).not.toContain(
      'var(--exa-foundation-action)'
    );
    expect(
      Object.values(FLUX_CSS).some(value => value.includes('status'))
    ).toBe(false);
  });
});
