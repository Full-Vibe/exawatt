import type { ShortcutDefinition } from '@/types/shortcuts';

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
    label: 'Go to Terminal',
    description: 'Navigate to the terminal workspace (near altitude)',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'go-sessions',
    keys: [{ key: 'g' }, { key: 'o' }],
    label: 'Go to Sessions',
    description: 'Navigate to the session overview (middle altitude)',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'go-spatial',
    keys: [{ key: 'g' }, { key: 'm' }],
    label: 'Go to Spatial',
    description: 'Navigate to Spatial Command (far altitude)',
    category: 'navigation',
    contexts: ['global'],
  },
  // Primary command-altitude keys (ENG-016 D12). These are absolute,
  // idempotent destinations rather than contextual toggles: repeating one
  // focuses/recenters that altitude instead of leaving it.
  {
    id: 'command-terminal',
    keys: { key: '1', modifiers: ['meta'] },
    label: 'Terminal',
    description: 'Open or focus Terminal command altitude',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'command-sessions',
    keys: { key: '2', modifiers: ['meta'] },
    label: 'Sessions',
    description: 'Open or focus Sessions command altitude',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'command-spatial',
    keys: { key: '3', modifiers: ['meta'] },
    label: 'Spatial',
    description: 'Open or recenter Spatial command altitude',
    category: 'navigation',
    contexts: ['global'],
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
    id: 'go-dashboard',
    keys: [{ key: 'g' }, { key: 'd' }],
    label: 'Go to Lattice (legacy)',
    description: 'Navigate to the legacy Lattice demo dashboard',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'go-board',
    keys: [{ key: 'g' }, { key: 'b' }],
    label: 'Go to Board (legacy)',
    description: 'Navigate to the legacy kanban board',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'go-fleet',
    keys: [{ key: 'g' }, { key: 'f' }],
    label: 'Go to Fleet Command (legacy)',
    description: 'Navigate to the legacy fleet dashboard',
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
  // ⌘⌥1–9 (project ordinals) and ⌘⇧[ / ⌘⇧] (tab ring) stay fixed
  // key families outside the registry.
  {
    id: 'workspace-new-shell',
    keys: { key: 't', modifiers: ['meta'] },
    label: 'New shell in the active project',
    description: 'Launch a shell session in the active project',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-new-project',
    keys: { key: 'n', modifiers: ['meta'] },
    label: 'Open a new project (browse for a folder)',
    description: 'Pick a directory and open it as a Project',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-close-tab',
    keys: { key: 'w', modifiers: ['meta'] },
    label: 'Close the active tab',
    description: 'End the active session tab',
    category: 'workspace',
    contexts: ['workspace'],
  },
  {
    id: 'workspace-jump-attention',
    keys: { key: 'j', modifiers: ['meta'] },
    label: 'Jump to the session needing you',
    description: 'Focus the oldest needs-attention session',
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
    label: 'Roadmap rail (open / focus / collapse)',
    description: 'Cycle the project roadmap rail',
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

  // Board view shortcuts
  {
    id: 'view-status',
    keys: { key: '1' },
    label: 'Status View',
    description: 'Group tasks by status',
    category: 'view',
    contexts: ['board'],
  },
  {
    id: 'view-project',
    keys: { key: '2' },
    label: 'Project View',
    description: 'Group tasks by project',
    category: 'view',
    contexts: ['board'],
  },
  {
    id: 'view-swimlane',
    keys: { key: '3' },
    label: 'Swimlane View',
    description: 'Show tasks in swimlane layout',
    category: 'view',
    contexts: ['board'],
  },

  // Task navigation (Phase 2)
  {
    id: 'task-next',
    keys: { key: 'j' },
    label: 'Next Task',
    description: 'Move focus to next task',
    category: 'selection',
    contexts: ['board'],
  },
  {
    id: 'task-next-arrow',
    keys: { key: 'ArrowDown' },
    label: 'Next Task',
    description: 'Move focus to next task',
    category: 'selection',
    contexts: ['board'],
  },
  {
    id: 'task-prev',
    keys: { key: 'k' },
    label: 'Previous Task',
    description: 'Move focus to previous task',
    category: 'selection',
    contexts: ['board'],
  },
  {
    id: 'task-prev-arrow',
    keys: { key: 'ArrowUp' },
    label: 'Previous Task',
    description: 'Move focus to previous task',
    category: 'selection',
    contexts: ['board'],
  },
  {
    id: 'task-open',
    keys: { key: 'Enter' },
    label: 'Open Task',
    description: 'Open the focused task detail',
    category: 'selection',
    contexts: ['board'],
  },
  {
    id: 'task-close',
    keys: { key: 'Escape' },
    label: 'Close / Deselect',
    description: 'Close task detail or clear selection',
    category: 'selection',
    contexts: ['board', 'task-detail'],
  },
  {
    id: 'task-select-extend-down',
    keys: { key: 'j', modifiers: ['shift'] },
    label: 'Extend Selection Down',
    description: 'Add next task to selection',
    category: 'selection',
    contexts: ['board'],
  },
  {
    id: 'task-select-extend-up',
    keys: { key: 'k', modifiers: ['shift'] },
    label: 'Extend Selection Up',
    description: 'Add previous task to selection',
    category: 'selection',
    contexts: ['board'],
  },
  {
    id: 'task-toggle-select',
    keys: { key: 'x' },
    label: 'Toggle Selection',
    description: 'Toggle selection on focused task',
    category: 'selection',
    contexts: ['board'],
  },
  {
    id: 'task-select-all',
    keys: { key: 'a', modifiers: ['meta'] },
    label: 'Select All',
    description: 'Select all visible tasks',
    category: 'selection',
    contexts: ['board'],
  },
];

/**
 * Get a shortcut definition by ID
 */
export function getDefaultShortcut(id: string): ShortcutDefinition | undefined {
  return defaultShortcuts.find(s => s.id === id);
}
