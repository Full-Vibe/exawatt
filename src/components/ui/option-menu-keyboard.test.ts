import { describe, expect, it } from 'vitest';
import {
  applyTypeahead,
  emptyTypeahead,
  isTypeaheadCharacter,
  resolveMenuKey,
  TYPEAHEAD_RESET_MS,
} from './option-menu-keyboard';

const MODELS = [
  { label: 'Opus 5' },
  { label: 'Sonnet 4.6' },
  { label: 'Sonnet 5' },
  { label: 'Fable 5' },
  { label: 'Haiku 4.5', disabled: true },
  { label: 'Kimi K3' },
];

describe('resolveMenuKey', () => {
  it('moves down and wraps past the end', () => {
    expect(resolveMenuKey(MODELS, 'ArrowDown', 0)).toEqual({
      kind: 'move',
      index: 1,
    });
    expect(resolveMenuKey(MODELS, 'ArrowDown', 5)).toEqual({
      kind: 'move',
      index: 0,
    });
  });

  it('moves up and wraps past the start', () => {
    expect(resolveMenuKey(MODELS, 'ArrowUp', 1)).toEqual({
      kind: 'move',
      index: 0,
    });
    expect(resolveMenuKey(MODELS, 'ArrowUp', 0)).toEqual({
      kind: 'move',
      index: 5,
    });
  });

  it('opens onto the first option when nothing is active', () => {
    expect(resolveMenuKey(MODELS, 'ArrowDown', -1)).toEqual({
      kind: 'move',
      index: 0,
    });
  });

  it('never lands on a disabled option', () => {
    // index 4 (Haiku) is disabled, so Down from 3 skips to 5.
    expect(resolveMenuKey(MODELS, 'ArrowDown', 3)).toEqual({
      kind: 'move',
      index: 5,
    });
    expect(resolveMenuKey(MODELS, 'ArrowUp', 5)).toEqual({
      kind: 'move',
      index: 3,
    });
  });

  it('jumps to the first and last enabled options', () => {
    expect(resolveMenuKey(MODELS, 'Home', 3)).toEqual({ kind: 'move', index: 0 });
    expect(resolveMenuKey(MODELS, 'End', 0)).toEqual({ kind: 'move', index: 5 });
  });

  it('pages without wrapping and clamps to an enabled option', () => {
    expect(resolveMenuKey(MODELS, 'PageDown', 0)).toEqual({
      kind: 'move',
      index: 5,
    });
    expect(resolveMenuKey(MODELS, 'PageUp', 5)).toEqual({
      kind: 'move',
      index: 0,
    });
  });

  it('commits on Enter and Space, but not onto a disabled option', () => {
    expect(resolveMenuKey(MODELS, 'Enter', 2)).toEqual({
      kind: 'commit',
      index: 2,
    });
    expect(resolveMenuKey(MODELS, ' ', 2)).toEqual({ kind: 'commit', index: 2 });
    expect(resolveMenuKey(MODELS, 'Enter', 4)).toBeNull();
    expect(resolveMenuKey(MODELS, 'Enter', -1)).toBeNull();
  });

  it('closes on Escape and Tab', () => {
    expect(resolveMenuKey(MODELS, 'Escape', 1)).toEqual({ kind: 'close' });
    expect(resolveMenuKey(MODELS, 'Tab', 1)).toEqual({ kind: 'close' });
  });
});

describe('applyTypeahead', () => {
  it('jumps to the first option starting with the letter', () => {
    const result = applyTypeahead(MODELS, emptyTypeahead(), 'S', 0, 1_000);
    expect(result.index).toBe(1);
    expect(result.state.buffer).toBe('s');
  });

  it('cycles through same-letter options when the letter repeats', () => {
    let state = emptyTypeahead();
    let index = 0;

    const first = applyTypeahead(MODELS, state, 's', index, 1_000);
    state = first.state;
    index = first.index!;
    expect(index).toBe(1); // Sonnet 4.6

    const second = applyTypeahead(MODELS, state, 's', index, 1_100);
    state = second.state;
    index = second.index!;
    expect(index).toBe(2); // Sonnet 5

    // ...and wraps back around rather than dead-ending.
    const third = applyTypeahead(MODELS, state, 's', index, 1_200);
    expect(third.index).toBe(1);
  });

  it('narrows on a multi-character prefix', () => {
    let state = emptyTypeahead();
    const s = applyTypeahead(MODELS, state, 'f', 0, 1_000);
    state = s.state;
    expect(s.index).toBe(3); // Fable 5
    const fa = applyTypeahead(MODELS, state, 'a', s.index!, 1_100);
    expect(fa.state.buffer).toBe('fa');
    expect(fa.index).toBe(3);
  });

  it('starts a new search once the buffer has expired', () => {
    const first = applyTypeahead(MODELS, emptyTypeahead(), 'k', 0, 1_000);
    expect(first.index).toBe(5);
    const later = applyTypeahead(
      MODELS,
      first.state,
      'o',
      first.index!,
      1_000 + TYPEAHEAD_RESET_MS + 1
    );
    expect(later.state.buffer).toBe('o');
    expect(later.index).toBe(0); // Opus 5, not "ko"
  });

  it('never matches a disabled option', () => {
    const result = applyTypeahead(MODELS, emptyTypeahead(), 'h', 0, 1_000);
    expect(result.index).toBeNull();
  });

  it('reports no match without moving the selection', () => {
    const result = applyTypeahead(MODELS, emptyTypeahead(), 'z', 2, 1_000);
    expect(result.index).toBeNull();
  });
});

describe('isTypeaheadCharacter', () => {
  it('accepts printable characters only, and never with a modifier', () => {
    expect(isTypeaheadCharacter('s', false)).toBe(true);
    expect(isTypeaheadCharacter('5', false)).toBe(true);
    expect(isTypeaheadCharacter('s', true)).toBe(false);
    expect(isTypeaheadCharacter(' ', false)).toBe(false);
    expect(isTypeaheadCharacter('ArrowDown', false)).toBe(false);
  });
});
