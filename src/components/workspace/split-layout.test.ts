/**
 * Split-view doctrine (S2 ⌘D, reworked D26): the pin follows the TAB, not
 * the PTY. A pinned pane survives its session's exit (the operator is
 * WATCHING it — seeing it finish is the point), and the driven side is
 * whatever the workspace would show full-screen without the pin: a live
 * pane, a stopped tab, the ⌘T draft page, or the empty-Project composer.
 */
import { describe, expect, it } from 'vitest';
import { nextPin, resolveStageLayout, tabIsPinnable } from './split-layout';
import type { WorkspaceTab } from './use-workspace-state';

const tab = (id: string, over: Partial<WorkspaceTab> = {}): WorkspaceTab => ({
  id,
  durableSessionId: `${id}-durable`,
  harness: 'claude',
  title: 'Agent',
  cwd: '/project',
  sessionId: `pty-${id}`,
  harnessSessionId: null,
  resumeState: 'live',
  lifecycle: 'running',
  exitCode: null,
  roadmapItemId: null,
  initialTask: null,
  ...over,
});
const stopped = (id: string) =>
  tab(id, {
    sessionId: null,
    resumeState: 'ended-resumable',
    lifecycle: 'stopped-clean',
  });
const draft = (id: string) =>
  tab(id, {
    sessionId: null,
    resumeState: 'identity-missing',
    lifecycle: 'draft',
  });
const entry = (t: WorkspaceTab, dir = '/project') => ({ tab: t, dir });

describe('tabIsPinnable', () => {
  it('allows live and stopped tabs but never drafts (nothing to watch)', () => {
    expect(tabIsPinnable(tab('a'))).toBe(true);
    expect(tabIsPinnable(stopped('b'))).toBe(true);
    expect(tabIsPinnable(draft('c'))).toBe(false);
  });
});

describe('nextPin (the ⌘D decision table)', () => {
  it('pins the active live tab when nothing is pinned', () => {
    expect(
      nextPin({ tabs: [tab('a'), tab('b')], activeTabId: 'a', pinnedTabId: null })
    ).toEqual({ pin: 'a', applied: true });
  });

  it('unpins a live pin', () => {
    expect(
      nextPin({ tabs: [tab('a'), tab('b')], activeTabId: 'b', pinnedTabId: 'a' })
    ).toEqual({ pin: null, applied: true });
  });

  it('unpins a STOPPED pin — muscle memory holds; a dead pin must not make ⌘D silently pin something else (D26)', () => {
    expect(
      nextPin({
        tabs: [stopped('a'), tab('b')],
        activeTabId: 'b',
        pinnedTabId: 'a',
      })
    ).toEqual({ pin: null, applied: true });
  });

  it('does nothing on a draft with no pin (nothing to watch yet)', () => {
    expect(
      nextPin({ tabs: [draft('a')], activeTabId: 'a', pinnedTabId: null })
    ).toEqual({ pin: null, applied: false });
  });

  it('a pin whose tab is GONE never blocks the key: the active tab pins', () => {
    expect(
      nextPin({ tabs: [tab('b')], activeTabId: 'b', pinnedTabId: 'gone' })
    ).toEqual({ pin: 'b', applied: true });
  });

  it('drops a gone pin even when the active tab cannot pin', () => {
    expect(
      nextPin({ tabs: [draft('a')], activeTabId: 'a', pinnedTabId: 'gone' })
    ).toEqual({ pin: null, applied: true });
  });

  it('is inert with no pin and no active tab', () => {
    expect(nextPin({ tabs: [], activeTabId: null, pinnedTabId: null })).toEqual(
      { pin: null, applied: false }
    );
  });
});

describe('resolveStageLayout', () => {
  it('without a pin the active tab is full and everything else hidden', () => {
    const layout = resolveStageLayout({
      entries: [entry(tab('a')), entry(tab('b'))],
      activeTabId: 'a',
      emptyProjectStage: false,
      pinnedTabId: null,
      companionTabId: null,
    });
    expect(layout.split).toBe(false);
    expect(layout.layoutFor('a')).toBe('full');
    expect(layout.layoutFor('b')).toBe('hidden');
    expect(layout.stagePane).toBe('hidden');
  });

  it('splits driven LEFT / pinned RIGHT when driving another live tab', () => {
    const layout = resolveStageLayout({
      entries: [entry(tab('pin')), entry(tab('drive')), entry(tab('other'))],
      activeTabId: 'drive',
      emptyProjectStage: false,
      pinnedTabId: 'pin',
      companionTabId: null,
    });
    expect(layout.split).toBe(true);
    expect(layout.layoutFor('drive')).toBe('left');
    expect(layout.layoutFor('pin')).toBe('right');
    expect(layout.layoutFor('other')).toBe('hidden');
  });

  it('keeps the pinned pane up on an EMPTY Project — the composer drives the left side (the reported disappearing-pane bug)', () => {
    const layout = resolveStageLayout({
      entries: [entry(tab('pin'), '/elsewhere')],
      activeTabId: null,
      emptyProjectStage: true,
      pinnedTabId: 'pin',
      companionTabId: null,
    });
    expect(layout.split).toBe(true);
    expect(layout.stagePane).toBe('left');
    expect(layout.layoutFor('pin')).toBe('right');
  });

  it('renders the empty-Project composer full when nothing is pinned', () => {
    const layout = resolveStageLayout({
      entries: [],
      activeTabId: null,
      emptyProjectStage: true,
      pinnedTabId: null,
      companionTabId: null,
    });
    expect(layout.stagePane).toBe('full');
  });

  it('a STOPPED pin keeps its pane — the split survives the watched session exiting (D26)', () => {
    const layout = resolveStageLayout({
      entries: [entry(stopped('pin')), entry(tab('drive'))],
      activeTabId: 'drive',
      emptyProjectStage: false,
      pinnedTabId: 'pin',
      companionTabId: null,
    });
    expect(layout.split).toBe(true);
    expect(layout.layoutFor('pin')).toBe('right');
    expect(layout.layoutFor('drive')).toBe('left');
  });

  it('a ⌘T draft page drives the left side beside the pin instead of covering the stage', () => {
    const layout = resolveStageLayout({
      entries: [entry(tab('pin')), entry(draft('fresh'))],
      activeTabId: 'fresh',
      emptyProjectStage: false,
      pinnedTabId: 'pin',
      companionTabId: null,
    });
    expect(layout.split).toBe(true);
    expect(layout.layoutFor('fresh')).toBe('left');
    expect(layout.layoutFor('pin')).toBe('right');
  });

  it('clicking into the pinned pane keeps the companion driving — active = pinned never collapses the split', () => {
    const layout = resolveStageLayout({
      entries: [entry(tab('pin')), entry(tab('was-driving'))],
      activeTabId: 'pin',
      emptyProjectStage: false,
      pinnedTabId: 'pin',
      companionTabId: 'was-driving',
    });
    expect(layout.split).toBe(true);
    expect(layout.layoutFor('was-driving')).toBe('left');
    expect(layout.layoutFor('pin')).toBe('right');
  });

  it('a stopped companion still holds the left pane (the driven side can be dead too)', () => {
    const layout = resolveStageLayout({
      entries: [entry(tab('pin')), entry(stopped('was-driving'))],
      activeTabId: 'pin',
      emptyProjectStage: false,
      pinnedTabId: 'pin',
      companionTabId: 'was-driving',
    });
    expect(layout.split).toBe(true);
    expect(layout.layoutFor('was-driving')).toBe('left');
  });

  it('the pin renders alone when active IS the pin and its companion is gone', () => {
    const layout = resolveStageLayout({
      entries: [entry(tab('pin'))],
      activeTabId: 'pin',
      emptyProjectStage: false,
      pinnedTabId: 'pin',
      companionTabId: 'closed-tab',
    });
    expect(layout.split).toBe(false);
    expect(layout.layoutFor('pin')).toBe('full');
    expect(layout.stagePane).toBe('hidden');
  });

  it('a pinnedTabId whose tab is gone behaves as unpinned', () => {
    const layout = resolveStageLayout({
      entries: [entry(tab('a'))],
      activeTabId: 'a',
      emptyProjectStage: false,
      pinnedTabId: 'gone',
      companionTabId: null,
    });
    expect(layout.pinned).toBeNull();
    expect(layout.split).toBe(false);
    expect(layout.layoutFor('a')).toBe('full');
  });

  it('a draft can never be the pin, even if state says so', () => {
    const layout = resolveStageLayout({
      entries: [entry(draft('d')), entry(tab('a'))],
      activeTabId: 'a',
      emptyProjectStage: false,
      pinnedTabId: 'd',
      companionTabId: null,
    });
    expect(layout.pinned).toBeNull();
    expect(layout.layoutFor('a')).toBe('full');
    expect(layout.layoutFor('d')).toBe('hidden');
  });

  it('a companion equal to the pin never splits the pane against itself', () => {
    const layout = resolveStageLayout({
      entries: [entry(tab('pin'))],
      activeTabId: 'pin',
      emptyProjectStage: false,
      pinnedTabId: 'pin',
      companionTabId: 'pin',
    });
    expect(layout.split).toBe(false);
    expect(layout.layoutFor('pin')).toBe('full');
  });
});
