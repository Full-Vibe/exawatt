import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fallbackAgentSourceRegistry } from '@/components/workspace/agent-sources';
import { AGENT_SOURCE_DECLARATIONS } from '@/generated/agent-source-declarations';
import type { AgentSourceSnapshot, AgentSourceState } from '@exawatt/core';
import { SourceCard, sourceAttention, sourceCardStep } from './source-card';

/*
 * The card's contract: it is controlled (every fact and handler comes in as
 * a prop), and every state offers AT MOST one step that repairs it, beside
 * Recheck. Copy is the product's and is not asserted here.
 */

const STATES: readonly AgentSourceState[] = [
  'ready',
  'connecting',
  'checking',
  'action-required',
  'degraded',
  'unavailable',
  'not-installed',
  'incompatible',
  'unknown',
];

function local(patch: Partial<AgentSourceSnapshot> = {}): AgentSourceSnapshot {
  const source = fallbackAgentSourceRegistry('all').sources.find(
    candidate =>
      candidate.harness !== null &&
      (patch.adapterId === undefined || candidate.adapterId === patch.adapterId)
  )!;
  return { ...source, ...patch };
}

const SIGN_IN_OFFERED = {
  recheck: true,
  authenticate: true,
  chooseModel: false,
  installGuide: true,
} as const;

function renderCard(source: AgentSourceSnapshot, layout: 'detail' | 'card') {
  const onStep = vi.fn();
  const onRecheck = vi.fn();
  const view = render(
    <TooltipProvider>
      <SourceCard
        layout={layout}
        identity={{
          adapterId: source.adapterId,
          label: source.label,
          secondary: source.connectionName,
          color: source.color,
        }}
        state={source.state}
        stateLabel={source.stateLabel}
        summary={source.summary}
        attention={sourceAttention(source)}
        step={sourceCardStep(source)}
        onStep={onStep}
        onRecheck={onRecheck}
        checkedAt={1}
        now={2}
      />
    </TooltipProvider>
  );
  return { view, onStep, onRecheck };
}

afterEach(cleanup);

describe('SourceCard', () => {
  for (const layout of ['detail', 'card'] as const) {
    it(`renders at most one next step in every state (${layout})`, () => {
      for (const state of STATES) {
        const source = local({
          state,
          actions: {
            recheck: true,
            authenticate: true,
            chooseModel: false,
            installGuide: true,
          },
        });
        const { view } = renderCard(source, layout);
        const steps = view.container.querySelectorAll('[data-source-step]');
        expect(steps.length, state).toBeLessThanOrEqual(1);
        expect(
          view.container.querySelectorAll('[data-source-recheck]').length
        ).toBe(1);
        view.unmount();
      }
    });
  }

  it('offers the installation guide, never a sign-in, to a missing CLI', () => {
    const step = sourceCardStep(
      local({
        state: 'not-installed',
        actions: {
          recheck: true,
          authenticate: true,
          chooseModel: false,
          installGuide: true,
        },
      })
    );
    expect(step?.kind).toBe('install-guide');
  });

  it('offers no step when the source declares no repair', () => {
    expect(
      sourceCardStep(
        local({
          state: 'unknown',
          actions: {
            recheck: true,
            authenticate: false,
            chooseModel: false,
            installGuide: true,
          },
        })
      )
    ).toBeNull();
  });

  it('routes the step and Recheck to the handlers it was given', () => {
    const source = local({
      state: 'action-required',
      actions: {
        recheck: true,
        authenticate: true,
        chooseModel: false,
        installGuide: true,
      },
    });
    const { view, onStep, onRecheck } = renderCard(source, 'card');
    fireEvent.click(view.container.querySelector('[data-source-step]')!);
    fireEvent.click(view.container.querySelector('[data-source-recheck]')!);
    expect(onStep).toHaveBeenCalledOnce();
    expect(onRecheck).toHaveBeenCalledOnce();
  });

  it('scopes its own paint roles, so it reads the same outside Settings', () => {
    const { view } = renderCard(local({ state: 'ready' }), 'card');
    expect(view.container.querySelector('[data-source-card]')).not.toBeNull();
    expect(screen.getByText(local().label)).toBeInTheDocument();
  });

  it('takes a shell sign-in from the declaration, for every source that declares one', () => {
    const declared = AGENT_SOURCE_DECLARATIONS.filter(
      declaration => 'signIn' in declaration && declaration.harness !== null
    );
    expect(declared.length).toBeGreaterThan(0);
    for (const declaration of declared) {
      const source = local({
        adapterId: declaration.adapterId,
        state: 'unknown',
        actions: SIGN_IN_OFFERED,
      });
      const step = sourceCardStep(source);
      expect(step?.kind).toBe('shell-sign-in');
      if (step?.kind !== 'shell-sign-in' || !('signIn' in declaration)) {
        throw new Error('unreachable');
      }
      expect(step.command).toBe(declaration.signIn.command);
      // The fact behind an offered sign-in is the sign-in's, never a
      // reachability line.
      expect(sourceAttention(source)?.detail).toBe(
        source.facts.authentication.detail
      );
    }
  });

  it('keeps the Terminal sign-in for a source that declares no shell sign-in', () => {
    const declaration = AGENT_SOURCE_DECLARATIONS.find(
      candidate => !('signIn' in candidate) && candidate.harness !== null
    )!;
    const step = sourceCardStep(
      local({
        adapterId: declaration.adapterId,
        state: 'action-required',
        actions: SIGN_IN_OFFERED,
      })
    );
    expect(step?.kind).toBe('sign-in');
  });
});
