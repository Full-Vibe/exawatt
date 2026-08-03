import { describe, expect, it } from 'vitest';
import { matchTerminalChord } from './terminal-chords';

function key(overrides: Partial<Parameters<typeof matchTerminalChord>[0]>) {
  return {
    type: 'keydown',
    key: 'f',
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...overrides,
  };
}

describe('matchTerminalChord', () => {
  it('claims exactly the chords the pane implements', () => {
    expect(matchTerminalChord(key({ key: 'f', metaKey: true }))).toBe('find');
    expect(matchTerminalChord(key({ key: 'c', metaKey: true }))).toBe('copy');
    expect(matchTerminalChord(key({ key: 'v', metaKey: true }))).toBe('paste');
    expect(matchTerminalChord(key({ key: 'a', metaKey: true }))).toBe(
      'select-all'
    );
    // macOS reports the shifted key uppercase; ⌘F stays ⌘F under caps
    expect(matchTerminalChord(key({ key: 'F', metaKey: true }))).toBe('find');
  });

  it('declines ⌘⇧F so quick feedback capture summons from terminal focus (ENG-025)', () => {
    expect(
      matchTerminalChord(key({ key: 'f', metaKey: true, shiftKey: true }))
    ).toBeNull();
    expect(
      matchTerminalChord(key({ key: 'F', metaKey: true, shiftKey: true }))
    ).toBeNull();
  });

  it('declines every modifier superset — a shifted or optioned variant is a different combo', () => {
    expect(
      matchTerminalChord(key({ key: 'c', metaKey: true, shiftKey: true }))
    ).toBeNull();
    expect(
      matchTerminalChord(key({ key: 'v', metaKey: true, altKey: true }))
    ).toBeNull();
    expect(
      matchTerminalChord(key({ key: 'a', metaKey: true, ctrlKey: true }))
    ).toBeNull();
  });

  it('declines plain keys, other meta chords, and non-keydown events', () => {
    expect(matchTerminalChord(key({ key: 'f' }))).toBeNull();
    expect(matchTerminalChord(key({ key: 'k', metaKey: true }))).toBeNull();
    expect(
      matchTerminalChord(key({ key: 'f', metaKey: true, type: 'keyup' }))
    ).toBeNull();
  });
});
