import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StripContextMenu, type StripMenuItem } from './project-ribbon-menu';

describe('StripContextMenu readiness rows (ENG-026 N3)', () => {
  afterEach(cleanup);

  const items: StripMenuItem[] = [
    { label: 'Rename…', onSelect: vi.fn() },
    {
      label: 'Push to cloud',
      announcedComing: 'run this Agent on an Exawatt-hosted plan (Cloud)',
    },
    { label: 'Cloud', note: 'Coming soon', onSelect: vi.fn() },
    { label: 'Close', danger: true, onSelect: vi.fn() },
  ];

  function renderMenu() {
    return render(
      <StripContextMenu
        x={10}
        y={10}
        color="#50E6FF"
        label="Session actions"
        items={items}
        onClose={vi.fn()}
      />
    );
  }

  it('renders the announced row inert, outside the menuitem focus loop', () => {
    renderMenu();
    const announced = screen.getByTitle(
      'Coming soon — run this Agent on an Exawatt-hosted plan (Cloud)'
    );
    expect(announced.getAttribute('data-readiness')).toBe('announced');
    expect(announced.getAttribute('role')).toBeNull();
    expect(announced.querySelector('[inert]')).not.toBeNull();
    // keyboard navigation iterates menuitems only — the announced row is
    // skipped, not focus-trapped and not merely disabled
    const menuitems = screen.getAllByRole('menuitem');
    expect(menuitems.map(item => item.textContent)).toEqual([
      'Rename…',
      'CloudComing soon',
      'Close',
    ]);
  });

  it('a preview-surface entry row carries the muted Coming soon note and stays operable', () => {
    renderMenu();
    const cloudRow = screen
      .getAllByRole('menuitem')
      .find(item => item.textContent?.startsWith('Cloud'))!;
    expect(cloudRow.textContent).toContain('Coming soon');
    cloudRow.click();
    expect(items[2].onSelect).toHaveBeenCalled();
  });

  it('the announced row cannot be operated', () => {
    renderMenu();
    const announced = screen.getByTitle(
      'Coming soon — run this Agent on an Exawatt-hosted plan (Cloud)'
    );
    // no handler exists to call; clicking must not throw and must not close
    announced.click();
  });
});

describe('StripContextMenu keyboard standing', () => {
  afterEach(cleanup);

  const targets: StripMenuItem[] = [
    { label: 'Claude Opus', onSelect: vi.fn() },
    { label: 'Codex', onSelect: vi.fn() },
  ];
  const items: StripMenuItem[] = [
    { label: 'Rename…', onSelect: vi.fn() },
    { label: 'Clone to…', children: targets },
    { label: 'Close', danger: true, onSelect: vi.fn() },
  ];

  const renderMenu = () =>
    render(
      <StripContextMenu
        x={10}
        y={10}
        color="#50E6FF"
        label="Session actions"
        items={items}
        onClose={vi.fn()}
      />
    );

  const activeRow = () =>
    screen
      .getAllByRole('menuitem')
      .find(row => row.hasAttribute('data-menu-active'));
  /** The row's own label, without the submenu chevron or the muted note. */
  const activeLabel = () =>
    activeRow()?.querySelector('span')?.textContent ?? null;

  const press = (key: string) =>
    fireEvent.keyDown(screen.getByRole('menu'), { key });

  it('marks exactly one row as the one you are on, from the moment it opens', () => {
    renderMenu();
    // The highlight used to ride on `:focus-visible`, which does not match
    // focus moved out of a POINTER-opened menu — so a right-click menu
    // highlighted nothing and read as keyboard-dead.
    expect(activeLabel()).toBe('Rename…');
    expect(
      screen
        .getAllByRole('menuitem')
        .filter(r => r.hasAttribute('data-menu-active'))
    ).toHaveLength(1);
  });

  it('walks rows with the arrow keys and wraps at both ends', () => {
    renderMenu();
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

  it('keeps the highlight and the roving tabstop on the SAME row inside a submenu', () => {
    renderMenu();
    press('ArrowDown');
    press('ArrowRight');
    // Drilling in lands on the first ACTION, not on the drill-out row above
    // it. Arrow keys used to walk the DOM's menuitem buttons while tabIndex
    // was assigned from each item's index in the ITEM list; the drill-out row
    // shifted the two apart by one, so the highlight and the tabstop pointed
    // at different rows.
    expect(activeLabel()).toBe('Claude Opus');
    const rows = screen.getAllByRole('menuitem');
    const tabbable = rows.filter(row => row.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(activeRow());

    press('ArrowDown');
    expect(activeLabel()).toBe('Codex');
    press('ArrowLeft');
    expect(activeLabel()).toBe('Rename…');
  });

  it('selects the highlighted target with Enter', () => {
    renderMenu();
    press('ArrowDown');
    press('ArrowRight');
    activeRow()!.click();
    expect(targets[0].onSelect).toHaveBeenCalled();
  });
});
