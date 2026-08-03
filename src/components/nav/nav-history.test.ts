import { describe, expect, it } from 'vitest';
import { NavHistory, sameLocation } from './nav-history';

describe('NavHistory (D27 app-location back stack)', () => {
  const terminal = { surface: '/workspace', tab: { dir: '/a', tabId: 't1' } };
  const otherTab = { surface: '/workspace', tab: { dir: '/a', tabId: 't2' } };
  const sessions = {
    surface: '/workspace?view=sessions',
    tab: { dir: '/a', tabId: 't2' },
  };
  const settings = { surface: '/settings' };

  it('walks back and forward across surfaces AND tabs', () => {
    const h = new NavHistory();
    h.visit(terminal);
    h.visit(otherTab);
    h.visit(sessions);
    h.visit(settings);
    expect(h.back()).toEqual(sessions);
    expect(h.back()).toEqual(otherTab);
    expect(h.back()).toEqual(terminal);
    expect(h.back()).toBeNull(); // floor
    expect(h.forward()).toEqual(otherTab);
    expect(h.forward()).toEqual(sessions);
  });

  it('applying back never re-records: an equal visit is a no-op', () => {
    const h = new NavHistory();
    h.visit(terminal);
    h.visit(sessions);
    const target = h.back();
    expect(target).toEqual(terminal);
    // the apply causes recorders to fire with the location we just landed on
    h.visit(terminal);
    expect(h.canForward()).toBe(true); // forward stack survived
    expect(h.forward()).toEqual(sessions);
  });

  it('a NEW visit after going back truncates the forward stack', () => {
    const h = new NavHistory();
    h.visit(terminal);
    h.visit(sessions);
    h.back();
    h.visit(settings);
    expect(h.canForward()).toBe(false);
    expect(h.back()).toEqual(terminal);
  });

  it('consecutive duplicate visits collapse to one entry', () => {
    const h = new NavHistory();
    h.visit(terminal);
    h.visit({ surface: '/workspace', tab: { dir: '/a', tabId: 't1' } });
    h.visit(sessions);
    expect(h.back()).toEqual(terminal);
    expect(h.back()).toBeNull();
  });

  it('caps the stack without losing the newest entries', () => {
    const h = new NavHistory();
    for (let i = 0; i < 150; i += 1) {
      h.visit({ surface: `/workspace?n=${i}` });
    }
    expect(h.current()?.surface).toBe('/workspace?n=149');
    let steps = 0;
    while (h.back()) steps += 1;
    expect(steps).toBe(99);
  });

  it('sameLocation compares tab identity, not object identity', () => {
    expect(
      sameLocation(
        { surface: '/workspace', tab: { dir: '/a', tabId: 't1' } },
        { surface: '/workspace', tab: { dir: '/a', tabId: 't1' } }
      )
    ).toBe(true);
    expect(
      sameLocation({ surface: '/workspace' }, { surface: '/workspace', tab: null })
    ).toBe(true);
  });

  it('publishes capability changes for chrome controls', () => {
    const h = new NavHistory();
    const revisions: number[] = [];
    const unsubscribe = h.subscribe(() => revisions.push(h.getRevision()));

    h.visit(terminal);
    h.visit(sessions);
    expect(h.canBack()).toBe(true);
    expect(h.canForward()).toBe(false);

    h.back();
    expect(h.canBack()).toBe(false);
    expect(h.canForward()).toBe(true);

    h.forward();
    h.reset();
    unsubscribe();
    h.visit(settings);

    expect(revisions).toEqual([1, 2, 3, 4, 5]);
  });
});
