import { createElement, useRef } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backOutLayersForTest,
  registerBackOut,
  rememberFocus,
  useBackOut,
  type BackOutLayer,
} from './back-out';

const leaves: Array<() => void> = [];
function join(layer: BackOutLayer): void {
  leaves.push(registerBackOut(layer));
}

function mount<T extends HTMLElement>(
  tag: string,
  parent: HTMLElement = document.body
): T {
  const element = document.createElement(tag) as T;
  if (tag === 'div') element.tabIndex = -1;
  parent.append(element);
  return element;
}

/** Escape at `target`; true when a layer took it. */
function escape(
  target: Element,
  init: Partial<KeyboardEventInit> & { keyCode?: number } = {}
): boolean {
  return !fireEvent.keyDown(target, { key: 'Escape', code: 'Escape', ...init });
}

afterEach(() => {
  while (leaves.length) leaves.pop()!();
  document.body.replaceChildren();
});

describe('the back-out ladder', () => {
  it('asks the top rung first and falls through a rung with nothing left', () => {
    const panel = mount<HTMLDivElement>('div');
    const field = mount<HTMLInputElement>('input', panel);
    const order: string[] = [];
    join({
      rung: 'panel',
      element: () => panel,
      back: () => (order.push('panel'), true),
    });
    join({
      rung: 'field',
      element: () => field,
      back: () => (order.push('field'), false),
    });
    join({
      rung: 'altitude',
      ambient: true,
      back: () => (order.push('altitude'), true),
    });

    expect(escape(field)).toBe(true);
    expect(order).toEqual(['field', 'panel']);
  });

  it('a scoped layer answers only for keys born inside it', () => {
    const dock = mount<HTMLDivElement>('div');
    const elsewhere = mount<HTMLButtonElement>('button');
    const dockBack = vi.fn(() => true);
    const altitudeBack = vi.fn(() => true);
    join({ rung: 'dock', element: () => dock, back: dockBack });
    join({ rung: 'altitude', ambient: true, back: altitudeBack });

    escape(elsewhere);
    expect(dockBack).not.toHaveBeenCalled();
    expect(altitudeBack).toHaveBeenCalledOnce();
  });

  it('among ambient layers of one rung, the deeper element answers first', () => {
    const workspace = mount<HTMLDivElement>('div');
    const team = mount<HTMLDivElement>('div', workspace);
    const chrome = mount<HTMLButtonElement>('button');
    const order: string[] = [];
    // Team joins first (child effects run before their parent's), and still
    // outranks the workspace it sits inside.
    join({
      rung: 'altitude',
      ambient: true,
      element: () => team,
      back: () => (order.push('team'), true),
    });
    join({
      rung: 'altitude',
      ambient: true,
      back: () => (order.push('workspace'), true),
    });

    escape(chrome);
    expect(order).toEqual(['team']);
  });

  it('a registered overlay is modal: it answers wherever focus is, and nothing beneath it does', () => {
    const behind = mount<HTMLButtonElement>('button');
    const dialogBack = vi.fn(() => false);
    const altitudeBack = vi.fn(() => true);
    join({ rung: 'altitude', ambient: true, back: altitudeBack });
    join({ rung: 'overlay', back: dialogBack });

    expect(escape(behind)).toBe(true);
    expect(dialogBack).toHaveBeenCalledOnce();
    expect(altitudeBack).not.toHaveBeenCalled();
  });

  it.each([
    ['a key another surface already took', { defaultPrevented: true }],
    ['IME composition', { isComposing: true }],
    ['IME composition (keyCode 229)', { keyCode: 229 }],
    ['a modified Escape', { altKey: true }],
  ])('yields %s', (_label, init) => {
    const button = mount<HTMLButtonElement>('button');
    const back = vi.fn(() => true);
    join({ rung: 'altitude', ambient: true, back });
    if ('defaultPrevented' in init) {
      button.addEventListener('keydown', event => event.preventDefault());
      escape(button);
    } else {
      expect(escape(button, init)).toBe(false);
    }
    expect(back).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an open dialog it does not own',
      () => {
        const dialog = mount<HTMLDivElement>('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('data-state', 'open');
        return mount<HTMLButtonElement>('button', dialog);
      },
    ],
    [
      "the Session's terminal",
      () => {
        const terminal = mount<HTMLTextAreaElement>('textarea');
        terminal.className = 'xterm-helper-textarea';
        return terminal;
      },
    ],
  ])('leaves Escape to %s', (_label, target) => {
    const back = vi.fn(() => true);
    join({ rung: 'altitude', ambient: true, back });
    expect(escape(target())).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it('a key no layer takes keeps its default', () => {
    const button = mount<HTMLButtonElement>('button');
    join({ rung: 'grid', ambient: true, back: () => false });
    expect(escape(button)).toBe(false);
  });

  it('leaves no listener behind once the last layer leaves', () => {
    const back = vi.fn(() => true);
    const leave = registerBackOut({ rung: 'altitude', ambient: true, back });
    leave();
    expect(backOutLayersForTest()).toEqual([]);
    escape(mount<HTMLButtonElement>('button'));
    expect(back).not.toHaveBeenCalled();
  });
});

describe('focus return', () => {
  it('puts caret and selection back onto the field that replaced the remembered one', () => {
    const before = mount<HTMLTextAreaElement>('textarea');
    before.value = 'draft editing position';
    before.focus();
    before.setSelectionRange(6, 13, 'backward');
    const remembered = rememberFocus(before);
    before.remove();

    const after = mount<HTMLTextAreaElement>('textarea');
    after.value = 'draft editing position';
    expect(remembered.restore(after)).toBe(true);
    expect(after).toHaveFocus();
    expect([after.selectionStart, after.selectionEnd]).toEqual([6, 13]);
    expect(after.selectionDirection).toBe('backward');
  });

  it('clamps a position the shorter value no longer has', () => {
    const field = mount<HTMLInputElement>('input');
    field.value = 'a long draft';
    field.setSelectionRange(8, 12);
    const remembered = rememberFocus(field);
    field.value = 'short';
    expect(remembered.restore()).toBe(true);
    expect([field.selectionStart, field.selectionEnd]).toEqual([5, 5]);
  });

  it('reports that nothing was restored when the element is gone', () => {
    const button = mount<HTMLButtonElement>('button');
    const remembered = rememberFocus(button);
    button.remove();
    expect(remembered.restore()).toBe(false);
  });

  it('a layer that returns focus does so only when focus went nowhere', async () => {
    function Confirm() {
      const ref = useRef<HTMLDivElement>(null);
      useBackOut({
        rung: 'overlay',
        element: ref,
        back: () => true,
        returnFocus: true,
      });
      return createElement('div', { ref, role: 'dialog' });
    }
    const invoker = mount<HTMLButtonElement>('button');
    const other = mount<HTMLButtonElement>('button');

    invoker.focus();
    const first = render(createElement(Confirm));
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => first.unmount());
    expect(invoker).toHaveFocus();

    const second = render(createElement(Confirm));
    other.focus();
    await act(async () => second.unmount());
    expect(other).toHaveFocus();
  });
});
