import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoadmapRail } from './roadmap-rail';
import { ROADMAP_LAB_STATES } from './lab-fixtures';

function renderRail(untriagedFeedback: number | null) {
  return render(
    <RoadmapRail
      view={ROADMAP_LAB_STATES[0].view}
      projectDir="/fixtures/lab"
      projectName="lab"
      projectColor="#50e6ff"
      mode="open"
      onModeChange={() => {}}
      onSelectSession={() => {}}
      overlay={false}
      untriagedFeedback={untriagedFeedback}
    />
  );
}

describe('RoadmapRail untriaged feedback line (ENG-025 F2.1)', () => {
  it('surfaces the operator inbox count in the trust strip', () => {
    renderRail(3);
    expect(screen.getByText('3 filed thoughts awaiting triage')).toBeTruthy();
  });

  it('uses singular copy for one row', () => {
    renderRail(1);
    expect(screen.getByText('1 filed thought awaiting triage')).toBeTruthy();
  });

  it('renders nothing when the queue is empty or unknown', () => {
    const { unmount } = renderRail(0);
    expect(document.querySelector('[data-untriaged-feedback]')).toBeNull();
    unmount();
    renderRail(null);
    expect(document.querySelector('[data-untriaged-feedback]')).toBeNull();
  });
});
