/**
 * The Project and Session context menus over the one menu primitive's action
 * face (decision `0033`, BUG-052). These drive the real Radix popover the
 * strip mounts, so they hold the contract the tab strip relies on: one
 * highlighted row from the moment it opens, arrows that wrap, a drill-in
 * whose highlight and cursor agree, Escape that reports `trigger`, and the
 * BUG-051 identity rule that two same-labelled rows stay two rows.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StripContextMenu, type StripMenuItem } from './project-ribbon-menu';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

afterEach(cleanup);

const menu = () => screen.getByRole('menu', { name: 'Session actions' });
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(menu(), { key, ...init });
const activeRow = () =>
  screen.getAllByRole('menuitem').find(row => row.hasAttribute('data-active'));
/** The row's own label, without the submenu chevron or the muted note. */
const activeLabel = () =>
  activeRow()?.querySelector('span span')?.textContent ??
  activeRow()?.querySelector('span')?.textContent ??
  null;

function renderMenu(items: StripMenuItem[], onClose = vi.fn()) {
  render(
    <StripContextMenu
      x={10}
      y={10}
      color="#50E6FF"
      label="Session actions"
      items={items}
      onClose={onClose}
    />
  );
  return onClose;
}

describe('StripContextMenu readiness rows (ENG-026 N3)', () => {
  const items: StripMenuItem[] = [
    { id: 'rename', label: 'Rename…', onSelect: vi.fn() },
    {
      id: 'push-to-cloud',
      label: 'Push to cloud',
      announcedComing: 'run this Agent on an Exawatt-hosted plan (Cloud)',
    },
    { id: 'cloud', label: 'Cloud', note: 'Coming soon', onSelect: vi.fn() },
    { id: 'close', label: 'Close', danger: true, onSelect: vi.fn() },
  ];

  it('renders the announced row inert, outside the menuitem focus loop', () => {
    renderMenu(items);
    const announced = screen.getByTitle(
      'Coming soon: run this Agent on an Exawatt-hosted plan (Cloud)'
    );
    expect(announced.getAttribute('data-readiness')).toBe('announced');
    expect(announced.getAttribute('role')).toBeNull();
    expect(announced.querySelector('[inert]')).not.toBeNull();
    // keyboard navigation iterates menuitems only: the announced row is
    // skipped, not focus-trapped and not merely disabled
    expect(screen.getAllByRole('menuitem').map(row => row.textContent)).toEqual(
      ['Rename…', 'CloudComing soon', 'Close']
    );
    press('ArrowDown');
    expect(activeLabel()).toBe('Cloud');
  });

  it('a preview-surface entry row carries the muted Coming soon note and stays operable', () => {
    const onClose = renderMenu(items);
    const cloudRow = screen
      .getAllByRole('menuitem')
      .find(row => row.textContent?.startsWith('Cloud'))!;
    expect(cloudRow.textContent).toContain('Coming soon');
    fireEvent.click(cloudRow);
    expect(items[2].onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith('trigger');
  });

  it('the announced row cannot be operated', () => {
    const onClose = renderMenu(items);
    fireEvent.click(
      screen.getByTitle(
        'Coming soon: run this Agent on an Exawatt-hosted plan (Cloud)'
      )
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('StripContextMenu keyboard standing', () => {
  const targets = (): StripMenuItem[] => [
    { id: 'claude-opus', label: 'Claude Opus', onSelect: vi.fn() },
    { id: 'codex', label: 'Codex', onSelect: vi.fn() },
  ];
  const items = (children: StripMenuItem[]): StripMenuItem[] => [
    { id: 'rename', label: 'Rename…', onSelect: vi.fn() },
    { id: 'clone-to', label: 'Clone to…', children },
    { id: 'close', label: 'Close', danger: true, onSelect: vi.fn() },
  ];

  it('takes the keyboard and marks exactly one row from the moment it opens', () => {
    renderMenu(items(targets()));
    expect(document.activeElement).toBe(menu());
    expect(activeLabel()).toBe('Rename…');
    expect(
      screen.getAllByRole('menuitem').filter(r => r.hasAttribute('data-active'))
    ).toHaveLength(1);
    // one owner for the keyboard: the menu names its highlight, rows are
    // not tabstops of their own
    expect(menu().getAttribute('aria-activedescendant')).toBe(
      activeRow()!.id
    );
  });

  it('walks rows with the arrow keys and wraps at both ends', () => {
    renderMenu(items(targets()));
    press('ArrowDown');
    expect(activeLabel()).toBe('Clone to…');
    press('ArrowDown');
    expect(activeLabel()).toBe('Close');
    press('ArrowDown');
    expect(activeLabel()).toBe('Rename…');
    press('ArrowUp');
    expect(activeLabel()).toBe('Close');
    press('Home');
    expect(activeLabel()).toBe('Rename…');
    press('End');
    expect(activeLabel()).toBe('Close');
  });

  it('jumps by typing, the macOS way', () => {
    renderMenu(items(targets()));
    press('c');
    expect(activeLabel()).toBe('Clone to…');
    press('c');
    expect(activeLabel()).toBe('Close');
  });

  it('drills in on the first ACTION and keeps highlight and cursor on one row', () => {
    renderMenu(items(targets()));
    press('ArrowDown');
    press('ArrowRight');
    expect(activeLabel()).toBe('Claude Opus');
    expect(menu().getAttribute('aria-activedescendant')).toBe(
      activeRow()!.id
    );
    press('ArrowDown');
    expect(activeLabel()).toBe('Codex');
    press('ArrowLeft');
    expect(activeLabel()).toBe('Rename…');
  });

  it('selects the highlighted target with Enter, closing before it runs', () => {
    const children = targets();
    const calls: string[] = [];
    (children[0].onSelect as ReturnType<typeof vi.fn>).mockImplementation(
      () => calls.push('select')
    );
    const onClose = renderMenu(
      items(children),
      vi.fn(() => calls.push('close'))
    );
    press('ArrowDown');
    press('ArrowRight');
    press('Enter');
    expect(onClose).toHaveBeenCalledWith('trigger');
    expect(calls).toEqual(['close', 'select']);
  });

  it('reports Escape as a return to the trigger, once', () => {
    const onClose = renderMenu(items(targets()));
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('trigger');
  });

  it('backs out of a submenu on Escape instead of closing', () => {
    const onClose = renderMenu(items(targets()));
    press('ArrowDown');
    press('ArrowRight');
    expect(activeLabel()).toBe('Claude Opus');
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(activeLabel()).toBe('Rename…');
  });

  it('hands Tab to the strip as next / previous', () => {
    const onClose = renderMenu(items(targets()));
    press('Tab');
    expect(onClose).toHaveBeenCalledWith('next');
  });

  it('hands ⇧Tab to the strip as previous', () => {
    const onClose = renderMenu(items(targets()));
    press('Tab', { shiftKey: true });
    expect(onClose).toHaveBeenCalledWith('previous');
  });
});

describe('StripContextMenu row identity (BUG-051)', () => {
  // Two setups on one model share a label BY DESIGN: the launcher names a
  // row after its model and puts the reasoning effort on the quiet note. The
  // menu used to key rows on that label, so Clone to… on a Codex Session
  // highlighted BOTH `GPT-5.6 Codex` rows at once (operator, 2026-08-17).
  const sameLabel = (): StripMenuItem[] => [
    {
      id: 'agent:codex:gpt-5.6:high',
      label: 'GPT-5.6 Codex',
      detail: 'High',
      accessibleLabel: 'Clone to Codex, GPT-5.6 Codex, High',
      onSelect: vi.fn(),
    },
    {
      id: 'agent:codex:gpt-5.6:medium',
      label: 'GPT-5.6 Codex',
      detail: 'Medium',
      accessibleLabel: 'Clone to Codex, GPT-5.6 Codex, Medium',
      onSelect: vi.fn(),
    },
  ];

  const renderTargets = (targets: StripMenuItem[]) =>
    renderMenu([{ id: 'clone-to', label: 'Clone to…', children: targets }]);

  const activeRows = () =>
    screen
      .getAllByRole('menuitem')
      .filter(row => row.hasAttribute('data-active'));

  it('highlights exactly one of two same-labelled rows', () => {
    renderTargets(sameLabel());
    press('ArrowRight');
    expect(activeRows()).toHaveLength(1);
    expect(activeRows()[0].textContent).toContain('High');

    press('ArrowDown');
    expect(activeRows()).toHaveLength(1);
    expect(activeRows()[0].textContent).toContain('Medium');
  });

  it('keeps two same-labelled rows independently selectable', () => {
    const targets = sameLabel();
    renderTargets(targets);
    press('ArrowRight');
    press('ArrowDown');
    fireEvent.click(activeRows()[0]);
    expect(targets[0].onSelect).not.toHaveBeenCalled();
    expect(targets[1].onSelect).toHaveBeenCalled();
  });

  it('separates them for a screen reader too', () => {
    renderTargets(sameLabel());
    press('ArrowRight');
    expect(
      screen.getByRole('menuitem', {
        name: 'Clone to Codex, GPT-5.6 Codex, High',
      })
    ).not.toBe(
      screen.getByRole('menuitem', {
        name: 'Clone to Codex, GPT-5.6 Codex, Medium',
      })
    );
  });
});
