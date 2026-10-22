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
    engine: { harness: 'claude', label: 'Claude Code' },
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
    engine: { harness: 'codex', label: 'Codex' },
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

  it('names the task, each axis value and each option by id', async () => {
    const permission: DetailAxis = {
      id: 'permission',
      label: 'Permission',
      value: 'unrestricted',
      options: [
        { id: 'prompt', label: 'Ask first', description: 'Asks first.' },
        { id: 'unrestricted', label: 'YOLO', description: 'No approvals.' },
      ],
      onChange: vi.fn(),
    };
    const detailAxes = [...axes, permission];
    render(
      <AgentLauncher
        setups={setups}
        selectedId="claude-opus"
        state="ready"
        axes={detailAxes}
        task=""
        onTaskChange={vi.fn()}
        onSelect={vi.fn()}
        onOpenCatalog={vi.fn()}
        onStart={vi.fn()}
      />
    );
    expect(document.querySelector('[data-launcher-task]')?.tagName).toBe(
      'TEXTAREA'
    );
    const tile = document.querySelector<HTMLElement>(
      '[data-setup-id="claude-opus"]'
    )!;
    act(() => tile.focus());
    fireEvent.keyDown(tile, { key: 'ArrowDown' });
    const trigger = (id: string) =>
      document.querySelector(
        `[data-detail-axis="${id}"] [data-option-menu-trigger]`
      );
    await waitFor(() => expect(trigger('engine')).not.toBeNull());
    for (const axis of detailAxes) {
      expect(trigger(axis.id)).toHaveAttribute(
        'data-option-menu-value',
        axis.value!
      );
    }

    fireEvent.click(trigger('permission')!);
    await waitFor(() =>
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    );
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    expect(
      options.map(option => option.getAttribute('data-option-id'))
    ).toEqual(permission.options.map(option => option.id));
    for (const option of options) {
      expect(option.querySelector('[data-option-description]')).not.toBeNull();
    }
    expect(
      document.querySelector('[role="option"][aria-selected="true"]')
    ).toHaveAttribute('data-option-id', permission.value!);
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
