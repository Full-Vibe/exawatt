import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentLauncher } from './agent-launcher';
import type { DetailAxis } from './setup-detail';
import type { LauncherSetup } from './launcher-model';

const setups: LauncherSetup[] = [
  {
    id: 'claude-opus',
    role: 'coding',
    name: null,
    engine: { harness: 'claude', label: 'Claude Code', color: '#F59E75' },
    model: 'Claude Opus 4.6',
    modelVariant: '1M context',
    vendor: null,
    thinking: 'High',
    reason: 'pinned',
    launchCount: 0,
    pinned: true,
    available: true,
  },
  {
    id: 'codex',
    role: 'coding',
    name: null,
    engine: { harness: 'codex', label: 'Codex', color: '#DCEBFF' },
    model: 'GPT-5.3 Codex',
    modelVariant: null,
    vendor: null,
    thinking: 'Extra high',
    reason: 'frecent',
    launchCount: 2,
    pinned: false,
    available: true,
  },
];

const axes: DetailAxis[] = [
  {
    id: 'engine',
    label: 'Engine',
    value: 'claude',
    options: [{ id: 'claude', label: 'Claude Code' }],
    onChange: vi.fn(),
  },
  {
    id: 'model',
    label: 'Model',
    value: 'opus',
    options: [{ id: 'opus', label: 'Claude Opus 4.6' }],
    onChange: vi.fn(),
  },
];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

function renderLauncher(onSelect = vi.fn()) {
  render(
    <AgentLauncher
      setups={setups}
      selectedId="claude-opus"
      state="ready"
      axes={axes}
      task=""
      onTaskChange={vi.fn()}
      onSelect={onSelect}
      onOpenCatalog={vi.fn()}
      onStart={vi.fn()}
    />
  );
  return { onSelect };
}

describe('AgentLauncher keyboard navigation', () => {
  it('keeps ranking provenance out of the visible card copy', () => {
    renderLauncher();
    const tile = screen.getByRole('radio', {
      name: /Claude Code, Claude Opus 4\.6.*pinned/,
    });

    expect(tile).toHaveTextContent('Claude Opus 4.6');
    expect(tile).toHaveTextContent('1M context');
    expect(tile).toHaveTextContent('High');
    expect(tile).not.toHaveTextContent(/Suggested|Pinned|Used (?:once|\d)/);
    expect(
      tile.querySelector('[data-recommendation-reason="pinned"]')
    ).toHaveAttribute('title', 'Pinned in this Project');
  });

  it('opens the drawer and focuses its first axis when Down is pressed on a tile', async () => {
    renderLauncher();
    const tile = screen.getByRole('radio', {
      name: /Claude Code, Claude Opus 4\.6/,
    });
    act(() => tile.focus());

    const event = createEvent.keyDown(tile, { key: 'ArrowDown' });
    fireEvent(tile, event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByLabelText('Engine: Claude Code')).toHaveFocus();
    });
    expect(document.querySelector('[data-setup-detail]')).toHaveAttribute(
      'aria-hidden',
      'false'
    );
  });

  it('retains horizontal selection and focus movement between tiles', () => {
    const { onSelect } = renderLauncher();
    const tile = screen.getByRole('radio', {
      name: /Claude Code, Claude Opus 4\.6/,
    });
    act(() => tile.focus());

    fireEvent.keyDown(tile, { key: 'ArrowRight' });

    expect(onSelect).toHaveBeenCalledWith('codex');
    expect(
      screen.getByRole('radio', { name: /Codex, GPT-5\.3 Codex/ })
    ).toHaveFocus();
    expect(document.querySelector('[data-setup-detail]')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });
});
