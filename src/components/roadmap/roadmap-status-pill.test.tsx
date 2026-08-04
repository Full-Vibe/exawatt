import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import {
  ROADMAP_STATUS_COLOR,
  ROADMAP_STATUS_TEXT_COLOR,
  RoadmapStatusPill,
} from './roadmap-status-pill';

describe('RoadmapStatusPill', () => {
  it('separates status accents from contrast-gated micro-copy', () => {
    render(
      <>
        <RoadmapStatusPill status="active" />
        <RoadmapStatusPill status="next" />
        <RoadmapStatusPill status="shipped" />
      </>
    );

    expect(screen.getByText('Active')).toHaveStyle({ color: HUD.text });
    expect(screen.getByText('Next')).toHaveStyle({ color: HUD.textDim });
    expect(screen.getByText('Shipped')).toHaveStyle({ color: HUD.green });
    expect(ROADMAP_STATUS_COLOR.active).toBe(HUD.cyan2);
    expect(ROADMAP_STATUS_TEXT_COLOR.active).not.toBe(
      ROADMAP_STATUS_COLOR.active
    );
  });
});
