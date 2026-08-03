import type { ShortcutDefinition } from '@/types/shortcuts';
import { CONSUMPTION_SURFACE_NAME } from '@/components/consumption/surface-name';

/**
 * Default shortcut definitions (Phase 1: Navigation)
 *
 * These define the keys, labels, and contexts for shortcuts.
 * Actions are bound at runtime by the ShortcutProvider.
 */
export const defaultShortcuts: ShortcutDefinition[] = [
  // Navigation - Go chords (G → X). Targets and canonical names live in the
  // navigation manifest (src/components/nav/surfaces.ts); ids here must match
  // its shortcutId values.
  {
    id: 'go-workspace',
    keys: [{ key: 'g' }, { key: 'w' }],
    label: 'Go to Agent',
    description: 'Navigate to the Agent altitude (near — one live Agent)',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'go-sessions',
    keys: [{ key: 'g' }, { key: 'o' }],
    label: 'Go to Team',
    description: 'Navigate to the Team altitude (middle — all Sessions)',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'go-spatial',
    keys: [{ key: 'g' }, { key: 'm' }],
    label: 'Go to Fleet',
    description: 'Navigate to the Fleet altitude (far — everything at once)',
    category: 'navigation',
    contexts: ['global'],
  },
  // Primary command-altitude keys (ENG-016 D12, remapped by D18, then D19).
  // These are absolute, idempotent destinations rather than contextual
  // toggles: repeating one focuses/recenters that altitude instead of
  // leaving it. ⌘1–⌘9 belongs to Session tabs (browser convention — the
  // highest-frequency switch gets the cheapest chord). D18 put the altitudes
  // on ⌘⇧digit, but macOS owns ⇧⌘3/4/5/6 for screenshots and swallows them
  // before any app sees the keydown — ⌘⇧3 Spatial was dead on a real
  // keyboard (synthetic test events bypass the system layer, so only real
  // use caught it). D19: the altitudes ride ⌃⌘digit — same near→far digit
  // continuum, no system collisions, and ⌘ keeps them alive from xterm.
  {
    id: 'command-terminal',
    keys: { key: '1', modifiers: ['ctrl', 'meta'] },
    label: 'Agent',
    description: 'Open or focus the Agent altitude',
    category: 'navigation',
    contexts: ['global'],
    bindingPolicy: 'universal-command',
  },
  {
    id: 'command-sessions',
    keys: { key: '2', modifiers: ['ctrl', 'meta'] },
    label: 'Team',
    description: 'Open or focus the Team altitude',
    category: 'navigation',
    contexts: ['global'],
    bindingPolicy: 'universal-command',
  },
  {
    id: 'command-spatial',
    keys: { key: '3', modifiers: ['ctrl', 'meta'] },
    label: 'Fleet',
    description: 'Open or recenter the Fleet altitude',
    category: 'navigation',
    contexts: ['global'],
    bindingPolicy: 'universal-command',
  },
  {
    id: 'go-settings',
    keys: [{ key: 'g' }, { key: 's' }],
    label: 'Go to Settings',
    description: 'Navigate to settings',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'go-consumption',
    keys: [{ key: 'g' }, { key: 'c' }],
    label: `Go to ${CONSUMPTION_SURFACE_NAME}`,
    description: `Navigate to the ${CONSUMPTION_SURFACE_NAME} surface`,
    category: 'navigation',
    contexts: ['global'],
  },
  // History (ENG-016 D8): back/forward through router history while chrome
  // owns focus. The chord engine ignores events from inputs and xterm, so the
  // terminal keeps every key it owns; Escape stays "up the hierarchy" while
  // these answer "where I just was".
  {
    id: 'history-back',
    keys: { key: '[', modifiers: ['meta'] },
    label: 'Back',
    description: 'Go back to the previous surface',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'history-forward',
    keys: { key: ']', modifiers: ['meta'] },
    label: 'Forward',
    description: 'Go forward again after going back',
    category: 'navigation',
    contexts: ['global'],
  },

  // Terminal-workspace verbs (ENG-016 D9). Registered under the `workspace`
  // context, which the chord engine NEVER activates: the workspace key layer
  // is the sole executor (only it can see keystrokes inside xterm) and
  // resolves each combo from this registry — so these are rebindable in
  // Settings, conflict-checked, and listed dynamically in the cheat-sheet.
  // Positional ordinals, arrangement chords, and focus-boundary keys remain
  // fixed outside the registry; fixed-families.ts is their behavior/help
  // manifest (ENG-016 D44).
  // ⌘T is the PRIMARY launch gesture and Agents are the primary tool
  // (D14 hierarchy, D20 inversion): it summons the Agent composer. D39 pairs
  // that browser-style new-tab gesture with ⌘⇧T restore; shell remains a
  // direct but secondary Project tool on the non-conflicting ⌘⌥T.
  {
    id: 'workspace-new-agent',
    keys: { key: 't', modifiers: ['meta'] },
    label: 'New Agent in the active project',
    description: 'Summon the Agent composer',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-new-shell',
    keys: { key: 't', modifiers: ['meta', 'alt'] },
    label: 'New shell in the active project',
    description: 'Launch a shell session in the active project',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-new-project',
    keys: { key: 'n', modifiers: ['meta'] },
    label: 'Open Project chooser',
    description: 'Choose a known Project or add one from disk',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-close-tab',
    keys: { key: 'w', modifiers: ['meta'] },
    label: 'Close the active tab or empty Project',
    description: 'Close the active tab, or its Project when no tabs remain',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-reopen-closed-tab',
    keys: { key: 't', modifiers: ['meta', 'shift'] },
    label: 'Reopen the last closed tab',
    description: 'Restore the newest recoverable Session without starting it',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-jump-attention',
    keys: { key: 'j', modifiers: ['meta'] },
    label: 'Jump to the Session needing you',
    description: 'Focus the oldest visible needs-you Session',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-split',
    keys: { key: 'd', modifiers: ['meta'] },
    label: 'Split: pin / unpin the active tab',
    description: 'Pin the active tab beside the one you drive',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-rename',
    keys: { key: 'e', modifiers: ['meta'] },
    label: 'Rename the active tab',
    description: 'Open the inline rename editor',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-roadmap',
    keys: { key: 'b', modifiers: ['meta'] },
    label: 'Roadmap',
    description: 'Open the Project roadmap at the Team altitude',
    category: 'workspace',
    contexts: ['workspace'],
  },

  // Command palette
  {
    id: 'command-palette',
    keys: { key: 'k', modifiers: ['meta'] },
    label: 'Open Command Palette',
    description: 'Open the command palette to search actions and navigate',
    category: 'actions',
    contexts: ['global'],
  },

  // Quick feedback capture (ENG-025 F1): reachable from anywhere, including
  // inside xterm — the workspace key layer resolves this id like the palette.
  {
    id: 'quick-feedback',
    keys: { key: 'f', modifiers: ['meta', 'shift'] },
    label: 'Send feedback',
    description: 'Capture feedback from anywhere and keep moving',
    category: 'actions',
    contexts: ['global'],
  },

  // Help
  {
    id: 'help-modal',
    keys: { key: '?' },
    label: 'Show Keyboard Shortcuts',
    description: 'Display all available keyboard shortcuts',
    category: 'help',
    contexts: ['global'],
  },
  {
    id: 'help-modal-slash',
    keys: { key: '/', modifiers: ['meta'] },
    label: 'Keyboard Cheat-Sheet',
    description: 'Open the keyboard shortcuts overlay (works everywhere)',
    category: 'help',
    contexts: ['global'],
  },

];

/**
 * Get a shortcut definition by ID
 */
export function getDefaultShortcut(id: string): ShortcutDefinition | undefined {
  return defaultShortcuts.find(s => s.id === id);
}
