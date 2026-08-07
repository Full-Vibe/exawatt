import { describe, expect, it } from 'vitest';
import { matchesChordQuery, parseChordQuery } from './chord-query';
import type { KeyBinding, ShortcutKeys } from '@/types/shortcuts';

describe('chord queries (FIX-001)', () => {
  const parse = (q: string) => parseChordQuery(q);

  it('accepts the symbols the sheet renders', () => {
    expect(parse('⌘⇧T')).toEqual({
      modifiers: new Set(['meta', 'shift']),
      key: 't',
    });
    expect(parse('⌘[')).toEqual({ modifiers: new Set(['meta']), key: '[' });
  });

  it('accepts the words an operator types', () => {
    const expected = { modifiers: new Set(['meta', 'shift']), key: 't' };
    expect(parse('cmd shift t')).toEqual(expected);
    expect(parse('command+shift+T')).toEqual(expected);
    expect(parse('meta-shift-t')).toEqual(expected);
    expect(parse('⌘ shift t')).toEqual(expected);
  });

  it('accepts named keys in either spelling', () => {
    expect(parse('cmd esc')).toEqual({
      modifiers: new Set(['meta']),
      key: 'escape',
    });
    expect(parse('ctrl ↵')).toEqual({
      modifiers: new Set(['ctrl']),
      key: 'enter',
    });
  });

  it('treats a bare modifier as a valid, broader query', () => {
    expect(parse('cmd')).toEqual({ modifiers: new Set(['meta']), key: null });
  });

  // The important half: ordinary text must keep searching labels.
  it('is not a chord when no modifier is named', () => {
    expect(parse('t')).toBeNull();
    expect(parse('close tab')).toBeNull();
    expect(parse('')).toBeNull();
  });

  it('is not a chord when a modifier word appears inside prose', () => {
    // "command palette" names a modifier but is plainly a label search
    expect(parse('command palette')).toBeNull();
    expect(parse('shift focus to terminal')).toBeNull();
  });

  it('matches a binding structurally, not by rendered text', () => {
    const keys: KeyBinding = { key: 'T', modifiers: ['meta', 'shift'] };
    expect(matchesChordQuery(keys, parse('cmd shift t')!)).toBe(true);
    expect(matchesChordQuery(keys, parse('⌘⇧T')!)).toBe(true);
    expect(matchesChordQuery(keys, parse('cmd t')!)).toBe(true); // partial
    expect(matchesChordQuery(keys, parse('ctrl shift t')!)).toBe(false);
    expect(matchesChordQuery(keys, parse('cmd shift k')!)).toBe(false);
  });

  it('a bare modifier lists everything under it', () => {
    expect(
      matchesChordQuery({ key: 'K', modifiers: ['meta'] }, parse('cmd')!)
    ).toBe(true);
    expect(matchesChordQuery({ key: 'K' }, parse('cmd')!)).toBe(false);
  });

  it('finds a chord sequence by any step', () => {
    const sequence: ShortcutKeys = [
      { key: 'K', modifiers: ['meta'] },
      { key: 'P' },
    ];
    expect(matchesChordQuery(sequence, parse('⌘K')!)).toBe(true);
  });
});
