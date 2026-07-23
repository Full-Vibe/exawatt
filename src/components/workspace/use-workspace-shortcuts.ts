/**
 * Workspace keyboard layer (ENG-002 — "Spaces-speed switching").
 *
 *   ⌘T            summon the Agent composer (D20 — Agents are primary)
 *   ⌘⇧T           open a shell in the active Project
 *   ⌘N            open the Project chooser
 *   ⌘W (or ⌘⇧W)  close the active tab, or the active empty Project
 *   ⌘1…⌘9        jump to tab N of the global ring (D18, browser-style)
 *   ⌘⌥1…⌘⌥9      jump to Project N
 *   ⌘⇧[ / ⌘⇧]    previous / next tab (wraps)
 *   ⌘⌥[ / ⌘⌥]    move the active tab within its Project (D20)
 *   ⌘⌥⇧[ / ⌘⌥⇧]  move the active Project in the strip (D20)
 *   ⌘J           jump to the oldest session needing attention (S1)
 *   ⌃⌘1 / ⌃⌘2 / ⌃⌘3  Terminal / Sessions / Spatial (D19 — off ⌘⇧3,
 *                     which macOS swallows for screenshots)
 *   ⌘K           session switcher / command palette (S2)
 *   ⌘D           split: pin the active tab beside whatever you drive (S2)
 *   ⌘B           roadmap rail: open → focus → collapse (ENG-017)
 *   ⌘E           rename the active tab inline (S2)
 *   ⌘/           keyboard cheat-sheet (S2)
 *   F6           toggle focus between terminal and workspace chrome
 *
 * ⌘-chords are global workspace verbs: they fire even while a terminal or
 * the working-dir input is focused (xterm consumes plain keys; ⌘-chords are
 * reserved for the workspace — the global chord engine can't see keystrokes
 * from inside xterm's hidden textarea). Every verb resolves its CURRENT
 * combo from the shortcut registry (ENG-016 D9), so rebinding in Settings
 * changes what the workspace responds to; only ⌘⌥1…9 and the ⌘⇧[/⌘⇧] tab
 * ring remain fixed key families. Each action reports whether it actually
 * applied — default behavior is prevented ONLY then, so impossible chords
 * (no tabs, web fallback) keep their browser behavior.
 */
import { useEffect } from 'react';
import { shortcutRegistry } from '@/lib/shortcuts';
import { eventToBinding } from '@/lib/shortcuts/format';
import { bindingsMatch, isChord } from '@/types/shortcuts';
import type { CommandAltitude } from '@/components/nav/command-altitude';

/** does this event match the registry's CURRENT binding for a shortcut id?
 *  (users can rebind any workspace verb; hard-coding combos here would make
 *  Settings lie inside the workspace — ENG-016 D9) */
function matchesRegistry(e: KeyboardEvent, id: string): boolean {
  const keys = shortcutRegistry.getEffectiveKeys(id);
  if (!keys || isChord(keys)) return false;
  return bindingsMatch(keys, eventToBinding(e));
}

/** the shifted variant of a binding (⌘⇧T for ⌘T) — an ALIAS only, matched
 *  after every explicit binding so a verb's implicit alias never shadows a
 *  different verb the user explicitly bound to that combo (review P1-2) */
function matchesShiftAliasOnly(e: KeyboardEvent, id: string): boolean {
  const keys = shortcutRegistry.getEffectiveKeys(id);
  if (!keys || isChord(keys) || keys.modifiers?.includes('shift')) return false;
  return bindingsMatch(
    { key: keys.key, modifiers: [...(keys.modifiers ?? []), 'shift'] },
    eventToBinding(e)
  );
}

/** text-entry surfaces where a modifier-less verb would eat the character
 *  (a mis-rebind of a workspace verb to a plain key) — the terminal's hidden
 *  textarea, form inputs, the rename editor, contenteditable */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'input, textarea, [contenteditable="true"], .xterm-helper-textarea, [cmdk-input]'
  );
}

export interface WorkspaceShortcutActions {
  launchShell: () => boolean;
  /** ⌘T — summon the Agent composer (the primary launch gesture) */
  newAgent: () => boolean;
  /** ⌘N — open Exawatt's curated Project chooser */
  newProject: () => boolean;
  /** close the active tab, or the active Project when it is empty */
  closeActive: () => boolean;
  selectIndex: (index: number) => boolean;
  /** ⌘1–⌘9 — jump to the Nth tab of the global ring */
  selectTabOrdinal: (index: number) => boolean;
  /** move selection by delta with wraparound */
  cycle: (delta: 1 | -1) => boolean;
  /** ⌘⌥[/]: nudge the active tab within its Project (D20) */
  moveTab: (delta: 1 | -1) => boolean;
  /** ⌘⌥⇧[/]: nudge the active Project in the strip (D20) */
  moveProject: (delta: 1 | -1) => boolean;
  /** jump to the oldest needs-attention session */
  jumpAttention: () => boolean;
  /** open or refocus one absolute command altitude */
  activateCommandAltitude: (target: CommandAltitude) => boolean;
  /** open the ⌘K palette (session switcher) */
  openPalette: () => boolean;
  /** toggle the split pin on the active tab */
  togglePin: () => boolean;
  /** ⌘B three-state cycle: open the roadmap rail → focus it → collapse it */
  toggleRoadmap: () => boolean;
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
    const isModalTarget = (e: KeyboardEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest('[role="dialog"], [cmdk-root]')
      ) {
        return true;
      }
      return false;
    };
    const onCaptureKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isModalTarget(e)) return;
      if (e.key === 'F6') {
        if (actions.toggleFocus()) e.preventDefault();
        return;
      }
      // Absolute command altitudes own capture phase so they work from xterm.
      // Require Command/Control here: a plain or Option-only rebind must never
      // eat terminal text or macOS character entry.
      if (e.metaKey || e.ctrlKey) {
        const altitudes: Array<[string, CommandAltitude]> = [
          ['command-terminal', 'terminal'],
          ['command-sessions', 'sessions'],
          ['command-spatial', 'spatial'],
        ];
        for (const [id, target] of altitudes) {
          if (matchesRegistry(e, id)) {
            if (actions.activateCommandAltitude(target)) e.preventDefault();
            return;
          }
        }
      }

      if (!e.metaKey || e.ctrlKey) return;

      // Fixed workspace navigation owns capture phase so xterm and the
      // global ⌘[/⌘] history layer cannot consume overlapping key families.
      if (!e.altKey && e.shiftKey && e.code === 'BracketLeft') {
        if (actions.cycle(-1)) e.preventDefault();
        return;
      }
      if (!e.altKey && e.shiftKey && e.code === 'BracketRight') {
        if (actions.cycle(1)) e.preventDefault();
        return;
      }
      // arrangement (D20): ⌘⌥ nudges the tab, ⌘⌥⇧ nudges the Project
      if (e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        const delta = e.code === 'BracketRight' ? 1 : -1;
        const apply = e.shiftKey ? actions.moveProject : actions.moveTab;
        if (apply(delta)) e.preventDefault();
        return;
      }
      const ordinal = /^Digit([1-9])$/.exec(e.code);
      if (e.altKey && !e.shiftKey && ordinal) {
        if (actions.selectIndex(Number(ordinal[1]) - 1)) {
          e.preventDefault();
        }
        return;
      }
      // ⌘1–⌘9 tab ordinals (D18): the highest-frequency switch gets the
      // cheapest chord. The altitude destinations matched above run first,
      // so a rebind of an altitude back onto a bare ⌘digit still wins there.
      if (!e.altKey && !e.shiftKey && ordinal) {
        if (actions.selectTabOrdinal(Number(ordinal[1]) - 1)) {
          e.preventDefault();
        }
      }
    };
    const onKey = (e: KeyboardEvent) => {
      // another window-level layer already handled this keystroke — never
      // double-apply a verb
      if (e.defaultPrevented) return;
      // a modal surface (⌘K palette, help modal) owns the keyboard while
      // open — ⌘W there must not close a terminal tab behind it
      if (isModalTarget(e)) return;
      if (e.key === 'Escape') {
        const inTerminal =
          e.target instanceof Element &&
          !!e.target.closest('.xterm-helper-textarea');
        if (!inTerminal && actions.focusTerminal()) e.preventDefault();
        return;
      }
      // a modifier-less keystroke in a text surface is TYPING — never let a
      // workspace verb consume it (guards against a verb mis-rebound to a
      // plain key eating terminal/input characters; every default verb uses
      // ⌘, so this only affects bad rebinds — review P1-3)
      const bareKey = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (bareKey && isEditableTarget(e.target)) return;

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

      // every workspace verb resolves its combo from the registry (D9):
      // rebinding it in Settings changes what the workspace responds to.
      // `shiftAlias` verbs (⌘T/⌘W) also answer ⌘⇧T/⌘⇧W — but ONLY after
      // every explicit binding is checked, so an alias never shadows a verb
      // the user bound to that exact combo (review P1-2).
      const verbs: Array<
        [id: string, apply: () => boolean, shiftAlias?: boolean]
      > = [
        ['workspace-new-agent', actions.newAgent],
        ['workspace-new-shell', actions.launchShell],
        ['workspace-new-project', actions.newProject],
        ['workspace-close-tab', actions.closeActive, true],
        ['workspace-jump-attention', actions.jumpAttention],
        ['workspace-split', actions.togglePin],
        ['workspace-roadmap', actions.toggleRoadmap],
        ['workspace-rename', actions.renameActive],
      ];
      for (const [id, apply] of verbs) {
        if (matchesRegistry(e, id)) {
          if (apply()) e.preventDefault();
          return;
        }
      }
      for (const [id, apply, shiftAlias] of verbs) {
        if (shiftAlias && matchesShiftAliasOnly(e, id)) {
          if (apply()) e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener('keydown', onCaptureKey, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onCaptureKey, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [actions, enabled]);
}
