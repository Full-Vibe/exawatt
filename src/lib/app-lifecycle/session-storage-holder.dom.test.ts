import { describe, expect, it } from 'vitest';
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
    holder.restore(holder.parse(held)!);
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
});
