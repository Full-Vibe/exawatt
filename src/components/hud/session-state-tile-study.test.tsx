import type { ReactNode } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionStateTileStudy } from './session-state-tile-study';

afterEach(cleanup);

function renderStudy() {
  return render(<SessionStateTileStudy />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TooltipProvider>{children}</TooltipProvider>
    ),
  });
}

describe('SessionStateTileStudy', () => {
  it('uses the shared goal and status treatments without visible eyebrow copy', () => {
    renderStudy();

    expect(
      document.querySelector(
        '[data-status="working"] [data-status-light="active"]'
      )
    ).not.toBeNull();
    expect(document.querySelectorAll('[data-session-state-tile]')).toHaveLength(
      5
    );
    const workingTile = screen.getByRole('button', {
      name: /^Open Complete MMHC conversion and secure BAA at the Agent altitude/,
    });
    expect(within(workingTile).queryByText('Working')).not.toBeInTheDocument();
    expect(
      within(workingTile).queryByText('Claude Code')
    ).not.toBeInTheDocument();
    expect(
      workingTile.querySelector('[data-session-goal-summary]')
    ).toHaveClass('font-sans', 'font-normal', 'text-base', 'leading-6');

    const nowRegion = workingTile.querySelector('[data-session-now]');
    const nextRegion = workingTile.querySelector('[data-session-next]');
    expect(nowRegion).not.toBeNull();
    expect(nextRegion).not.toBeNull();
    expect(
      within(nextRegion as HTMLElement).getByText('Step 2 of 4')
    ).toBeInTheDocument();
    expect(
      within(nextRegion as HTMLElement).queryByText('2/4')
    ).not.toBeInTheDocument();
    expect(nextRegion?.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(
      within(nowRegion as HTMLElement).getByText(
        'Coordinating delegated review of the agreement'
      )
    ).toHaveClass('font-sans', 'text-[15px]', 'leading-6');
    expect(workingTile).toHaveClass('h-[272px]', 'w-[300px]');
    expect(screen.getAllByText('2 Agents').length).toBeGreaterThan(0);
    expect(screen.queryByText('Recovered')).not.toBeInTheDocument();
  });

  it('details a delegating fixture with the child rail (D3a)', () => {
    renderStudy();

    const delegating = screen.getByRole('button', {
      name: /^Open Complete MMHC conversion and secure BAA at the Agent altitude/,
    });
    const rail = delegating.querySelector('[data-session-delegation-rail]');
    expect(rail).not.toBeNull();
    // The tile subtree is presentational to AT, so the census must ride the
    // accessible name — the only place a screen-reader user hears the team.
    expect(delegating.getAttribute('aria-label')).toContain(
      '3 delegated agents working — Explore, general-purpose'
    );
    // three children fit the row budget — all named, no summary row
    expect(rail!.querySelectorAll('[data-delegation-child]')).toHaveLength(3);
    expect(rail!.textContent).toContain('Map conversion checklist coverage');
    expect(rail!.querySelector('[data-delegation-overflow]')).toBeNull();

    // the fan-out fixture summarizes past the budget instead of growing
    const fanout = screen.getByRole('button', {
      name: /^Open Audit the RAF scheduler across surfaces at the Agent altitude/,
    });
    const fanoutRail = fanout.querySelector('[data-session-delegation-rail]');
    expect(
      fanoutRail!.querySelectorAll('[data-delegation-child]')
    ).toHaveLength(2);
    expect(
      fanoutRail!.querySelector('[data-delegation-overflow]')?.textContent
    ).toBe('and 3 more working');

    // a non-delegating tile keeps meaningfulChange and shows no rail
    const plain = screen.getByRole('button', {
      name: 'Open Fix auth redirect loop at the Agent altitude',
    });
    expect(plain.querySelector('[data-session-delegation-rail]')).toBeNull();
  });

  it('hands an activated tile to Terminal without creating inline detail', () => {
    renderStudy();

    const tile = screen.getByRole('button', {
      name: 'Open Fix auth redirect loop at the Agent altitude',
    });
    fireEvent.click(tile);

    expect(tile).not.toHaveAttribute('aria-expanded');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByText('Agent · cortex-ehr / Fix auth redirect loop')
    ).toBeInTheDocument();
  });

  it('keeps loading, empty, and source-error tile states reviewable', () => {
    renderStudy();

    fireEvent.click(screen.getByRole('button', { name: 'Loading' }));
    expect(screen.getByLabelText('Loading Session tiles')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Empty' }));
    expect(screen.getByText('No open Sessions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Error' }));
    expect(
      screen.getByText('Session state could not refresh')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      screen.getByRole('button', {
        name: 'Open Fix auth redirect loop at the Agent altitude',
      })
    ).toBeInTheDocument();
  });
});
