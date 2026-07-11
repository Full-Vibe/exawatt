/**
 * Workspace keyboard layer (ENG-002 — "Spaces-speed switching").
 *
 *   ⌘T (or ⌘⇧T)  ignite a shell
 *   ⌘W (or ⌘⇧W)  close the active tab
 *   ⌘1…⌘9        jump to tab N
 *   ⌘⇧[ / ⌘⇧]    previous / next tab (wraps)
 *   ⌘J           jump to the oldest session needing attention (S1)
 *   ⌘⇧M          switch regime: workspace ↔ spatial map
 *   ⌘K           session switcher / command palette (S2)
 *   ⌘O           exposé overview of all sessions (S3)
 *   ⌘D           split: pin the active tab beside whatever you drive (S2)
 *   ⌘E           rename the active tab inline (S2)
 *   ⌘/           keyboard cheat-sheet (S2)
 *   F6           toggle focus between terminal and workspace chrome
 *
 * ⌘-chords are global workspace verbs: they fire even while a terminal or
 * the working-dir input is focused (xterm consumes plain keys; ⌘-chords are
 * reserved for the workspace — the global chord engine can't see keystrokes
 * from inside xterm's hidden textarea, so the palette/help chords are
 * re-bound here, resolved from the registry so user rebinds keep working).
 * Each action reports whether it actually applied — default behavior is
 * prevented ONLY then, so impossible chords (no tabs, web fallback) keep
 * their browser behavior.
 */
import { useEffect } from 'react';
import { shortcutRegistry } from '@/lib/shortcuts';
import { eventToBinding } from '@/lib/shortcuts/format';
import { bindingsMatch, isChord } from '@/types/shortcuts';

/** does this event match the registry's CURRENT binding for a shortcut id?
 *  (users can rebind ⌘K/⌘/; hard-coding them here would make settings lie
 *  inside the workspace) */
function matchesRegistry(e: KeyboardEvent, id: string): boolean {
  const keys = shortcutRegistry.getEffectiveKeys(id);
  if (!keys || isChord(keys)) return false;
  return bindingsMatch(keys, eventToBinding(e));
}

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
  /** open the ⌘K palette (session switcher) */
  openPalette: () => boolean;
  /** toggle the exposé overview (S3) */
  toggleOverview: () => boolean;
  /** toggle the split pin on the active tab */
  togglePin: () => boolean;
  /** open the inline rename editor for the active tab */
  renameActive: () => boolean;
  /** open the keyboard cheat-sheet */
  openHelp: () => boolean;
  /** move focus to the other terminal/chrome region */
  toggleFocus: () => boolean;
  /** leave chrome and return to the active terminal */
  focusTerminal: () => boolean;
}

export function useWorkspaceShortcuts(
  actions: WorkspaceShortcutActions,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;
    const onFocusKey = (e: KeyboardEvent) => {
      if (e.key !== 'F6' || e.defaultPrevented) return;
      if (
        e.target instanceof Element &&
        e.target.closest('[role="dialog"], [cmdk-root]')
      ) {
        return;
      }
      if (actions.toggleFocus()) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      // another window-level layer (the global chord engine also binds
      // ⌘⇧M) already handled this keystroke — never double-apply a verb
      if (e.defaultPrevented) return;
      // a modal surface (⌘K palette, help modal) owns the keyboard while
      // open — ⌘W there must not close a terminal tab behind it
      if (
        e.target instanceof Element &&
        e.target.closest('[role="dialog"], [cmdk-root]')
      ) {
        return;
      }
      if (e.key === 'Escape') {
        const inTerminal =
          e.target instanceof Element &&
          !!e.target.closest('.xterm-helper-textarea');
        if (!inTerminal && actions.focusTerminal()) e.preventDefault();
        return;
      }
      // palette + cheat-sheet: registry-resolved (rebindable), reachable
      // from inside terminals where the chord engine is blind
      if (matchesRegistry(e, 'command-palette')) {
        if (actions.openPalette()) e.preventDefault();
        return;
      }
      if (matchesRegistry(e, 'help-modal-slash')) {
        if (actions.openHelp()) e.preventDefault();
        return;
      }

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
      } else if (key === 'o' && !e.shiftKey) {
        if (actions.toggleOverview()) e.preventDefault();
      } else if (key === 'd' && !e.shiftKey) {
        if (actions.togglePin()) e.preventDefault();
      } else if (key === 'e' && !e.shiftKey) {
        if (actions.renameActive()) e.preventDefault();
      } else if (!e.shiftKey && e.key >= '1' && e.key <= '9') {
        if (actions.selectIndex(Number(e.key) - 1)) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onFocusKey, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onFocusKey, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [actions, enabled]);
}
