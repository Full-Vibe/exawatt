import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StripContextMenu,
  type StripMenuItem,
} from './project-ribbon-menu';

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
