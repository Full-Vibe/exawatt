import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultShortcuts, shortcutRegistry } from '@/lib/shortcuts';
import {
  useFixedWorkspaceShortcuts,
  useWorkspaceShortcuts,
  type WorkspaceShortcutActions,
} from './use-workspace-shortcuts';

function actions(): WorkspaceShortcutActions {
  const yes = () => vi.fn(() => true);
  return {
    launchShell: yes(),
    newAgent: yes(),
    newProject: yes(),
    closeActive: yes(),
    reopenClosed: yes(),
    selectIndex: yes(),
    selectTabOrdinal: yes(),
    cycle: yes(),
    moveTab: yes(),
    moveProject: yes(),
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

  it('owns absolute altitude commands (⌃⌘digit) before xterm and never treats them as ordinals', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));
    const terminal = document.createElement('textarea');
    terminal.className = 'xterm-helper-textarea';
    terminal.addEventListener('keydown', event => event.preventDefault());
    document.body.append(terminal);

    for (const [digit, target] of [
      ['1', 'terminal'],
      ['2', 'sessions'],
      ['3', 'spatial'],
    ] as const) {
      // matching must ride the physical Digit code (D18); D19 moved the
      // family to ⌃⌘digit because macOS eats ⇧⌘3 for screenshots
      terminal.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: digit,
          code: `Digit${digit}`,
          metaKey: true,
          ctrlKey: true,
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

  it('summons quick feedback on ⌘⇧F from inside xterm once the terminal declines the chord (ENG-025)', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));
    const opened = vi.fn();
    window.addEventListener('exawatt:open-quick-feedback', opened);
    const terminal = document.createElement('textarea');
    terminal.className = 'xterm-helper-textarea';
    document.body.append(terminal);

    // the terminal's chord matcher declines ⌘⇧F (terminal-chords.ts), so the
    // event reaches this layer unprevented and the global verb fires
    const summon = new KeyboardEvent('keydown', {
      key: 'F',
      code: 'KeyF',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    terminal.dispatchEvent(summon);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(summon.defaultPrevented).toBe(true);

    // a chord the terminal DID handle (plain ⌘F find) arrives prevented and
    // must never double-apply as a workspace verb
    const find = new KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(find, 'defaultPrevented', { value: true });
    terminal.dispatchEvent(find);
    expect(opened).toHaveBeenCalledTimes(1);

    window.removeEventListener('exawatt:open-quick-feedback', opened);
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

describe('keyboard doctrine + arrangement (D20)', () => {
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

  it('routes new, reopen, and shell through distinct browser-style chords', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));

    fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true });
    expect(handlers.newAgent).toHaveBeenCalledOnce();
    expect(handlers.launchShell).not.toHaveBeenCalled();

    fireEvent.keyDown(window, {
      key: 't',
      code: 'KeyT',
      metaKey: true,
      shiftKey: true,
    });
    expect(handlers.reopenClosed).toHaveBeenCalledOnce();
    expect(handlers.launchShell).not.toHaveBeenCalled();

    fireEvent.keyDown(window, {
      key: 't',
      code: 'KeyT',
      metaKey: true,
      altKey: true,
    });
    expect(handlers.launchShell).toHaveBeenCalledOnce();
    expect(handlers.reopenClosed).toHaveBeenCalledOnce();
    expect(handlers.newAgent).toHaveBeenCalledOnce();
  });

  it('does not consume reopen when the action is unavailable', () => {
    const handlers = actions();
    vi.mocked(handlers.reopenClosed).mockReturnValue(false);
    renderHook(() => useWorkspaceShortcuts(handlers));
    const reopen = new KeyboardEvent('keydown', {
      key: 't',
      code: 'KeyT',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(reopen);

    expect(handlers.reopenClosed).toHaveBeenCalledOnce();
    expect(reopen.defaultPrevented).toBe(false);
    expect(handlers.launchShell).not.toHaveBeenCalled();
  });

  it('routes command-W through the shared active close action', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));
    const close = new KeyboardEvent('keydown', {
      key: 'w',
      code: 'KeyW',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(close);

    expect(handlers.closeActive).toHaveBeenCalledOnce();
    expect(close.defaultPrevented).toBe(true);
  });

  it('moves the active tab with command-option brackets, the Project with shift added', () => {
    const handlers = actions();
    renderHook(() => useWorkspaceShortcuts(handlers));

    fireEvent.keyDown(window, {
      key: ']',
      code: 'BracketRight',
      metaKey: true,
      altKey: true,
    });
    expect(handlers.moveTab).toHaveBeenLastCalledWith(1);

    fireEvent.keyDown(window, {
      key: '[',
      code: 'BracketLeft',
      metaKey: true,
      altKey: true,
      shiftKey: true,
    });
    expect(handlers.moveProject).toHaveBeenLastCalledWith(-1);
    expect(handlers.cycle).not.toHaveBeenCalled();
  });

  it('does not consume a fixed family when its action cannot apply', () => {
    const handlers = actions();
    vi.mocked(handlers.moveProject).mockReturnValue(false);
    renderHook(() => useWorkspaceShortcuts(handlers));
    const move = new KeyboardEvent('keydown', {
      key: '}',
      code: 'BracketRight',
      metaKey: true,
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(move);

    expect(handlers.moveProject).toHaveBeenCalledWith(1);
    expect(move.defaultPrevented).toBe(false);
  });

  it('lets a source adapter mount fixed families without stealing registry verbs', () => {
    const handlers = actions();
    renderHook(() => useFixedWorkspaceShortcuts(handlers));

    fireEvent.keyDown(window, {
      key: '1',
      code: 'Digit1',
      metaKey: true,
    });
    fireEvent.keyDown(window, {
      key: 't',
      code: 'KeyT',
      metaKey: true,
    });

    expect(handlers.selectTabOrdinal).toHaveBeenCalledWith(0);
    expect(handlers.newAgent).not.toHaveBeenCalled();
  });
});
