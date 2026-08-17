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

  // ── BUG-006: closing a tab used to leave a dead stop in the stack.
  // `selectExistingTab` silently no-ops for a tab that no longer exists, so
  // Back moved the index and changed nothing on screen: "Back reaches
  // nothing". Reopening is ⌘⇧T's job (D39) — Back's job is to keep an
  // unbroken chain to whatever is still there.
  describe('dead stops (BUG-006)', () => {
    const live = new Set(['t1', 't2', 't3']);
    const resolver = (l: { tab?: { tabId: string } | null }) =>
      !l.tab || live.has(l.tab.tabId);
    const tab = (id: string) => ({
      surface: '/workspace',
      tab: { dir: '/a', tabId: id },
    });

    it('backs THROUGH a destroyed tab to the last live location', () => {
      const h = new NavHistory();
      h.setLocationResolver(resolver);
      h.visit(tab('t1'));
      h.visit(tab('t2'));
      h.visit(tab('t3'));

      live.delete('t2');
      expect(h.back()).toEqual(tab('t1'));
      // the dead entry is gone, not merely skipped
      expect(h.snapshot().entries).toEqual([tab('t1'), tab('t3')]);
      expect(h.forward()).toEqual(tab('t3'));

      live.add('t2');
    });

    it('reports canBack false when every entry behind us is destroyed', () => {
      const h = new NavHistory();
      h.setLocationResolver(resolver);
      h.visit(tab('t1'));
      h.visit(tab('t2'));

      live.delete('t1');
      expect(h.canBack()).toBe(false);
      expect(h.back()).toBeNull();

      live.add('t1');
    });

    it('closing the ACTIVE tab still leaves an unbroken chain', () => {
      const h = new NavHistory();
      h.setLocationResolver(resolver);
      h.visit(tab('t1'));
      h.visit(tab('t2'));
      h.visit(tab('t3'));

      // ⌘W on t3; the workspace selects a neighbour, which records normally
      live.delete('t3');
      h.visit(tab('t2'));
      expect(h.back()).toEqual(tab('t1'));

      live.add('t3');
    });

    it('surface-only entries survive any tab churn', () => {
      const h = new NavHistory();
      h.setLocationResolver(resolver);
      h.visit(settings);
      h.visit(tab('t2'));

      live.delete('t2');
      h.visit(tab('t1'));
      expect(h.back()).toEqual(settings);

      live.add('t2');
    });
  });

  // ── BUG-006 second defect: Back "cycled between the same two entries".
  // Applying a location lands in stages — the tab select is synchronous, the
  // surface change is a router round trip — so the workspace recorder
  // observes a hybrid (old surface, new tab) that matches no entry, pushes
  // it, and truncates the forward stack. The stack becomes an oscillator.
  describe('apply epoch (BUG-006 oscillation)', () => {
    it('ignores hybrid states observed while a location is applying', () => {
      const h = new NavHistory();
      h.visit(terminal);
      h.visit(sessions);

      const target = h.back();
      expect(target).toEqual(terminal);
      h.beginApply(target!);
      // stage 1: the tab applied, the router has not landed yet
      h.visit({ surface: sessions.surface, tab: terminal.tab });
      // stage 2: the router lands and the real location is observed
      h.visit(terminal);

      expect(h.snapshot().entries).toEqual([terminal, sessions]);
      expect(h.canForward()).toBe(true);
      expect(h.forward()).toEqual(sessions);
    });

    it('records normally again once the applied location arrives', () => {
      const h = new NavHistory();
      h.visit(terminal);
      h.visit(sessions);
      h.beginApply(h.back()!);
      h.visit(terminal);
      expect(h.isApplying()).toBe(false);

      h.visit(settings);
      expect(h.snapshot().entries).toEqual([terminal, settings]);
    });

    // Only STAGES of the apply are swallowed. A location sharing neither the
    // surface nor the tab is the operator navigating somewhere else mid-apply,
    // and dropping that would break the chain the fix exists to keep whole.
    it('records an unrelated navigation made mid-apply', () => {
      const h = new NavHistory();
      h.visit(terminal);
      h.beginApply(sessions);
      h.visit(settings);
      expect(h.snapshot().entries).toEqual([terminal, settings]);
      expect(h.isApplying()).toBe(false);
    });

    // BUG-035, the same family one round trip later. Instrumented from the
    // failing `eval:navigation:spine` run: Forward is pressed, ⌘[ follows
    // before the router lands, and the FIRST apply's own completion arrives
    // afterwards. With one apply slot it was read as an independent
    // navigation — index walked to /settings, the workspace's own arrival
    // truncated the stack, and ⌘] had nothing ahead of it.
    it('keeps the forward stack when a second apply starts mid-flight', () => {
      const h = new NavHistory();
      h.visit(terminal);
      h.visit(settings);

      // ⌘] / Forward: apply #1 begins and its router round trip is in flight
      expect(h.back()).toEqual(terminal);
      h.beginApply(terminal);
      h.visit(terminal);
      expect(h.forward()).toEqual(settings);
      h.beginApply(settings);

      // ⌘[ before apply #1 lands: apply #2 begins while #1 is still expected
      expect(h.back()).toEqual(terminal);
      h.beginApply(terminal);

      // now they land, oldest first
      h.visit(settings);
      h.visit(terminal);

      expect(h.snapshot()).toEqual({ entries: [terminal, settings], index: 0 });
      expect(h.canForward()).toBe(true);
      expect(h.forward()).toEqual(settings);
    });

    it('an older apply still owns its own stages while a newer one flies', () => {
      const h = new NavHistory();
      h.visit(terminal);
      h.beginApply(settings);
      h.beginApply(otherTab);
      // half of the /settings apply: its surface has landed, its tab has not
      h.visit({ surface: '/settings', tab: terminal.tab });
      expect(h.snapshot().entries).toEqual([terminal]);
    });

    it('a landed apply retires the ones it superseded', () => {
      const h = new NavHistory();
      h.visit(terminal);
      h.beginApply(settings);
      h.beginApply(otherTab);
      h.visit(otherTab);
      // /settings was superseded before it landed; its arrival can no longer
      // be told apart from a real navigation, so it records normally
      h.visit(settings);
      expect(h.snapshot().entries).toEqual([terminal, settings]);
      expect(h.isApplying()).toBe(false);
    });

    it('an apply whose stages never finish cannot silence recording forever', () => {
      const h = new NavHistory();
      let clock = 0;
      h.setClock(() => clock);
      h.visit(terminal);
      h.beginApply(sessions);
      // shares the tab, so it reads as a stage and is swallowed
      const stage = { surface: '/workspace', tab: sessions.tab };
      h.visit(stage);
      expect(h.snapshot().entries).toEqual([terminal]);

      clock += 10_000;
      expect(h.isApplying()).toBe(false);
      h.visit(stage);
      expect(h.snapshot().entries).toEqual([terminal, stage]);
    });
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
