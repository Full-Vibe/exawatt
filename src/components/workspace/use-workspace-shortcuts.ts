/**
 * Workspace keyboard layer (ENG-002 — "Spaces-speed switching").
 *
 *   ⌘T (or ⌘⇧T)  ignite a shell
 *   ⌘W (or ⌘⇧W)  close the active tab
 *   ⌘1…⌘9        jump to tab N
 *   ⌘⇧[ / ⌘⇧]    previous / next tab (wraps)
 *   ⌘J           jump to the oldest session needing attention (S1)
 *   ⌘⇧M          switch regime: workspace ↔ spatial map
 *
 * ⌘-chords are global workspace verbs: they fire even while a terminal or
 * the working-dir input is focused (xterm consumes plain keys; ⌘-chords are
 * reserved for the workspace). Each action reports whether it actually
 * applied — default behavior is prevented ONLY then, so impossible chords
 * (no tabs, web fallback) keep their browser behavior.
 */
import { useEffect } from 'react';

export interface WorkspaceShortcutActions {
  igniteShell: () => boolean;
  closeActive: () => boolean;
  selectIndex: (index: number) => boolean;
  /** move selection by delta with wraparound */
  cycle: (delta: 1 | -1) => boolean;
  /** jump to the oldest needs-attention session */
  jumpAttention: () => boolean;
  /** flip to the other UI regime (spatial map) */
  toggleRegime: () => boolean;
}

export function useWorkspaceShortcuts(
  actions: WorkspaceShortcutActions,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // another window-level layer (the global chord engine also binds
      // ⌘⇧M) already handled this keystroke — never double-apply a verb
      if (e.defaultPrevented) return;
      if (!e.metaKey || e.ctrlKey || e.altKey) return;

      // ⌘⇧[ / ⌘⇧] — use e.code: with shift held, e.key becomes '{' / '}'
      if (e.shiftKey && e.code === 'BracketLeft') {
        if (actions.cycle(-1)) e.preventDefault();
        return;
      }
      if (e.shiftKey && e.code === 'BracketRight') {
        if (actions.cycle(1)) e.preventDefault();
        return;
      }

      // lowercase so ⌘⇧T / ⌘⇧W keep working (shift capitalizes e.key)
      const key = e.key.toLowerCase();
      if (key === 't') {
        if (actions.igniteShell()) e.preventDefault();
      } else if (key === 'w') {
        if (actions.closeActive()) e.preventDefault();
      } else if (key === 'j' && !e.shiftKey) {
        if (actions.jumpAttention()) e.preventDefault();
      } else if (key === 'm' && e.shiftKey) {
        if (actions.toggleRegime()) e.preventDefault();
      } else if (!e.shiftKey && e.key >= '1' && e.key <= '9') {
        if (actions.selectIndex(Number(e.key) - 1)) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, enabled]);
}
