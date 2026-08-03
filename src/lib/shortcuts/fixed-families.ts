import type {
  KeyBinding,
  ModifierKey,
  ShortcutCategory,
} from '@/types/shortcuts';

export type FixedFamilyAction =
  | { kind: 'cycle-tab'; delta: 1 | -1 }
  | { kind: 'move-tab'; delta: 1 | -1 }
  | { kind: 'move-project'; delta: 1 | -1 }
  | { kind: 'select-project'; index: number }
  | { kind: 'select-tab'; index: number }
  | { kind: 'toggle-focus' }
  | { kind: 'focus-terminal' };

/** Structural slice of KeyboardEvent, so matching stays pure and DOM-free. */
export interface FixedFamilyKeyEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

type NonEmptyIds = readonly [string, ...string[]];

type Surfaced = {
  paletteRowIds: NonEmptyIds;
  menuCommandIds: NonEmptyIds;
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

type LiteralTrigger = {
  kind: 'literal';
  key: 'F6' | 'Escape';
  modifiers?: readonly ModifierKey[];
  action: Extract<
    FixedFamilyAction,
    { kind: 'toggle-focus' | 'focus-terminal' }
  >;
};

type BracketPairTrigger = {
  kind: 'bracket-pair';
  modifiers: readonly ModifierKey[];
  actionKind: 'cycle-tab' | 'move-tab' | 'move-project';
};

type DigitOrdinalTrigger = {
  kind: 'digit-ordinals';
  modifiers: readonly ModifierKey[];
  actionKind: 'select-project' | 'select-tab';
};

export type FixedFamilyTrigger =
  | LiteralTrigger
  | BracketPairTrigger
  | DigitOrdinalTrigger;

type FixedKeyFamilyDefinition = {
  id: string;
  label: string;
  category: ShortcutCategory;
  phase: 'capture' | 'bubble';
  /** Matched before the absolute command altitudes (F6 only). */
  outranksAltitudes?: boolean;
  trigger: FixedFamilyTrigger;
} & (Surfaced | Unsurfaced);

export type FixedKeyFamily = DisplayKeyFamily & FixedKeyFamilyDefinition;

function binding(key: string, modifiers: readonly ModifierKey[]): KeyBinding {
  return {
    key,
    ...(modifiers.length > 0 ? { modifiers: [...modifiers] } : {}),
  };
}

function displayKeys(trigger: FixedFamilyTrigger): KeyBinding {
  switch (trigger.kind) {
    case 'literal':
      return binding(trigger.key, trigger.modifiers ?? []);
    case 'bracket-pair':
      return binding('[ / ]', trigger.modifiers);
    case 'digit-ordinals':
      return binding('1…9', trigger.modifiers);
  }
}

function defineFixedFamily(
  definition: FixedKeyFamilyDefinition
): FixedKeyFamily {
  return { ...definition, keys: displayKeys(definition.trigger) };
}

function modifiersMatch(
  event: FixedFamilyKeyEvent,
  modifiers: readonly ModifierKey[]
): boolean {
  return (
    event.metaKey === modifiers.includes('meta') &&
    event.ctrlKey === modifiers.includes('ctrl') &&
    event.altKey === modifiers.includes('alt') &&
    event.shiftKey === modifiers.includes('shift')
  );
}

/** Concrete bindings derived from the executable trigger declaration. */
export function fixedFamilyBindings(family: FixedKeyFamily): KeyBinding[] {
  const { trigger } = family;
  switch (trigger.kind) {
    case 'literal':
      return [binding(trigger.key, trigger.modifiers ?? [])];
    case 'bracket-pair':
      return [binding('[', trigger.modifiers), binding(']', trigger.modifiers)];
    case 'digit-ordinals':
      return Array.from({ length: 9 }, (_, index) =>
        binding(String(index + 1), trigger.modifiers)
      );
  }
}

/** Match behavior derives from the same trigger that produces help/menu keys. */
export function matchFixedFamily(
  family: FixedKeyFamily,
  event: FixedFamilyKeyEvent
): FixedFamilyAction | null {
  const { trigger } = family;
  if (!modifiersMatch(event, trigger.modifiers ?? [])) return null;

  switch (trigger.kind) {
    case 'literal':
      return event.key === trigger.key ? trigger.action : null;
    case 'bracket-pair': {
      const delta =
        event.code === 'BracketLeft'
          ? -1
          : event.code === 'BracketRight'
            ? 1
            : null;
      return delta === null ? null : { kind: trigger.actionKind, delta };
    }
    case 'digit-ordinals': {
      const ordinal = /^Digit([1-9])$/.exec(event.code);
      return ordinal
        ? { kind: trigger.actionKind, index: Number(ordinal[1]) - 1 }
        : null;
    }
  }
}

/** Fixed workspace commands in dispatch precedence order (ENG-016 D44). */
export const WORKSPACE_KEY_FAMILIES: readonly FixedKeyFamily[] = [
  defineFixedFamily({
    id: 'fixed-focus-toggle',
    label: 'Move focus between the Session and app controls',
    category: 'workspace',
    phase: 'capture',
    outranksAltitudes: true,
    trigger: {
      kind: 'literal',
      key: 'F6',
      action: { kind: 'toggle-focus' },
    },
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'Focus movement has no nameable target; a palette row would leave the palette merely to move focus elsewhere.',
  }),
  defineFixedFamily({
    id: 'fixed-tab-ring',
    label: 'Previous / next Session across Projects',
    category: 'workspace',
    phase: 'capture',
    trigger: {
      kind: 'bracket-pair',
      modifiers: ['meta', 'shift'],
      actionKind: 'cycle-tab',
    },
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'The command palette lists every Session directly, so stepping the ring from a row would duplicate targets already on screen.',
  }),
  defineFixedFamily({
    id: 'fixed-move-tab',
    label: 'Move Session tab left / right',
    category: 'workspace',
    phase: 'capture',
    trigger: {
      kind: 'bracket-pair',
      modifiers: ['meta', 'alt'],
      actionKind: 'move-tab',
    },
    paletteRowIds: ['ws-move-left', 'ws-move-right'],
    menuCommandIds: ['move-tab-left', 'move-tab-right'],
  }),
  defineFixedFamily({
    id: 'fixed-move-project',
    label: 'Move Project left / right',
    category: 'workspace',
    phase: 'capture',
    trigger: {
      kind: 'bracket-pair',
      modifiers: ['meta', 'alt', 'shift'],
      actionKind: 'move-project',
    },
    paletteRowIds: ['ws-move-project-left', 'ws-move-project-right'],
    menuCommandIds: ['move-project-left', 'move-project-right'],
  }),
  defineFixedFamily({
    id: 'fixed-project-ordinals',
    label: 'Jump to Project 1–9',
    category: 'workspace',
    phase: 'capture',
    trigger: {
      kind: 'digit-ordinals',
      modifiers: ['meta', 'alt'],
      actionKind: 'select-project',
    },
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'The command palette opens any Project by name, which subsumes positional jumps and continues working beyond the ninth Project.',
  }),
  defineFixedFamily({
    id: 'fixed-tab-ordinals',
    label: 'Jump to Session 1–8, or 9 for the last Session',
    category: 'workspace',
    phase: 'capture',
    trigger: {
      kind: 'digit-ordinals',
      modifiers: ['meta'],
      actionKind: 'select-tab',
    },
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'The command palette lists every Session by name and status; a positional row would say less about the same target.',
  }),
  defineFixedFamily({
    id: 'fixed-focus-terminal',
    label: 'Return focus to the Session',
    category: 'workspace',
    phase: 'bubble',
    trigger: {
      kind: 'literal',
      key: 'Escape',
      action: { kind: 'focus-terminal' },
    },
    paletteRowIds: null,
    menuCommandIds: null,
    discoverability:
      'Escape belongs to the Session while its content owns focus; from app controls it is ambient back-out behavior with nothing to name.',
  }),
];

export function getWorkspaceFixedFamily(id: string): FixedKeyFamily {
  const family = WORKSPACE_KEY_FAMILIES.find(candidate => candidate.id === id);
  if (!family) throw new Error(`Unknown fixed shortcut family: ${id}`);
  return family;
}

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
