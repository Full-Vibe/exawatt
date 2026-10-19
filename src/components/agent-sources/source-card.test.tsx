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

  it('signs every local source in through an Exawatt Shell running its declared command', () => {
    // BUG-275: a sign-in that drives Terminal.app needs an Apple Events
    // entitlement Exawatt does not carry. Every source with a local harness
    // declares its sign-in, and the step is always the in-app Shell.
    const local_ = AGENT_SOURCE_DECLARATIONS.filter(
      declaration => declaration.harness !== null
    );
    expect(local_.length).toBeGreaterThan(0);
    for (const declaration of local_) {
      for (const state of ['action-required', 'unknown'] as const) {
        const source = local({
          adapterId: declaration.adapterId,
          state,
          actions: SIGN_IN_OFFERED,
        });
        const step = sourceCardStep(source);
        expect(step?.kind, declaration.adapterId).toBe('sign-in');
        if (step?.kind !== 'sign-in') throw new Error('unreachable');
        expect(step.command).toBe(declaration.signIn.command);
        expect(step.command.trim()).not.toBe('');
      }
      // The fact behind an offered sign-in is the sign-in's, never a
      // reachability line.
      const unknown = local({
        adapterId: declaration.adapterId,
        state: 'unknown',
        actions: SIGN_IN_OFFERED,
      });
      expect(sourceAttention(unknown)?.detail).toBe(
        unknown.facts.authentication.detail
      );
    }
  });
});
