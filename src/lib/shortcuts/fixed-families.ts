import type { KeyBinding, ShortcutCategory } from '@/types/shortcuts';

export type FixedFamilyAction =
  | { kind: 'cycle-tab'; delta: 1 | -1 }
  | { kind: 'move-tab'; delta: 1 | -1 }
  | { kind: 'move-project'; delta: 1 | -1 }
  | { kind: 'select-project'; index: number }
  | { kind: 'select-tab'; index: number }
  | { kind: 'toggle-focus' }
  | { kind: 'focus-terminal' };

/** Structural slice of KeyboardEvent, so matchers stay pure and DOM-free. */
export interface FixedFamilyKeyEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

type Surfaced = {
  paletteRowIds: readonly string[];
  menuCommandIds: readonly string[];
};

type Unsurfaced = {
  paletteRowIds: null;
  menuCommandIds: null;
  /** Required record of why this family has no palette or menu row. */
  discoverability: string;
};

export interface DisplayKeyFamily {
  id: string;
  label: string;
  keys: KeyBinding;
  category: ShortcutCategory;
}

export type FixedKeyFamily = DisplayKeyFamily & {
  phase: 'capture' | 'bubble';
  /** Matched before the absolute command altitudes (F6 only). */
  outranksAltitudes?: boolean;
  match(event: FixedFamilyKeyEvent): FixedFamilyAction | null;
} & (Surfaced | Unsurfaced);

function hasNoModifiers(event: FixedFamilyKeyEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

function bracketDelta(event: FixedFamilyKeyEvent): 1 | -1 | null {
  if (event.code === 'BracketLeft') return -1;
  if (event.code === 'BracketRight') return 1;
  return null;
}

function digitIndex(event: FixedFamilyKeyEvent): number | null {
  const ordinal = /^Digit([1-9])$/.exec(event.code);
  return ordinal ? Number(ordinal[1]) - 1 : null;
}

/**
 * Fixed workspace commands in dispatch precedence order. Behavior and the
 * shortcut help surface both derive from this declaration (ENG-016 D44).
 */
export const WORKSPACE_KEY_FAMILIES: readonly FixedKeyFamily[] = [
  {
    id: 'fixed-focus-toggle',
    label: 'Move focus between terminal and chrome',
    keys: { key: 'F6' },
    category: 'workspace',
    phase: 'capture',
    outranksAltitudes: true,
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'Focus movement has no nameable target; a palette row would leave the palette merely to move focus elsewhere.',
    match: event =>
      event.key === 'F6' && hasNoModifiers(event)
        ? { kind: 'toggle-focus' }
        : null,
  },
  {
    id: 'fixed-tab-ring',
    label: 'Previous / next tab (global ring)',
    keys: { key: '[ / ]', modifiers: ['meta', 'shift'] },
    category: 'workspace',
    phase: 'capture',
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'The command palette lists every Session directly, so stepping the ring from a row would duplicate targets already on screen.',
    match: event => {
      const delta = bracketDelta(event);
      return event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.shiftKey &&
        delta !== null
        ? { kind: 'cycle-tab', delta }
        : null;
    },
  },
  {
    id: 'fixed-move-tab',
    label: 'Move tab left / right',
    keys: { key: '[ / ]', modifiers: ['meta', 'alt'] },
    category: 'workspace',
    phase: 'capture',
    paletteRowIds: ['ws-move-left', 'ws-move-right'],
    menuCommandIds: ['move-tab-left', 'move-tab-right'],
    match: event => {
      const delta = bracketDelta(event);
      return event.metaKey &&
        !event.ctrlKey &&
        event.altKey &&
        !event.shiftKey &&
        delta !== null
        ? { kind: 'move-tab', delta }
        : null;
    },
  },
  {
    id: 'fixed-move-project',
    label: 'Move Project left / right',
    keys: { key: '[ / ]', modifiers: ['meta', 'alt', 'shift'] },
    category: 'workspace',
    phase: 'capture',
    paletteRowIds: ['ws-move-project-left', 'ws-move-project-right'],
    menuCommandIds: ['move-project-left', 'move-project-right'],
    match: event => {
      const delta = bracketDelta(event);
      return event.metaKey &&
        !event.ctrlKey &&
        event.altKey &&
        event.shiftKey &&
        delta !== null
        ? { kind: 'move-project', delta }
        : null;
    },
  },
  {
    id: 'fixed-project-ordinals',
    label: 'Jump to Project 1–9',
    keys: { key: '1…9', modifiers: ['meta', 'alt'] },
    category: 'workspace',
    phase: 'capture',
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'The command palette opens any Project by name, which subsumes positional jumps and continues working beyond the ninth Project.',
    match: event => {
      const index = digitIndex(event);
      return event.metaKey &&
        !event.ctrlKey &&
        event.altKey &&
        !event.shiftKey &&
        index !== null
        ? { kind: 'select-project', index }
        : null;
    },
  },
  {
    id: 'fixed-tab-ordinals',
    label: 'Jump to tab 1–8, or 9 for the last tab',
    keys: { key: '1…9', modifiers: ['meta'] },
    category: 'workspace',
    phase: 'capture',
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'The command palette lists every Session by name and status; a positional row would say less about the same target.',
    match: event => {
      const index = digitIndex(event);
      return event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        index !== null
        ? { kind: 'select-tab', index }
        : null;
    },
  },
  {
    id: 'fixed-focus-terminal',
    label: 'Return focus to the terminal',
    keys: { key: 'Escape' },
    category: 'workspace',
    phase: 'bubble',
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'Escape belongs to the agent while terminal focus is active; from chrome it is ambient back-out behavior with nothing to name.',
    match: event =>
      event.key === 'Escape' && hasNoModifiers(event)
        ? { kind: 'focus-terminal' }
        : null,
  },
];

/** Fleet board keys are display-only: the focused R3F surface owns behavior. */
export const BOARD_KEY_FAMILIES = [
  {
    id: 'fixed-board-project-ordinals',
    category: 'view',
    label: 'Fleet: open Project 1–9',
    keys: { key: '1…9' },
  },
  {
    id: 'fixed-board-pan',
    category: 'view',
    label: 'Fleet: pan board',
    keys: { key: '← ↑ ↓ →' },
  },
  {
    id: 'fixed-board-zoom',
    category: 'view',
    label: 'Fleet: zoom board',
    keys: { key: '+ / −' },
  },
  {
    id: 'fixed-board-projection',
    category: 'view',
    label: 'Fleet: toggle projection',
    keys: { key: 'V' },
  },
  {
    id: 'fixed-board-overview',
    category: 'view',
    label: 'Fleet: recenter / overview',
    keys: { key: '0' },
  },
  {
    id: 'fixed-board-attention',
    category: 'view',
    label: 'Fleet: next / previous attention',
    keys: { key: 'N / P' },
  },
  {
    id: 'fixed-board-escape',
    category: 'view',
    label: 'Fleet: zoom out selection',
    keys: { key: 'Escape' },
  },
] as const satisfies readonly DisplayKeyFamily[];

export const ALL_FIXED_FAMILIES: readonly DisplayKeyFamily[] = [
  ...WORKSPACE_KEY_FAMILIES,
  ...BOARD_KEY_FAMILIES,
];
