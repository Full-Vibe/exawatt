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
