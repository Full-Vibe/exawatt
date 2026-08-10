import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FleetAgentView } from '@exawatt/ui-model';
import { SpatialSelectionPanel } from './spatial-selection-panel';

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const callout = {
  border: '#333',
  background: '#111',
  text: '#eee',
  detail: '#ccc',
  signal: '#f80',
};

function agentView(overrides: Partial<FleetAgentView> = {}): FleetAgentView {
  return {
    id: 'a1',
    name: 'Build Pipeline',
    status: 'working',
    goal: 'Advance the release gates',
    project: 'Atlas',
    sessionKey: 'a1',
    lastActivityAt: 0,
    cost: 0,
    costRate: 0,
    tokenRate: 0,
    turnCount: 4,
    activityCount: 2,
    hasHeartbeat: false,
    needsOperator: false,
    active: true,
    statusRank: 1,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof SpatialSelectionPanel>[0]>) {
  return render(
    <SpatialSelectionPanel
      agent={null}
      selectedAgents={[]}
      scopeActivity={null}
      activity={[]}
      delegation={null}
      statusColors={{ active: '#4ea', blocked: '#fa6', idle: '#889' }}
      needsOperatorCallout={callout}
      faultCallout={callout}
      isDemo
      opening={false}
      handoffError={null}
      now={3_600_000}
      onOpenSession={() => undefined}
      onClearSelection={() => undefined}
      onInspectAgent={() => undefined}
      {...props}
    />
  );
}

/**
 * S4/F6: one selection panel replaces the always-present inspector rail and the
 * fleet-wide activity feed. These lock the contract the milestone claims.
 */
describe('SpatialSelectionPanel', () => {
  it('shows the inspected Agent, its goal, and the open-session command', () => {
    renderPanel({ agent: agentView() });
    const panel = screen.getByRole('complementary', { name: 'Selection' });
    expect(panel).toHaveAttribute('data-spatial-selection-panel', 'agent');
    expect(panel).toHaveAttribute('data-selection-count', '1');
    expect(screen.getByText('Build Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Advance the release gates')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open session' })
    ).toBeInTheDocument();
  });

  it('carries only the inspected Agent activity, never a fleet-wide feed', () => {
    renderPanel({
      agent: agentView(),
      activity: [
        {
          id: 'e1',
          agentId: 'a1',
          agentName: 'Build Pipeline',
          type: 'chat_message',
          content: 'Rebuilt the artifact index',
          timestamp: 1,
          tone: 'neutral',
        },
      ],
    });
    expect(screen.getByText('Rebuilt the artifact index')).toBeInTheDocument();
    // No "Waiting for events." empty-state exhaust survives the retirement.
    expect(screen.queryByText(/waiting for events/i)).not.toBeInTheDocument();
  });

  it('renders delegated children with type, description, and elapsed', () => {
    renderPanel({
      agent: agentView(),
      delegation: {
        count: 2,
        children: [
          {
            id: 'c1',
            agentType: 'Explore',
            description: 'Map the release gates',
            startedAt: 3_600_000 - 25 * 60_000,
          },
          {
            id: 'c2',
            agentType: 'general-purpose',
            description: null,
            startedAt: null,
          },
        ],
      },
    });
    expect(screen.getByText('Delegated')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Map the release gates')).toBeInTheDocument();
    expect(screen.getByText('25m')).toBeInTheDocument();
    // Absent is absent: an unreported description never becomes a fake one.
    expect(screen.getByText('No description reported')).toBeInTheDocument();
  });

  it('names the child whose board unit was activated', () => {
    // The board opens the PARENT because a child has no destination yet, so the
    // panel has to say which worker the operator clicked — otherwise the
    // selection arrives with no explanation of why it is the parent.
    renderPanel({
      agent: agentView(),
      highlightChildId: 'c2',
      delegation: {
        count: 2,
        children: [
          { id: 'c1', agentType: 'Explore', description: 'First', startedAt: null },
          { id: 'c2', agentType: 'Explore', description: 'Second', startedAt: null },
        ],
      },
    });
    const highlighted = document.querySelector(
      '[data-delegated-child-highlighted="true"]'
    );
    expect(highlighted).toHaveAttribute('data-delegated-child', 'c2');
    expect(highlighted).toHaveAttribute('aria-current', 'true');
    expect(
      document.querySelectorAll('[data-delegated-child-highlighted]')
    ).toHaveLength(1);
  });

  it('highlights nothing when the Agent was selected directly', () => {
    renderPanel({
      agent: agentView(),
      delegation: {
        count: 1,
        children: [
          { id: 'c1', agentType: 'Explore', description: null, startedAt: null },
        ],
      },
    });
    expect(
      document.querySelector('[data-delegated-child-highlighted]')
    ).toBeNull();
  });

  it('folds an over-cap child list into an exact remaining count', () => {
    renderPanel({
      agent: agentView(),
      delegation: {
        count: 17,
        children: [
          { id: 'c1', agentType: 'Explore', description: null, startedAt: null },
        ],
      },
    });
    expect(screen.getByText('16 more')).toBeInTheDocument();
  });

  it('omits the delegation section entirely when nothing is reported', () => {
    renderPanel({ agent: agentView(), delegation: null });
    expect(screen.queryByText('Delegated')).not.toBeInTheDocument();
  });

  it('switches to the multi-selection command with the announced verb', () => {
    renderPanel({
      selectedAgents: [agentView(), agentView({ id: 'a2', name: 'Second' })],
      scopeActivity: {
        agentCount: 2,
        working: 1,
        blocked: 1,
        idle: 0,
        burn: null,
      },
    });
    const panel = screen.getByRole('complementary', { name: 'Selection' });
    expect(panel).toHaveAttribute('data-spatial-selection-panel', 'multi');
    expect(panel).toHaveAttribute('data-selection-count', '2');
    expect(screen.getByText('2 Agents')).toBeInTheDocument();
    expect(screen.getByText('Direct 2 Agents')).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
  });
});
