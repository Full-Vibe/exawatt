import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LaunchConfigurationRibbon,
  type LaunchConfigurationRibbonItem,
} from './launch-configuration-ribbon';

const items: LaunchConfigurationRibbonItem[] = [
  {
    id: 'reviewer',
    label: 'Reviewer',
    detail: 'Claude Code',
    accessibleLabel: 'Reviewer, Claude Code, Opus 4.1, high effort',
    source: 'claude',
    named: true,
    pinned: true,
  },
  {
    id: 'codex',
    label: 'GPT-5 · High',
    detail: 'Codex',
    accessibleLabel: 'Codex, GPT-5, high effort',
    source: 'codex',
  },
  {
    id: 'offline',
    label: 'Deep review',
    detail: 'OpenCode',
    accessibleLabel: 'Deep review, OpenCode, Kimi K2',
    source: 'opencode',
    available: false,
    unavailableReason: 'OpenCode is not installed',
  },
  {
    id: 'shell',
    label: 'Shell',
    accessibleLabel: 'Shell terminal',
    source: 'shell',
  },
];

let resizeCallback: ResizeObserverCallback | null = null;

class ResizeObserverStub implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

function setup(selectedId = 'reviewer', alwaysShowAll = true) {
  const onSelect = vi.fn();
  const onCustomize = vi.fn();
  const onShowAll = vi.fn();
  render(
    <LaunchConfigurationRibbon
      items={items}
      selectedId={selectedId}
      onSelect={onSelect}
      onCustomize={onCustomize}
      onShowAll={onShowAll}
      alwaysShowAll={alwaysShowAll}
    />
  );
  return { onSelect, onCustomize, onShowAll };
}

describe('LaunchConfigurationRibbon', () => {
  it('exposes one radio tab stop and complete labels for every visual state', () => {
    setup();

    const radios = screen.getAllByRole('radio');
    expect(radios.filter(radio => radio.tabIndex === 0)).toHaveLength(1);
    expect(
      screen.getByRole('radio', {
        name: 'Reviewer, Claude Code, Opus 4.1, high effort, named configuration, pinned',
      })
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('radio', {
        name: 'Deep review, OpenCode, Kimi K2, unavailable: OpenCode is not installed',
      })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('radio', { name: 'Shell terminal' })
    ).toHaveAttribute('data-shell', 'true');

    const reviewer = screen.getByRole('radio', {
      name: 'Reviewer, Claude Code, Opus 4.1, high effort, named configuration, pinned',
    });
    act(() => reviewer.focus());
    expect(reviewer).toHaveAttribute('data-focused', 'true');
  });

  it('selects with arrow keys, wraps, and keeps unavailable configurations inspectable', () => {
    const { onSelect } = setup('codex');
    const codex = screen.getByRole('radio', {
      name: 'Codex, GPT-5, high effort',
    });

    act(() => codex.focus());
    act(() => fireEvent.keyDown(codex, { key: 'ArrowRight' }));
    expect(onSelect).toHaveBeenLastCalledWith('offline');

    const offline = screen.getByRole('radio', {
      name: 'Deep review, OpenCode, Kimi K2, unavailable: OpenCode is not installed',
    });
    act(() => fireEvent.keyDown(offline, { key: 'ArrowRight' }));
    expect(onSelect).toHaveBeenLastCalledWith('shell');

    const shell = screen.getByRole('radio', { name: 'Shell terminal' });
    act(() => fireEvent.keyDown(shell, { key: 'ArrowRight' }));
    expect(onSelect).toHaveBeenLastCalledWith('reviewer');
  });

  it('selects unavailable items for inspection and exposes compact secondary actions', () => {
    const { onSelect, onCustomize, onShowAll } = setup();

    fireEvent.click(
      screen.getByRole('radio', {
        name: 'Deep review, OpenCode, Kimi K2, unavailable: OpenCode is not installed',
      })
    );
    expect(onSelect).toHaveBeenCalledWith('offline');

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'All launch configurations' })
    );
    expect(onCustomize).toHaveBeenCalledOnce();
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it('reveals the catalog action when the intrinsic row overflows', () => {
    setup('reviewer', false);
    expect(
      screen.queryByRole('button', { name: 'All launch configurations' })
    ).not.toBeInTheDocument();

    const viewport = document.querySelector(
      '[data-launch-configuration-viewport]'
    ) as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 760 },
    });
    act(() => resizeCallback?.([], {} as ResizeObserver));

    expect(
      screen.getByRole('button', { name: 'All launch configurations' })
    ).toBeVisible();
  });
});
