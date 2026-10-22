/**
 * cmdk group ordering (ENG-016 FIX-007).
 *
 * ⌘K ranks items inside a group with our band filter, and cmdk orders the
 * GROUPS by each group's best item score. That ordering silently stopped
 * working after any row unmounted: cmdk adds an item's id to its group's id
 * set on mount but never removes it on unmount, so the group score
 *
 *     ids.forEach(id => score = Math.max(filteredItems.get(id), score))
 *
 * reads `undefined` for the stale id and becomes NaN. Every comparison
 * against NaN is false, so the group sort degenerates to arbitrary order and
 * an exact-name row can render below a fuzzy one in another group. Rows
 * unmount constantly here — Sessions and Projects both arrive and change
 * asynchronously — which is why the operator saw it intermittently
 * (`5645d689`, `452c284c`).
 *
 * Pinned at this level because the defect is in the vendored library's
 * bookkeeping, not in our filter: `patches/cmdk.patch`.
 */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: originalScrollIntoView,
  });
});
afterEach(cleanup);

/** "Sessions" is authored FIRST and only fuzzy-matches; "Projects" is
 *  authored second and holds the exact match. Correct order puts Projects
 *  first. The button unmounts one Session row, which is what used to poison
 *  the Sessions group's score. */
function Harness() {
  const [sessions, setSessions] = useState(['gpagent groundwork', 'unrelated']);
  return (
    <div>
      <button onClick={() => setSessions(['gpagent groundwork'])}>drop</button>
      <Command shouldFilter>
        <CommandInput placeholder="search" />
        <CommandList>
          <CommandGroup heading="Sessions">
            {sessions.map(s => (
              <CommandItem key={s} value={s}>
                {s}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Projects">
            <CommandItem value="gpagent">gpagent</CommandItem>
            <CommandItem value="Add project">Add project</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

const headings = () =>
  Array.from(document.querySelectorAll('[cmdk-group-heading]')).map(
    el => el.textContent
  );

describe('cmdk group ordering (FIX-007)', () => {
  it('orders groups by best item score', () => {
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText('search'), {
      target: { value: 'gpagent' },
    });
    expect(headings()).toEqual(['Projects', 'Sessions']);
  });

  it('keeps ordering after a row unmounts (the stale-id regression)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('drop'));
    fireEvent.change(screen.getByPlaceholderText('search'), {
      target: { value: 'gpagent' },
    });
    expect(headings()).toEqual(['Projects', 'Sessions']);
  });
});

/**
 * Disabled rows (BUG-313). cmdk sorted only the rows the cursor can land on
 * and appended each to the end of its group, so a disabled row was never
 * moved and ended up above every enabled row in its group, whatever it
 * scored: "unread" listed a disabled "Move left" above "Mark unread", while
 * ⏎ ran Mark unread. The rule now: a disabled row ranks by its score like any
 * other row and loses every tie to an enabled one, inside a group and between
 * groups by their best row. The cursor still skips it.
 *
 * Scores come from a table through cmdk's own `filter` prop, so each case
 * states exactly how well every row matches.
 */
interface ScoredRow {
  value: string;
  score: number;
  disabled?: boolean;
}

function ScoredHarness({
  groups,
}: {
  groups: ReadonlyArray<{ heading: string; rows: readonly ScoredRow[] }>;
}) {
  const scores = new Map(
    groups.flatMap(group => group.rows.map(row => [row.value, row.score]))
  );
  return (
    <Command shouldFilter filter={value => scores.get(value) ?? 0}>
      <CommandInput placeholder="search" />
      <CommandList>
        {groups.map(group => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.rows.map(row => (
              <CommandItem
                key={row.value}
                value={row.value}
                disabled={row.disabled}
              >
                {row.value}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

const rowOrder = () =>
  Array.from(document.querySelectorAll('[cmdk-item]')).map(
    el => el.textContent
  );
const cursorRow = () =>
  document.querySelector('[cmdk-item][aria-selected="true"]')?.textContent;
const search = (query: string) =>
  fireEvent.change(screen.getByPlaceholderText('search'), {
    target: { value: query },
  });

describe('cmdk ranks disabled rows by their score (BUG-313)', () => {
  it('ranks a weakly matching disabled row below a better enabled match', () => {
    render(
      <ScoredHarness
        groups={[
          {
            heading: 'Session',
            rows: [
              { value: 'Move left', score: 0.02, disabled: true },
              { value: 'Rename', score: 0.3 },
              { value: 'Mark unread', score: 6 },
            ],
          },
        ]}
      />
    );
    search('unread');
    expect(rowOrder()).toEqual(['Mark unread', 'Rename', 'Move left']);
    expect(cursorRow()).toBe('Mark unread');
  });

  it('ranks a disabled row that matches best above weaker enabled rows', () => {
    render(
      <ScoredHarness
        groups={[
          {
            heading: 'Session',
            rows: [
              { value: 'Rename', score: 0.3 },
              { value: 'Move left', score: 8, disabled: true },
            ],
          },
        ]}
      />
    );
    search('move left');
    expect(rowOrder()).toEqual(['Move left', 'Rename']);
    // the cursor never lands on it
    expect(cursorRow()).toBe('Rename');
  });

  it('gives a tie to the enabled row', () => {
    render(
      <ScoredHarness
        groups={[
          {
            heading: 'Session',
            rows: [
              { value: 'Move left', score: 7, disabled: true },
              { value: 'Move right', score: 7 },
            ],
          },
        ]}
      />
    );
    search('move');
    expect(rowOrder()).toEqual(['Move right', 'Move left']);
    expect(cursorRow()).toBe('Move right');
  });

  it('gives a tie between groups to the group whose best row is enabled', () => {
    render(
      <ScoredHarness
        groups={[
          {
            heading: 'Session',
            rows: [{ value: 'Move Session left', score: 8, disabled: true }],
          },
          {
            heading: 'Project',
            rows: [{ value: 'Move Project left', score: 8 }],
          },
        ]}
      />
    );
    search('move left');
    expect(headings()).toEqual(['Project', 'Session']);
    expect(cursorRow()).toBe('Move Project left');
  });
});
