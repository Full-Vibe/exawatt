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
      4
    );
    const workingTile = screen.getByRole('button', {
      name: 'Open Complete MMHC conversion and secure BAA in Terminal',
    });
    expect(within(workingTile).queryByText('Working')).not.toBeInTheDocument();
    expect(
      within(workingTile).queryByText('Claude Code')
    ).not.toBeInTheDocument();
    expect(
      workingTile.querySelector('[data-session-goal-summary]')
    ).toHaveClass('font-sans', 'text-chrome-label', 'font-normal');
    expect(within(workingTile).getByText('42s ago')).toBeInTheDocument();
    expect(screen.getByText('2 Agents')).toBeInTheDocument();
    expect(screen.queryByText('Recovered')).not.toBeInTheDocument();
  });

  it('hands an activated tile to Terminal without creating inline detail', () => {
    renderStudy();

    const tile = screen.getByRole('button', {
      name: 'Open Fix auth redirect loop in Terminal',
    });
    fireEvent.click(tile);

    expect(tile).not.toHaveAttribute('aria-expanded');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByText('Terminal · cortex-ehr / Fix auth redirect loop')
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
        name: 'Open Fix auth redirect loop in Terminal',
      })
    ).toBeInTheDocument();
  });
});
