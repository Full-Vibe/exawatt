import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps a project font size beside a HUD colour', () => {
    // Regression (ENG-016 D49): stock tailwind-merge classified
    // `text-chrome-micro` as a colour, so one of these silently disappeared
    // and the text rendered at the inherited size.
    const result = cn('font-mono text-chrome-micro', 'text-hud-text-dim');
    expect(result).toContain('text-chrome-micro');
    expect(result).toContain('text-hud-text-dim');
  });

  it('keeps the size when the colour is written first', () => {
    const result = cn('text-hud-amber', 'text-chrome-label');
    expect(result).toContain('text-hud-amber');
    expect(result).toContain('text-chrome-label');
  });

  it('still resolves a genuine size conflict to the last one', () => {
    expect(cn('text-chrome-micro', 'text-chrome-label')).toBe(
      'text-chrome-label'
    );
    expect(cn('text-xs', 'text-chrome-label')).toBe('text-chrome-label');
  });

  it('still resolves a genuine colour conflict to the last one', () => {
    expect(cn('text-hud-text', 'text-hud-text-dim')).toBe('text-hud-text-dim');
  });
});
