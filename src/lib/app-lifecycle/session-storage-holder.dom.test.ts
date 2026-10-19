import { describe, expect, it, vi } from 'vitest';
import { sessionStorageHolder } from '@/lib/app-lifecycle/session-storage-holder';

describe('sessionStorageHolder', () => {
  it('carries the app’s per-run entries, and only those', () => {
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      'exawatt:spatial-viewport:v2:fleet:~:~:top-down',
      '{"zoom":2}'
    );
    window.sessionStorage.setItem('exawatt:spatial-return', '/fleet/spatial');
    window.sessionStorage.setItem('third-party', 'x');
    const held = sessionStorageHolder(window).capture();
    expect(held).toEqual({
      'exawatt:spatial-viewport:v2:fleet:~:~:top-down': '{"zoom":2}',
      'exawatt:spatial-return': '/fleet/spatial',
    });

    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      'exawatt:spatial-return',
      '/fleet/spatial?v=2'
    );
    const holder = sessionStorageHolder(window);
    holder.restore(holder.parse(held)!, () => undefined);
    expect(
      window.sessionStorage.getItem(
        'exawatt:spatial-viewport:v2:fleet:~:~:top-down'
      )
    ).toBe('{"zoom":2}');
    // This run's own value is newer than the held one.
    expect(window.sessionStorage.getItem('exawatt:spatial-return')).toBe(
      '/fleet/spatial?v=2'
    );
  });

  it('refuses entries it did not write', () => {
    const holder = sessionStorageHolder(window);
    expect(holder.parse({ 'other:key': 'x' })).toBeNull();
    expect(holder.parse({ 'exawatt:key': 42 })).toBeNull();
    expect(holder.parse(['exawatt:key'])).toBeNull();
  });

  // Review of 0.1.22: one refused `setItem` (quota, a storage the security
  // policy blocks) threw out of the restore and took the window down.
  it('restores entry by entry when storage refuses one', () => {
    window.sessionStorage.clear();
    const setItem = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key, value) {
        if (key === 'exawatt:too-big') {
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        }
        setItem.call(this, key, value);
      });
    try {
      const holder = sessionStorageHolder(window);
      const failed = vi.fn();
      holder.restore(
        holder.parse({
          'exawatt:first': '1',
          'exawatt:too-big': 'x',
          'exawatt:last': '2',
        })!,
        failed
      );
      expect(window.sessionStorage.getItem('exawatt:first')).toBe('1');
      expect(window.sessionStorage.getItem('exawatt:last')).toBe('2');
      expect(failed).toHaveBeenCalledOnce();
      expect(failed).toHaveBeenCalledWith(
        'exawatt:too-big',
        expect.objectContaining({ name: 'QuotaExceededError' })
      );
    } finally {
      spy.mockRestore();
    }
  });
});
