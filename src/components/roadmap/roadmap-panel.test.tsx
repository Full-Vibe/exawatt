import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseRoadmap, type SessionLink } from '@exawatt/core';
import {
  buildRoadmapLens,
  type RoadmapLensInput,
  type RoadmapLensView,
} from '@exawatt/ui-model';
import { RoadmapPanel } from './roadmap-panel';

const DECLARED = '---\nexawatt-roadmap: v2\n---\n\n';

function viewOf(
  text: string,
  extra: Omit<RoadmapLensInput, 'read'> = {}
): RoadmapLensView {
  const doc = parseRoadmap(text, {
    projectDir: '/repo',
    file: 'ROADMAP.md',
    now: () => 0,
  });
  return buildRoadmapLens({
    read: { status: 'ok', doc, mtimeMs: 0 },
    ...extra,
  });
}

function rail(view: RoadmapLensView) {
  render(
    <RoadmapPanel
      view={view}
      projectDir="/repo"
      projectName="Repo"
      projectColor="#19e6ff"
      onSelectSession={vi.fn()}
      untriagedFeedback={null}
    />
  );
  return document.querySelector('[data-roadmap-panel]') as HTMLElement;
}

describe('roadmap rail handles', () => {
  it('states its readiness as the parsed conformance and convention', () => {
    const declared = viewOf(`${DECLARED}## Now\n\n### ACME-001 Current\n`);
    const panel = rail(declared);
    const readiness = panel.querySelector('[data-roadmap-readiness]');
    expect(readiness).toHaveAttribute(
      'data-roadmap-conformance',
      declared.trust?.conformance
    );
    expect(readiness).toHaveAttribute(
      'data-roadmap-convention',
      declared.trust?.convention
    );
    expect(panel.querySelector('[data-roadmap-remediation]')).toBeNull();
  });

  it('offers remediation where the roadmap is only detected', () => {
    const detected = viewOf('## Now\n\n### ACME-001 Current\n');
    const panel = rail(detected);
    expect(detected.trust?.conformance).not.toBe('declared');
    expect(panel.querySelector('[data-roadmap-readiness]')).toHaveAttribute(
      'data-roadmap-conformance',
      detected.trust?.conformance
    );
    expect(panel.querySelector('[data-roadmap-remediation]')).not.toBeNull();
  });

  it('states the parsed item count and the file it read', () => {
    const view = viewOf(
      `${DECLARED}## Now\n\n### ACME-001 Current\n\n## Next\n\n### ACME-002 Second\n`
    );
    const panel = rail(view);
    expect(panel.querySelector('[data-roadmap-item-count]')).toHaveAttribute(
      'data-roadmap-item-count',
      String(view.trust?.itemCount)
    );
    expect(panel.querySelector('[data-roadmap-file]')).toHaveAttribute(
      'data-roadmap-file',
      view.file
    );
  });

  it('marks the next open milestone and a blocked item on their rows', () => {
    const view = viewOf(
      `${DECLARED}## Now\n\n### ACME-001 Current\n\nMilestones:\n\n- [x] M1 first\n- [ ] M2 second\n\n## Next\n\n### ACME-002 Stuck\n\nStatus: blocked — waiting on a decision.\n`
    );
    const panel = rail(view);
    const hero = view.now[0];
    expect(
      panel.querySelector(
        '[data-roadmap-row="ACME-001"] [data-roadmap-next-milestone]'
      )
    ).toHaveAttribute(
      'data-roadmap-next-milestone',
      String(hero.milestones.findIndex(m => !m.done && !m.retired))
    );
    expect(
      panel.querySelector(
        '[data-roadmap-row="ACME-002"] [data-roadmap-blocked]'
      )
    ).not.toBeNull();
    expect(
      panel.querySelector(
        '[data-roadmap-row="ACME-001"] [data-roadmap-blocked]'
      )
    ).toBeNull();
  });

  it('names its groups, its drill detail and the way back', () => {
    const view = viewOf(
      `${DECLARED}## Now\n\n### ACME-001 Current\n\nScope:\n\n- one thing\n\n## Shipped\n\n### ACME-000 Done\n`
    );
    const panel = rail(view);
    const shipped = panel.querySelector('[data-roadmap-group="shipped"]')!;
    expect(shipped).toHaveAttribute('aria-expanded', 'false');
    expect(panel.querySelector('[data-roadmap-row="ACME-000"]')).toBeNull();
    fireEvent.click(shipped);
    expect(shipped).toHaveAttribute('aria-expanded', 'true');
    expect(panel.querySelector('[data-roadmap-row="ACME-000"]')).not.toBeNull();

    fireEvent.click(panel.querySelector('[data-roadmap-row="ACME-001"]')!);
    const detail = panel.querySelector('[data-roadmap-detail="ACME-001"]')!;
    expect(detail).not.toBeNull();
    expect(detail.querySelectorAll('[data-roadmap-scope]')).toHaveLength(1);
    expect(detail.querySelectorAll('[data-roadmap-start-agent]')).toHaveLength(
      1
    );

    fireEvent.click(panel.querySelector('[data-roadmap-back]')!);
    expect(panel.querySelector('[data-roadmap-detail]')).toBeNull();
    expect(panel.querySelector('[data-roadmap-row="ACME-001"]')).not.toBeNull();
  });

  it('marks a linked Session chip with how it was linked', () => {
    const link: SessionLink = {
      sessionId: 'session-1',
      tabId: 'tab-1',
      projectDir: '/repo',
      itemId: 'ACME-001',
      method: 'inferred',
      confidence: 'high',
      evidence: [],
      evaluatedAt: 0,
    };
    const view = viewOf(`${DECLARED}## Now\n\n### ACME-001 Current\n`, {
      sessions: [
        {
          sessionId: link.sessionId,
          tabId: link.tabId,
          title: 'shell',
          harness: 'shell',
          needsAttention: false,
          startedAt: null,
          turnState: 'waiting',
        },
      ],
      links: [link],
    });
    const panel = rail(view);
    fireEvent.click(panel.querySelector('[data-roadmap-row="ACME-001"]')!);
    expect(
      panel.querySelector(
        `[data-roadmap-detail="ACME-001"] [data-roadmap-chip="${link.sessionId}"]`
      )
    ).toHaveAttribute('data-roadmap-chip-method', link.method);
  });

  it('marks the empty queue', () => {
    const empty = rail(viewOf(`## Shipped\n\n### DONE-1 The only thing\n`));
    expect(empty.querySelector('[data-roadmap-empty-queue]')).not.toBeNull();
  });

  it('marks the missing roadmap', () => {
    const none = rail(
      buildRoadmapLens({ read: { status: 'none', checked: ['ROADMAP.md'] } })
    );
    expect(none.querySelector('[data-roadmap-no-roadmap]')).not.toBeNull();
  });
});
