/**
 * Where a tab's pane sits on the workspace stage (S2 split view): full when
 * alone, left/right when the active tab shares the surface with the pinned
 * tab, hidden otherwise. Panes stay absolutely positioned so hidden ones
 * never affect layout, and a hidden pane is HIDDEN, not unmounted: every
 * kind of pane keeps its state through a tab switch the same way, whether
 * what it holds is a terminal's scrollback or a coworker's half-typed
 * message (BUG-148).
 */
export type PaneLayout = 'full' | 'left' | 'right' | 'hidden';

export const LAYOUT_CLASS: Record<PaneLayout, string> = {
  full: 'absolute inset-0',
  left: 'absolute inset-y-0 left-0 w-1/2',
  right: 'absolute inset-y-0 right-0 w-1/2',
  hidden: 'absolute inset-0 invisible',
};
