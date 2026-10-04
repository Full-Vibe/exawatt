// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent, type ExawattAgent } from '@exawatt/core';
import { shortcutRegistry } from '@/lib/shortcuts';
import { JUMP_ATTENTION_EVENT } from '@/components/workspace/session-jump';
import { getWorkspaceCommandAvailability } from '@/components/workspace/workspace-command-availability';
import {
  fleetAttentionSignals,
  useFleetAttention,
} from './use-fleet-attention';

const corpus = Object.fromEntries(
  [
    createAgent({
      id: 'hard',
      name: 'Hard request',
      sessionKey: 'pty-hard',
      attention: {
        kind: 'blocked',
        request: 'blocking',
        since: 30,
        unread: false,
      },
    }),
    createAgent({
      id: 'question',
      name: 'Working question',
      sessionKey: 'pty-question',
      status: 'working',
      attention: { kind: 'blocked', request: 'working', since: 20 },
    }),
    createAgent({
      id: 'result',
      name: 'Unread result',
      sessionKey: 'pty-result',
      status: 'complete',
      attention: { kind: 'turn-end', since: 10, unread: true },
    }),
    createAgent({
      id: 'quiet',
      name: 'Read result',
      sessionKey: 'pty-quiet',
      status: 'complete',
      attention: { kind: 'turn-end', since: 5, unread: false },
    }),
    createAgent({
      id: 'unreported',
      name: 'No request evidence',
      sessionKey: 'pty-unknown',
      status: 'blocked',
    }),
  ].map(agent => [agent.id, agent])
);

function Harness({
  agents = corpus,
  open = () => {},
}: {
  agents?: Record<string, ExawattAgent>;
  open?: (id: string) => void;
}) {
  const [selected, select] = useState<string | null>(null);
  useFleetAttention({
    agents,
    selectedAgentId: selected,
    onSelectAgent: select,
  });
  return (
    <>
      <input aria-label="search" />
      <output data-selected>{selected}</output>
      {selected && (
        <button
          data-open-agent={selected}
          onClick={() => open(agents[selected].sessionKey)}
        >
          Open
        </button>
      )}
    </>
  );
}

beforeEach(() => {
  shortcutRegistry.register({
    id: 'workspace-jump-attention',
    label: 'Attention',
    keys: { key: 'j', modifiers: ['meta'] },
    category: 'workspace',
    contexts: ['workspace'],
    action: () => {},
  });
});
afterEach(() => {
  cleanup();
  shortcutRegistry.unregister('workspace-jump-attention');
  shortcutRegistry.loadOverrides([]);
  shortcutRegistry.setContexts([]);
});
const jump = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: 'j',
    metaKey: true,
  });

describe('Fleet attention command', () => {
  it('walks the shared priority pass, focuses native activation, and never reads on selection', () => {
    const open = vi.fn();
    const { container } = render(<Harness open={open} />);
    const selected = () =>
      container.querySelector('[data-selected]')?.textContent;
    jump();
    expect(selected()).toBe('hard');
    expect(document.activeElement?.getAttribute('data-open-agent')).toBe(
      'hard'
    );
    expect(open).not.toHaveBeenCalled();
    jump();
    expect(selected()).toBe('question');
    jump();
    expect(selected()).toBe('result');
    expect(corpus.result.attention?.unread).toBe(true);
    fireEvent.click(document.activeElement!);
    expect(open).toHaveBeenCalledWith('pty-result');
    jump();
    expect(selected()).toBe('hard');
  });

  it('native dispatch uses the same pass and filtered source corpus', () => {
    const { container } = render(
      <Harness
        agents={{ result: corpus.result, unreported: corpus.unreported }}
      />
    );
    expect(
      getWorkspaceCommandAvailability().commands['jump-attention'].available
    ).toBe(true);
    fireEvent(window, new CustomEvent(JUMP_ATTENTION_EVENT));
    expect(container.querySelector('[data-selected]')?.textContent).toBe(
      'result'
    );
    expect(fleetAttentionSignals({ unreported: corpus.unreported })).toEqual(
      {}
    );
  });

  it('preserves editable, modal and empty-queue ownership', () => {
    const { container, getByRole, rerender } = render(<Harness />);
    getByRole('textbox').focus();
    jump();
    expect(container.querySelector('[data-selected]')?.textContent).toBe('');
    document.body.focus();
    shortcutRegistry.setContexts(['modal-open']);
    fireEvent.keyDown(document.body, { key: 'j', metaKey: true });
    fireEvent(window, new CustomEvent(JUMP_ATTENTION_EVENT));
    expect(container.querySelector('[data-selected]')?.textContent).toBe('');
    shortcutRegistry.setContexts([]);
    rerender(<Harness agents={{ quiet: corpus.quiet }} />);
    const event = new KeyboardEvent('keydown', {
      key: 'j',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('resolves the customized shortcut instead of hard-coding Cmd J', () => {
    const { container } = render(<Harness />);
    shortcutRegistry.loadOverrides([
      {
        shortcutId: 'workspace-jump-attention',
        keys: { key: 'u', modifiers: ['meta'] },
      },
    ]);
    jump();
    expect(container.querySelector('[data-selected]')?.textContent).toBe('');
    fireEvent.keyDown(document.body, { key: 'u', metaKey: true });
    expect(container.querySelector('[data-selected]')?.textContent).toBe(
      'hard'
    );
  });
});
