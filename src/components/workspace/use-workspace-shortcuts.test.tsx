import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultShortcuts, shortcutRegistry } from '@/lib/shortcuts';
import {
  useWorkspaceShortcuts,
  type WorkspaceShortcutActions,
} from './use-workspace-shortcuts';

function actions(): WorkspaceShortcutActions {
  const yes = () => vi.fn(() => true);
  return {
    launchShell: yes(),
    newProject: yes(),
    closeActive: yes(),
    selectIndex: yes(),
    selectTabOrdinal: yes(),
    cycle: yes(),
    jumpAttention: yes(),
    activateCommandAltitude: yes(),
    openPalette: yes(),
    togglePin: yes(),
    toggleRoadmap: yes(),
    renameActive: yes(),
    openHelp: yes(),
    toggleFocus: vi.fn(() => true),
    focusTerminal: vi.fn(() => true),
  };
}

describe('workspace focus shortcuts', () => {
  beforeEach(() => {
    for (const definition of defaultShortcuts) {
      shortcutRegistry.register({ ...definition, action: vi.fn() });
    }
  });

  afterEach(() => {
    for (const definition of defaultShortcuts) {
      shortcutRegistry.unregister(definition.id);
    }
  });

  it('cycles tabs before xterm can consume shifted bracket commands', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));
    const terminal = document.createElement('textarea');
    terminal.className = 'xterm-helper-textarea';
    terminal.addEventListener('keydown', event => event.preventDefault());
    document.body.append(terminal);

    const previous = new KeyboardEvent('keydown', {
      key: '{',
      code: 'BracketLeft',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    terminal.dispatchEvent(previous);
    expect(handlers.cycle).toHaveBeenLastCalledWith(-1);
    expect(previous.defaultPrevented).toBe(true);

    const next = new KeyboardEvent('keydown', {
      key: '}',
      code: 'BracketRight',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    terminal.dispatchEvent(next);
    expect(handlers.cycle).toHaveBeenLastCalledWith(1);
    expect(handlers.cycle).toHaveBeenCalledTimes(2);
    terminal.remove();
  });

  it('leaves unshifted command brackets to route history', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));

    fireEvent.keyDown(window, {
      key: '[',
      code: 'BracketLeft',
      metaKey: true,
    });
    expect(handlers.cycle).not.toHaveBeenCalled();
  });

  it('owns absolute altitude commands (⌘⇧digit) before xterm and never treats them as ordinals', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));
    const terminal = document.createElement('textarea');
    terminal.className = 'xterm-helper-textarea';
    terminal.addEventListener('keydown', event => event.preventDefault());
    document.body.append(terminal);

    for (const [digit, shifted, target] of [
      ['1', '!', 'terminal'],
      ['2', '@', 'sessions'],
      ['3', '#', 'spatial'],
    ] as const) {
      // event.key is the layout-dependent shifted symbol; matching must ride
      // the physical Digit code (D18)
      terminal.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: shifted,
          code: `Digit${digit}`,
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      expect(handlers.activateCommandAltitude).toHaveBeenLastCalledWith(target);
    }
    expect(handlers.selectIndex).not.toHaveBeenCalled();
    expect(handlers.selectTabOrdinal).not.toHaveBeenCalled();
    terminal.remove();
  });

  it('jumps to tab ordinals on bare command digits from inside xterm (D18)', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));
    const terminal = document.createElement('textarea');
    terminal.className = 'xterm-helper-textarea';
    terminal.addEventListener('keydown', event => event.preventDefault());
    document.body.append(terminal);

    terminal.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '2',
        code: 'Digit2',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(handlers.selectTabOrdinal).toHaveBeenCalledWith(1);
    expect(handlers.activateCommandAltitude).not.toHaveBeenCalled();
    expect(handlers.selectIndex).not.toHaveBeenCalled();
    terminal.remove();
  });

  it('moves fixed Project ordinals to command-option digits', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));

    fireEvent.keyDown(window, {
      key: '¢',
      code: 'Digit4',
      metaKey: true,
      altKey: true,
    });
    expect(handlers.selectIndex).toHaveBeenCalledWith(3);
    expect(handlers.activateCommandAltitude).not.toHaveBeenCalled();
  });

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
