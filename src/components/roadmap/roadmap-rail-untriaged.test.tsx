import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, from, is } = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(() => ({ select: () => ({ is }) })),
  is: vi.fn(async () => ({ count: 5, error: null })),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession }, from }),
}));

vi.mock('@/lib/auth/admin', () => ({
  isAdminEmail: (email: string | null | undefined) =>
    email?.trim().toLowerCase() === 'maintainer@example.com',
}));

import { RoadmapRail } from './roadmap-rail';
import { ROADMAP_LAB_STATES } from './lab-fixtures';

function renderRail(untriagedFeedback?: number | null) {
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('shows the live count to the operator (ENG-025 F3.1)', async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { email: 'maintainer@example.com' } } },
    });
    renderRail();
    expect(
      await screen.findByText('5 filed thoughts awaiting triage')
    ).toBeTruthy();
  });

  it('never shows a non-operator an operator-lane triage line', async () => {
    // F3.1(b): the suggestions lane is not drained to canon, so its filer is
    // shown no triage vocabulary at all.
    getSession.mockResolvedValue({
      data: { session: { user: { email: 'someone@example.com' } } },
    });
    renderRail();
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(document.querySelector('[data-untriaged-feedback]')).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
