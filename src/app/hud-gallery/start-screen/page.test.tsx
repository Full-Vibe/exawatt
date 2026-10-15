import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROJECT_SUGGESTIONS,
  START_STATES,
  isRecent,
  sourceCardsFor,
} from './fixtures';
import { StartScreenStudy } from './study';

vi.mock('next/navigation', () => ({
  useSearchParams: () => null,
}));

afterEach(cleanup);

/**
 * The study exists for review, so these tests pin only what the review
 * depends on: the five states are five different screens, every source card
 * carries exactly one next step, the composition keeps its order, and the
 * Demo stays one click away in every state. Copy is judged by eye.
 */

function frame(): HTMLElement {
  const node = document.querySelector('[data-start-screen]');
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

function selectState(id: string) {
  fireEvent.click(
    document.querySelector(`[data-study-control="state:${id}"]`) as Element
  );
}

/** What a state renders, independent of its words. */
function signature(): string {
  const root = frame();
  const view = root.getAttribute('data-start-view');
  const cards = Array.from(root.querySelectorAll('[data-source-card]')).map(
    card =>
      `${card.getAttribute('data-source-card')}:${card.getAttribute('data-source-state')}`
  );
  const projects =
    root
      .querySelector('[data-start-section="projects"]')
      ?.getAttribute('data-start-projects') ?? 'none';
  const rows = root.querySelectorAll('[data-project-suggestion]').length;
  return [view, cards.join(','), projects, rows].join('|');
}

describe('Start screen study', () => {
  it('renders five distinct states from one composition', () => {
    render(<StartScreenStudy />);
    const seen = new Map<string, string>();
    for (const state of START_STATES) {
      selectState(state.id);
      expect(frame().getAttribute('data-start-state')).toBe(state.id);
      seen.set(state.id, signature());
    }
    expect(seen.size).toBe(5);
    expect(new Set(seen.values()).size).toBe(5);
  });

  it('gives every source card exactly one next step, in the composer order', () => {
    render(<StartScreenStudy />);
    for (const state of START_STATES) {
      selectState(state.id);
      const expected = sourceCardsFor(state.id);
      const cards = Array.from(frame().querySelectorAll('[data-source-card]'));
      if (state.id === 'demo') {
        // Switched into the Demo: the Start screen's cards are not on screen.
        expect(cards).toHaveLength(0);
        continue;
      }
      expect(cards.map(card => card.getAttribute('data-source-card'))).toEqual(
        expected.map(card => card.id)
      );
      for (const card of cards) {
        expect(card.querySelectorAll('[data-next-step]')).toHaveLength(1);
      }
      // A repair step keeps Recheck beside it; Recheck as the step stands alone.
      for (const [index, card] of cards.entries()) {
        const kind = card
          .querySelector('[data-next-step]')
          ?.getAttribute('data-next-step');
        expect(kind).toBe(expected[index].nextStep.kind);
        expect(card.querySelectorAll('[data-source-recheck]')).toHaveLength(
          kind === 'recheck' ? 0 : 1
        );
      }
    }
  });

  it('keeps the composition in order with the Demo one click away', () => {
    render(<StartScreenStudy />);
    for (const state of START_STATES) {
      if (state.id === 'demo') continue;
      selectState(state.id);
      const sections = Array.from(
        frame().querySelectorAll('[data-start-section]')
      ).map(node => node.getAttribute('data-start-section'));
      expect(sections).toEqual(['agents', 'projects', 'demo']);
      expect(frame().querySelector('[data-try-demo]')).not.toBeNull();
      expect(frame().querySelector('[data-chooser-routes]')).not.toBeNull();
    }
  });

  it('lists suggestions most recent first with older ones behind one control', () => {
    render(<StartScreenStudy />);
    selectState('ready-projects');
    const visible = () =>
      Array.from(frame().querySelectorAll('[data-project-suggestion]')).map(
        row => row.getAttribute('data-project-suggestion')
      );
    // Derived from the same fixture and the same 30-day rule the rows use.
    const recent = PROJECT_SUGGESTIONS.filter(suggestion =>
      isRecent(suggestion)
    );
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(PROJECT_SUGGESTIONS.length);
    expect(visible()).toEqual(recent.map(suggestion => suggestion.path));
    for (const row of frame().querySelectorAll('[data-project-suggestion]')) {
      expect(row.querySelector('[data-harness-badges]')).not.toBeNull();
    }
    expect(frame().querySelector('[data-open-all-recent]')).not.toBeNull();
    const older = frame().querySelector('[data-show-older]') as HTMLElement;
    expect(older).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(older);
    expect(older).toHaveAttribute('aria-expanded', 'true');
    expect(visible()).toEqual(
      PROJECT_SUGGESTIONS.map(suggestion => suggestion.path)
    );
  });

  it('hands a one-click open to the real launcher with the suggesting engine chosen', () => {
    render(<StartScreenStudy />);
    selectState('ready-projects');
    const row = frame().querySelector(
      '[data-project-suggestion]'
    ) as HTMLElement;
    fireEvent.click(row);
    expect(frame().getAttribute('data-start-view')).toBe('opened');
    expect(frame().querySelector('[data-agent-launcher]')).not.toBeNull();
    expect(
      frame().querySelector('[data-setup-chip][data-selected]')
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Back to the Start/ }));
    expect(frame().getAttribute('data-start-view')).toBe('start');
  });

  it('switches into the Demo Workspace and back', () => {
    render(<StartScreenStudy />);
    selectState('ready-empty');
    fireEvent.click(frame().querySelector('[data-try-demo]') as Element);
    expect(frame().getAttribute('data-start-view')).toBe('demo');
    expect(frame().querySelector('[data-demo-ribbon]')).not.toBeNull();
    expect(
      frame().querySelectorAll('[data-demo-project]').length
    ).toBeGreaterThan(0);
    fireEvent.click(frame().querySelector('[data-switch-personal]') as Element);
    expect(frame().getAttribute('data-start-view')).toBe('start');
  });

  it('writes no em dash and no wizard chrome', () => {
    render(<StartScreenStudy />);
    for (const state of START_STATES) {
      selectState(state.id);
      const text = frame().textContent ?? '';
      expect(text).not.toContain('—');
      expect(frame().querySelector('[role="progressbar"]')).toBeNull();
    }
  });
});
