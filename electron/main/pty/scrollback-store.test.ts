import { describe, expect, it } from 'vitest';
import { ScrollbackStore } from './scrollback-store';

describe('ScrollbackStore', () => {
  it('returns only output appended after an absolute cursor', () => {
    const store = new ScrollbackStore(100);
    store.append('a', 'before\n');
    const cursor = store.cursor('a');
    store.append('a', 'after one\nafter two\n');

    expect(store.since('a', cursor)).toEqual({
      text: 'after one\nafter two\n',
      truncated: false,
    });
  });

  it('keeps cursors meaningful after trimming retained scrollback', () => {
    const store = new ScrollbackStore(12);
    store.append('a', 'old line\n');
    const oldCursor = store.cursor('a');
    store.append('a', 'new one\nnew two\n');

    const delta = store.since('a', oldCursor);
    expect(delta.truncated).toBe(true);
    expect(delta.text).toBe('new two\n');
    expect(store.cursor('a')).toBe('old line\nnew one\nnew two\n'.length);
  });

  it('drops all retained state with the session', () => {
    const store = new ScrollbackStore();
    store.append('a', 'output');
    store.delete('a');
    expect(store.text('a')).toBe('');
    expect(store.cursor('a')).toBe(0);
  });
});
