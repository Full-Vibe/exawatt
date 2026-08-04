import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseRoadmap } from '@exawatt/core';
import {
  buildRoadmapLens,
  type RoadmapItemView,
  type RoadmapLensView,
} from '@exawatt/ui-model';
import { RoadmapItemDetail } from './roadmap-item-detail';
import { RoadmapRail } from './roadmap-rail';

function viewFor(body: string): RoadmapLensView {
  const doc = parseRoadmap(`---\nexawatt-roadmap: v2\n---\n\n${body}`, {
    projectDir: '/repo',
    file: 'ROADMAP.md',
    now: () => 0,
  });
  return buildRoadmapLens({
    read: { status: 'ok', doc, mtimeMs: 0 },
  });
}

function detail(item: RoadmapItemView, writeBusy = false) {
  return render(
    <RoadmapItemDetail
      item={item}
      color="#19e6ff"
      unmappedSessions={[]}
      manipulable
      writeBusy={writeBusy}
      onOpenPath={vi.fn()}
      onSelectSession={vi.fn()}
      onStartAgent={vi.fn().mockResolvedValue(true)}
      onAttachSession={vi.fn()}
      onMutate={vi.fn()}
    />
  );
}

describe('roadmap write controls', () => {
  it('shows only operations legal for the item state', () => {
    const regular = viewFor(
      '## Now\n\n### ACME-001 Current\n\n### ACME-002 Second\n'
    );
    const mounted = detail(regular.now[1]);
    expect(
      screen.getByRole('combobox', { name: 'Roadmap status' })
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move item up' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Move item down' })
    ).toBeDisabled();
    mounted.unmount();

    const backlog = viewFor(
      '## Backlog\n\n### ACME-003 First\n\nStatus: bug · ACME-001 · capture 2026-08-03\n\n### ACME-004 Second\n\nStatus: small-fix · ACME-001 · review 2026-08-03\n'
    );
    const backlogMounted = detail(backlog.backlog[1]);
    expect(
      screen.queryByRole('combobox', { name: 'Roadmap status' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Move item up' })).toBeEnabled();
    backlogMounted.unmount();

    const shipped = viewFor('## Shipped\n\n### ACME-003 History\n');
    detail(shipped.shipped[0]);
    expect(
      screen.queryByRole('combobox', { name: 'Roadmap status' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move item up' })).toBeNull();
  });

  it('makes ambiguous ids view-only and disables legal controls while writing', () => {
    const duplicate = viewFor(
      '## Now\n\n### ACME-001 First\n\n### ACME-001 Second\n'
    );
    const duplicateMounted = detail(duplicate.now[0]);
    expect(screen.getByText('Duplicate id · view only')).toBeVisible();
    expect(
      screen.queryByRole('combobox', { name: 'Roadmap status' })
    ).toBeNull();
    duplicateMounted.unmount();

    const regular = viewFor('## Now\n\n### ACME-002 Current\n');
    detail(regular.now[0], true);
    expect(
      screen.getByRole('combobox', { name: 'Roadmap status' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move item up' })).toBeDisabled();
  });

  it('leaves keyboard events from the status control with the control', () => {
    const view = viewFor(
      '## Now\n\n### ACME-001 Current\n\nMilestones:\n\n- [ ] M1 First\n'
    );
    const startAgent = vi.fn().mockResolvedValue(true);
    render(
      <RoadmapRail
        view={view}
        projectDir="/repo"
        projectName="Repo"
        projectColor="#19e6ff"
        mode="open"
        onModeChange={vi.fn()}
        onSelectSession={vi.fn()}
        overlay={false}
        permanent
        untriagedFeedback={null}
        onStartAgent={startAgent}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /ACME-001.*Current/i }));
    const status = screen.getByRole('combobox', { name: 'Roadmap status' });
    fireEvent.keyDown(status, { key: 'a' });
    expect(startAgent).not.toHaveBeenCalled();
  });
});
