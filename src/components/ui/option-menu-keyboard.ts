/**
 * Keyboard model for OptionMenu (ENG-016 D49), extracted so it can be tested
 * without a DOM.
 *
 * The target is macOS menu behaviour, not "a listbox that happens to respond
 * to arrows":
 *
 *   - Up/Down move by one and WRAP at the ends.
 *   - Home/End jump to the first/last enabled option.
 *   - PageUp/PageDown move by a viewport's worth.
 *   - Typing jumps. A multi-character buffer matches a prefix ("son" → Sonnet)
 *     and expires after a pause; typing the SAME letter repeatedly instead
 *     cycles through every option starting with it, which is the behaviour
 *     macOS menus have and most web menus do not.
 *   - Disabled options are skipped by every movement, never landed on.
 */

/** macOS resets its type-ahead buffer after roughly this long. */
export const TYPEAHEAD_RESET_MS = 1_000;
export const PAGE_STEP = 8;

export interface MenuOptionLike {
  label: string;
  disabled?: boolean;
}

function isEnabled(options: readonly MenuOptionLike[], index: number): boolean {
  const option = options[index];
  return option !== undefined && option.disabled !== true;
}

/** First enabled index at or after `from`, searching in `direction`. */
function seek(
  options: readonly MenuOptionLike[],
  from: number,
  direction: 1 | -1,
  wrap: boolean
): number | null {
  if (options.length === 0) return null;
  for (let step = 0; step < options.length; step += 1) {
    const raw = from + step * direction;
    const index = wrap
      ? ((raw % options.length) + options.length) % options.length
      : raw;
    if (index < 0 || index >= options.length) break;
    if (isEnabled(options, index)) return index;
  }
  return null;
}

export type MenuMovement =
  | { kind: 'move'; index: number }
  | { kind: 'commit'; index: number }
  | { kind: 'close' }
  | null;

export interface TypeaheadState {
  buffer: string;
  at: number;
}

export const emptyTypeahead = (): TypeaheadState => ({ buffer: '', at: 0 });

/**
 * Resolve a printable character against the option list.
 *
 * Returns the next state alongside the index to move to, so the caller owns
 * storage and the function stays pure.
 */
export function applyTypeahead(
  options: readonly MenuOptionLike[],
  state: TypeaheadState,
  character: string,
  activeIndex: number,
  now: number
): { state: TypeaheadState; index: number | null } {
  const key = character.toLowerCase();
  const expired = now - state.at > TYPEAHEAD_RESET_MS;
  const previous = expired ? '' : state.buffer;

  // Repeating one letter cycles that letter's options instead of searching for
  // "ss" — the macOS rule, and the reason pressing S twice moves twice.
  const cycling =
    previous.length > 0 && previous.split('').every(entry => entry === key);
  const buffer = cycling ? key : previous + key;
  const next: TypeaheadState = { buffer, at: now };

  const matches: number[] = [];
  for (let index = 0; index < options.length; index += 1) {
    if (!isEnabled(options, index)) continue;
    if (options[index].label.toLowerCase().startsWith(buffer)) {
      matches.push(index);
    }
  }
  if (matches.length === 0) return { state: next, index: null };

  if (cycling) {
    const after = matches.find(index => index > activeIndex);
    return { state: next, index: after ?? matches[0] };
  }
  // A growing buffer should not jump away from an option that still matches.
  const staysValid = matches.includes(activeIndex);
  return { state: next, index: staysValid ? activeIndex : matches[0] };
}

/** Resolve a non-printable key into a movement. */
export function resolveMenuKey(
  options: readonly MenuOptionLike[],
  key: string,
  activeIndex: number
): MenuMovement {
  const first = seek(options, 0, 1, false);
  const last = seek(options, options.length - 1, -1, false);
  const from = activeIndex < 0 ? -1 : activeIndex;

  switch (key) {
    case 'ArrowDown': {
      const index = seek(options, from + 1, 1, true);
      return index === null ? null : { kind: 'move', index };
    }
    case 'ArrowUp': {
      const index = seek(options, from < 0 ? options.length - 1 : from - 1, -1, true);
      return index === null ? null : { kind: 'move', index };
    }
    case 'Home': {
      return first === null ? null : { kind: 'move', index: first };
    }
    case 'End': {
      return last === null ? null : { kind: 'move', index: last };
    }
    case 'PageDown': {
      const index =
        seek(options, Math.min(from + PAGE_STEP, options.length - 1), 1, false) ??
        seek(options, Math.min(from + PAGE_STEP, options.length - 1), -1, false) ??
        last;
      return index === null ? null : { kind: 'move', index };
    }
    case 'PageUp': {
      const index =
        seek(options, Math.max(from - PAGE_STEP, 0), -1, false) ??
        seek(options, Math.max(from - PAGE_STEP, 0), 1, false) ??
        first;
      return index === null ? null : { kind: 'move', index };
    }
    case 'Enter':
    case ' ': {
      return activeIndex >= 0 && isEnabled(options, activeIndex)
        ? { kind: 'commit', index: activeIndex }
        : null;
    }
    case 'Escape':
    case 'Tab': {
      return { kind: 'close' };
    }
    default:
      return null;
  }
}

/** Is this a character the type-ahead buffer should consume? */
export function isTypeaheadCharacter(key: string, hasModifier: boolean): boolean {
  return !hasModifier && key.length === 1 && key !== ' ' && /\S/.test(key);
}
