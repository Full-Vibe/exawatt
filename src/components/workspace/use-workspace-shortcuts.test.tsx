import { fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useWorkspaceShortcuts,
  type WorkspaceShortcutActions,
} from './use-workspace-shortcuts';

function actions(): WorkspaceShortcutActions {
  const yes = vi.fn(() => true);
  return {
    launchShell: yes,
    newProject: yes,
    closeActive: yes,
    selectIndex: yes,
    cycle: yes,
    jumpAttention: yes,
    toggleRegime: yes,
    openPalette: yes,
    toggleOverview: yes,
    togglePin: yes,
    toggleRoadmap: yes,
    renameActive: yes,
    openHelp: yes,
    toggleFocus: vi.fn(() => true),
    focusTerminal: vi.fn(() => true),
  };
}

describe('workspace focus shortcuts', () => {
  it('uses F6 to cross the terminal/chrome boundary', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));
    const terminal = document.createElement('textarea');
    terminal.className = 'xterm-helper-textarea';
    document.body.append(terminal);

    const event = new KeyboardEvent('keydown', {
      key: 'F6',
      bubbles: true,
      cancelable: true,
    });
    terminal.dispatchEvent(event);
    expect(handlers.toggleFocus).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    terminal.remove();
  });

  it('returns Escape from chrome but leaves terminal Escape to the TUI', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));
    const chrome = document.createElement('button');
    const terminal = document.createElement('textarea');
    terminal.className = 'xterm-helper-textarea';
    document.body.append(chrome, terminal);

    fireEvent.keyDown(chrome, { key: 'Escape' });
    expect(handlers.focusTerminal).toHaveBeenCalledOnce();
    fireEvent.keyDown(terminal, { key: 'Escape' });
    expect(handlers.focusTerminal).toHaveBeenCalledOnce();
    chrome.remove();
    terminal.remove();
  });

  it('lets a dialog own Escape', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);

    fireEvent.keyDown(button, { key: 'Escape' });
    expect(handlers.focusTerminal).not.toHaveBeenCalled();
    dialog.remove();
  });
});
