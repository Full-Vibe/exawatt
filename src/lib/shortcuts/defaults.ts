import type { ShortcutDefinition } from '@/types/shortcuts';

/**
 * Default shortcut definitions (Phase 1: Navigation)
 *
 * These define the keys, labels, and contexts for shortcuts.
 * Actions are bound at runtime by the ShortcutProvider.
 */
export const defaultShortcuts: ShortcutDefinition[] = [
  // Navigation - Go chords (G → X)
  {
    id: 'go-dashboard',
    keys: [{ key: 'g' }, { key: 'd' }],
    label: 'Go to Dashboard',
    description: 'Navigate to the dashboard view',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'go-board',
    keys: [{ key: 'g' }, { key: 'b' }],
    label: 'Go to Board',
    description: 'Navigate to the board view',
    category: 'navigation',
    contexts: ['global'],
  },
  {
    id: 'go-projects',
    keys: [{ key: 'g' }, { key: 'p' }],
    label: 'Go to Projects',
    description: 'Navigate to projects list',
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
];

/**
 * Get a shortcut definition by ID
 */
export function getDefaultShortcut(id: string): ShortcutDefinition | undefined {
  return defaultShortcuts.find((s) => s.id === id);
}
