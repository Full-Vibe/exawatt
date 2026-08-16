/**
 * Command verb manifest (ENG-016 D44, extended for FIX-012).
 *
 * D44 made FIXED key families discoverable by construction: one typed
 * declaration drives dispatch, the `⌘/` sheet, palette rows, and native menu
 * items, and an omission has to be written down. It deliberately left the
 * other command class alone — the REBINDABLE verbs in the shortcut registry —
 * and that class kept the same defect: `defaults.ts`, the palette's row list,
 * the renderer's menu-command map, and the Electron menu template were four
 * hand-maintained lists with nothing joining them. Resume shipped with a
 * button, a strip menu entry, a chord and a palette row, and no native menu
 * item, and nothing could notice.
 *
 * This manifest is the one declaration for those verbs. Every verb states all
 * three discoverable surfaces:
 *
 * - `keys`     the rebindable registry binding, which is also the `⌘/` row
 * - `palette`  the command-palette row id
 * - `menu`     the native macOS menu item
 *
 * Each of the three is a union: either a real surface, or `null` plus a
 * written reason. The type forbids silence, so a verb cannot be born
 * undiscoverable — and `command-verbs.contract.test.ts` joins every declared
 * id to the surface that actually publishes it.
 *
 * It lives in the shared package because the renderer and the Electron main
 * process both derive from it. `electron/` cannot import `src/`, which is how
 * the menu template drifted from the registry in the first place.
 */

import { CONSUMPTION_SURFACE_NAME } from '../surface-names';

export type CommandVerbModifier = 'ctrl' | 'alt' | 'shift' | 'meta';

export interface CommandVerbBinding {
  key: string;
  modifiers?: CommandVerbModifier[];
}

export type CommandVerbKeys =
  | CommandVerbBinding
  | [CommandVerbBinding, CommandVerbBinding];

/** A two-key sequence (`g w`) rather than one combo. */
export function isChordKeys(
  keys: CommandVerbKeys
): keys is [CommandVerbBinding, CommandVerbBinding] {
  return Array.isArray(keys) && keys.length === 2;
}

export type CommandVerbCategory =
  | 'workspace'
  | 'navigation'
  | 'actions'
  | 'view'
  | 'help';

export type CommandVerbContext =
  | 'global'
  | 'workspace'
  | 'command-palette'
  | 'modal-open';

/**
 * Workspace command truth keys. Declared here so a verb's manifest entry can
 * name the availability it reads and the native menu can enable itself from
 * the same fact the palette row and the passive hints use.
 */
export type WorkspaceContextCommand =
  | 'launch-shell'
  | 'reopen-closed-tab'
  | 'rename-tab'
  | 'rename-project'
  | 'toggle-split'
  | 'close-tab'
  | 'move-tab-left'
  | 'move-tab-right'
  | 'move-project-left'
  | 'move-project-right'
  | 'jump-attention'
  | 'open-roadmap'
  | 'resume-agent'
  | 'resume-scope';

export type CommandVerbMenuSection =
  | 'application'
  | 'file'
  | 'go'
  | 'session'
  | 'help';

export interface CommandVerbMenu {
  /** id sent over `menu:command`, and the key the accelerator column uses */
  commandId: string;
  /** menu-bar wording, which is Title Case and its own register */
  label: string;
  section: CommandVerbMenuSection;
  /**
   * The main process registers this accelerator for real, so the renderer
   * never sees the keydown. Reserved for macOS chrome invariants (⌘,).
   */
  registerAccelerator?: true;
}

export type CommandVerbKeyboard = {
  keys: CommandVerbKeys;
  category: CommandVerbCategory;
  contexts: readonly CommandVerbContext[];
  bindingPolicy?: 'universal-command';
};

type KeyboardSurfaced = CommandVerbKeyboard;

type KeyboardUnsurfaced = {
  keys: null;
  /** REQUIRED: why this verb carries no rebindable binding. */
  keyboardDiscoverability: string;
};

type PaletteSurfaced = { palette: { rowId: string } };

type PaletteUnsurfaced = {
  palette: null;
  /** REQUIRED: why this verb has no command-palette row. */
  paletteDiscoverability: string;
};

type MenuSurfaced = { menu: CommandVerbMenu };

type MenuUnsurfaced = {
  menu: null;
  /** REQUIRED: why this verb has no native menu item. */
  menuDiscoverability: string;
};

export type CommandVerb = {
  /** stable id; also the registry shortcut id whenever `keys` is declared */
  id: string;
  /** what the `⌘/` sheet and Settings show */
  label: string;
  description: string;
  /** workspace truth this verb reads before it can run */
  availability?: WorkspaceContextCommand;
  /**
   * Verbs that LAUNCH into the personal workspace are inert while another
   * tenant is on screen (ENG-027); the dispatch point drops them whole.
   */
  tenantScope?: 'personal-workspace';
} & (KeyboardSurfaced | KeyboardUnsurfaced) &
  (PaletteSurfaced | PaletteUnsurfaced) &
  (MenuSurfaced | MenuUnsurfaced);

/**
 * Declaration order is menu order inside each section. Separators are placed
 * by the menu builder, which reads this list rather than restating it.
 */
export const COMMAND_VERBS: readonly CommandVerb[] = [
  // Navigation go-chords (G → X). Destinations, names and routes live in the
  // navigation manifest (`src/components/nav/surfaces.ts`); ids here match its
  // `shortcutId` values, and the contract test joins the two.
  {
    id: 'go-workspace',
    label: 'Go to Agent',
    description: 'Navigate to the Agent altitude (near — one live Agent)',
    keys: [{ key: 'g' }, { key: 'w' }],
    category: 'navigation',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'The navigation manifest publishes one palette row per destination and shows the direct gesture on it; a second row for the chord would list the same surface twice.',
    menu: null,
    menuDiscoverability:
      'The Go menu addresses this destination once, through the row that carries its direct ⌃⌘ gesture; a chord row beside it would make the menu argue with itself.',
  },
  {
    id: 'go-sessions',
    label: 'Go to Team',
    description: 'Navigate to the Team altitude (middle — all Sessions)',
    keys: [{ key: 'g' }, { key: 'o' }],
    category: 'navigation',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'The navigation manifest publishes one palette row per destination and shows the direct gesture on it; a second row for the chord would list the same surface twice.',
    menu: null,
    menuDiscoverability:
      'The Go menu addresses this destination once, through the row that carries its direct ⌃⌘ gesture; a chord row beside it would make the menu argue with itself.',
  },
  {
    id: 'go-spatial',
    label: 'Go to Fleet',
    description: 'Navigate to the Fleet altitude (far — everything at once)',
    keys: [{ key: 'g' }, { key: 'm' }],
    category: 'navigation',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'The navigation manifest publishes one palette row per destination and shows the direct gesture on it; a second row for the chord would list the same surface twice.',
    menu: null,
    menuDiscoverability:
      'The Go menu addresses this destination once, through the row that carries its direct ⌃⌘ gesture; a chord row beside it would make the menu argue with itself.',
  },
  {
    id: 'go-settings',
    label: 'Go to Settings',
    description: 'Navigate to settings',
    keys: [{ key: 'g' }, { key: 's' }],
    category: 'navigation',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'The navigation manifest publishes Settings as a destination row already; the chord shows on that row rather than earning a second one.',
    menu: null,
    menuDiscoverability:
      'Settings has its macOS home in the application menu on ⌘,, where every Mac app puts it; a Go row would be the second door to one room.',
  },
  {
    // The id is an address and never changes (E8); the chord follows the
    // display name — U for Usage (operator, 2026-08-11). `g c` is burned,
    // not aliased.
    id: 'go-consumption',
    label: `Go to ${CONSUMPTION_SURFACE_NAME}`,
    description: `Navigate to the ${CONSUMPTION_SURFACE_NAME} surface`,
    keys: [{ key: 'g' }, { key: 'u' }],
    category: 'navigation',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'The navigation manifest publishes one palette row per destination and shows the direct gesture on it; a second row for the chord would list the same surface twice.',
    menu: null,
    menuDiscoverability:
      'The Go menu addresses this destination through the navigation manifest’s own `go-<surface>` row, which carries the surface’s canonical name and readiness.',
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
    label: 'Agent',
    description: 'Open or focus the Agent altitude',
    keys: { key: '1', modifiers: ['ctrl', 'meta'] },
    category: 'navigation',
    contexts: ['global'],
    bindingPolicy: 'universal-command',
    palette: null,
    paletteDiscoverability:
      'The navigation manifest owns this destination’s palette row and renders this gesture on it, so the altitude is one searchable row rather than two.',
    menu: { commandId: 'go-terminal', label: 'Agent', section: 'go' },
  },
  {
    id: 'command-sessions',
    label: 'Team',
    description: 'Open or focus the Team altitude',
    keys: { key: '2', modifiers: ['ctrl', 'meta'] },
    category: 'navigation',
    contexts: ['global'],
    bindingPolicy: 'universal-command',
    palette: null,
    paletteDiscoverability:
      'The navigation manifest owns this destination’s palette row and renders this gesture on it, so the altitude is one searchable row rather than two.',
    menu: { commandId: 'go-sessions', label: 'Team', section: 'go' },
  },
  {
    id: 'command-spatial',
    label: 'Fleet',
    description: 'Open or recenter the Fleet altitude',
    keys: { key: '3', modifiers: ['ctrl', 'meta'] },
    category: 'navigation',
    contexts: ['global'],
    bindingPolicy: 'universal-command',
    palette: null,
    paletteDiscoverability:
      'The navigation manifest owns this destination’s palette row and renders this gesture on it, so the altitude is one searchable row rather than two.',
    menu: { commandId: 'go-spatial', label: 'Fleet', section: 'go' },
  },
  {
    id: 'open-settings',
    label: 'Settings',
    description: 'Open application settings',
    keys: { key: ',', modifiers: ['meta'] },
    category: 'navigation',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'The navigation manifest already publishes Settings as a destination row (ENG-016 D8); a second row for the same surface would split its search terms.',
    menu: {
      commandId: 'open-settings',
      label: 'Settings…',
      section: 'application',
      // The one natively registered accelerator: ⌘, is a macOS chrome
      // invariant and must work before the renderer exists.
      registerAccelerator: true,
    },
  },
  {
    id: 'workspace-new-project',
    label: 'Open Project chooser',
    description: 'Choose a known Project or add one from disk',
    keys: { key: 'n', modifiers: ['meta'] },
    category: 'workspace',
    contexts: ['workspace'],
    tenantScope: 'personal-workspace',
    palette: null,
    paletteDiscoverability:
      "The palette's Projects group lists every known Project by name and ends with the chooser itself, so a separate row would duplicate the group's last entry.",
    menu: {
      commandId: 'open-project',
      label: 'Open Project…',
      section: 'file',
    },
  },
  {
    id: 'command-palette',
    label: 'Open Command Palette',
    description: 'Open the command palette to search actions and navigate',
    keys: { key: 'k', modifiers: ['meta'] },
    category: 'actions',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'This verb opens the palette; a row inside it would reopen the surface the reader is already looking at.',
    menu: {
      commandId: 'command-palette',
      label: 'Command Palette…',
      section: 'go',
    },
  },
  {
    id: 'workspace-roadmap',
    label: 'Roadmap',
    description: 'Open the Project roadmap at the Team altitude',
    keys: { key: 'b', modifiers: ['meta'] },
    category: 'workspace',
    contexts: ['workspace'],
    availability: 'open-roadmap',
    palette: { rowId: 'ws-roadmap' },
    menu: {
      commandId: 'open-roadmap',
      label: 'Project Roadmap',
      section: 'go',
    },
  },
  {
    id: 'history-back',
    label: 'Back',
    description: 'Go back to the previous surface',
    keys: { key: '[', modifiers: ['meta'] },
    category: 'navigation',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'Back names a position in the reader’s own history rather than a destination; the palette ranks by name, and "where I just was" has none.',
    menu: { commandId: 'history-back', label: 'Back', section: 'go' },
  },
  {
    id: 'history-forward',
    label: 'Forward',
    description: 'Go forward again after going back',
    keys: { key: ']', modifiers: ['meta'] },
    category: 'navigation',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'Forward is the mirror of Back and names the same nameless position; it belongs beside it in the menu and the cheat sheet, not in a searched list.',
    menu: { commandId: 'history-forward', label: 'Forward', section: 'go' },
  },
  {
    id: 'workspace-new-agent',
    label: 'New Agent in the active project',
    description: 'Summon the Agent composer',
    keys: { key: 't', modifiers: ['meta'] },
    category: 'workspace',
    contexts: ['workspace'],
    tenantScope: 'personal-workspace',
    palette: null,
    paletteDiscoverability:
      "The palette's Start group lists every launch configuration by its own name, which is what a reader searching for a new Agent is looking for; one generic row would rank above all of them and say less.",
    menu: { commandId: 'new-agent', label: 'New Agent', section: 'session' },
  },
  {
    id: 'workspace-new-shell',
    label: 'New shell in the active project',
    description: 'Launch a shell session in the active project',
    keys: { key: 't', modifiers: ['meta', 'alt'] },
    category: 'workspace',
    contexts: ['workspace'],
    availability: 'launch-shell',
    tenantScope: 'personal-workspace',
    palette: null,
    paletteDiscoverability:
      "The shell is a launch configuration and appears in the palette's Start group beside the Agent sources, carrying the same unavailable reason.",
    menu: { commandId: 'launch-shell', label: 'Open Shell', section: 'session' },
  },
  {
    id: 'workspace-reopen-closed-tab',
    label: 'Reopen the last closed tab',
    description: 'Restore the newest recoverable Session without starting it',
    keys: { key: 't', modifiers: ['meta', 'shift'] },
    category: 'workspace',
    contexts: ['workspace'],
    availability: 'reopen-closed-tab',
    tenantScope: 'personal-workspace',
    palette: null,
    paletteDiscoverability:
      "The palette's Recently closed group names each recoverable Session with its Project and goal, so the reader picks the one they meant instead of trusting an ordering they cannot see.",
    menu: {
      commandId: 'reopen-closed-tab',
      label: 'Reopen Closed Tab',
      section: 'session',
    },
  },
  {
    id: 'workspace-rename',
    label: 'Rename the active tab',
    description: 'Open the inline rename editor',
    keys: { key: 'e', modifiers: ['meta'] },
    category: 'workspace',
    contexts: ['workspace'],
    availability: 'rename-tab',
    palette: { rowId: 'ws-rename' },
    menu: {
      commandId: 'rename-tab',
      label: 'Rename Session',
      section: 'session',
    },
  },
  {
    id: 'rename-project',
    label: 'Rename or recolor the active Project',
    description: 'Open the Project name and colour editor',
    keys: null,
    keyboardDiscoverability:
      'Naming and colouring a Project is a rare setup act, not a daily verb; it keeps the palette row and the ribbon menu rather than spending one of the remaining single-modifier chords.',
    availability: 'rename-project',
    palette: { rowId: 'ws-color' },
    menu: null,
    menuDiscoverability:
      'The Session menu addresses the active Session and the File menu addresses Projects on disk; a Project appearance editor belongs to the ribbon it edits, where the target is visible while renaming.',
  },
  {
    id: 'workspace-split',
    label: 'Split: pin / unpin the active tab',
    description: 'Pin the active tab beside the one you drive',
    keys: { key: 'd', modifiers: ['meta'] },
    category: 'workspace',
    contexts: ['workspace'],
    availability: 'toggle-split',
    palette: { rowId: 'ws-split' },
    menu: {
      commandId: 'toggle-split',
      label: 'Split: Pin / Unpin',
      section: 'session',
    },
  },
  {
    id: 'workspace-close-tab',
    label: 'Close the active tab or empty Project',
    description: 'Close the active tab, or its Project when no tabs remain',
    keys: { key: 'w', modifiers: ['meta'] },
    category: 'workspace',
    contexts: ['workspace'],
    availability: 'close-tab',
    palette: { rowId: 'ws-close' },
    menu: {
      commandId: 'close-tab',
      label: 'Close Tab or Empty Project',
      section: 'session',
    },
  },
  // Relaunch recovery (ENG-016 D36, presented by D47, given chords and palette
  // rows by D53). FIX-012 is the third independent report about this verb: it
  // had a restore-panel button and a strip menu entry, then a chord and a
  // palette row, and never a menu item — because nothing required one.
  //
  // Why R on ⌥ rather than the obvious ⌘R/⌘⇧R: both belong to this app's own
  // View menu (Electron's `reload` / `forceReload` roles register those
  // accelerators natively, so the renderer never sees the keydown). ⌥ is the
  // established alternate-modifier home for a verb sharing a mnemonic with a
  // taken chord (⌘T new Agent → ⌘⌥T new shell), and ⇧ is the established
  // scope escalation inside an ⌥ family (⌘⌥[ moves the tab → ⌘⌥⇧[ moves the
  // Project). Both survive the D19 effective-hotkey check: no Apple default
  // and no user-enabled symbolic hotkey binds the R key.
  //
  // Deliberately NOT an extension of ⌘⇧T (D39's browser-style Session
  // recovery). ⌘⇧T restores a CLOSED Session as a stopped tab and spawns
  // nothing; resume starts a process against an exact provider identity on a
  // tab already on screen. One chord for both would make the consequence —
  // including whether a provider starts billing — depend on invisible state.
  {
    id: 'workspace-resume-agent',
    label: 'Resume this Agent',
    description: 'Restart the selected parked Agent on its exact Session',
    keys: { key: 'r', modifiers: ['meta', 'alt'] },
    category: 'workspace',
    contexts: ['workspace'],
    availability: 'resume-agent',
    palette: { rowId: 'ws-resume-agent' },
    menu: {
      commandId: 'resume-agent',
      label: 'Resume This Agent',
      section: 'session',
    },
  },
  {
    id: 'workspace-resume-scope',
    label: 'Resume the parked Agents',
    description:
      "Restart the recovery bar's scope — this Project, or every Project",
    keys: { key: 'r', modifiers: ['meta', 'alt', 'shift'] },
    category: 'workspace',
    contexts: ['workspace'],
    availability: 'resume-scope',
    palette: { rowId: 'ws-resume-scope' },
    menu: {
      commandId: 'resume-scope',
      label: 'Resume Parked Agents',
      section: 'session',
    },
  },
  {
    id: 'workspace-jump-attention',
    label: 'Jump to the Session needing you',
    description: 'Focus the oldest visible needs-you Session',
    keys: { key: 'j', modifiers: ['meta'] },
    category: 'workspace',
    contexts: ['workspace'],
    availability: 'jump-attention',
    palette: { rowId: 'ws-jump' },
    menu: {
      commandId: 'jump-attention',
      label: 'Jump to Session Needing You',
      section: 'session',
    },
  },
  {
    id: 'quick-feedback',
    label: 'Send feedback',
    description: 'Capture feedback from anywhere and keep moving',
    keys: { key: 'f', modifiers: ['meta', 'shift'] },
    category: 'actions',
    contexts: ['global'],
    palette: { rowId: 'action-feedback' },
    menu: {
      commandId: 'submit-feedback',
      label: 'Submit Feedback…',
      section: 'help',
    },
  },
  {
    id: 'help-modal',
    label: 'Show Keyboard Shortcuts',
    description: 'Display all available keyboard shortcuts',
    keys: { key: '?' },
    category: 'help',
    contexts: ['global'],
    palette: { rowId: 'action-help' },
    menu: null,
    menuDiscoverability:
      'The ⌘/ twin below carries the Help menu item; one overlay earns one menu row, and the menu shows the combo that survives a text field.',
  },
  {
    id: 'help-modal-slash',
    label: 'Keyboard Cheat-Sheet',
    description: 'Open the keyboard shortcuts overlay (works everywhere)',
    keys: { key: '/', modifiers: ['meta'] },
    category: 'help',
    contexts: ['global'],
    palette: null,
    paletteDiscoverability:
      'Keyboard Shortcuts already lists this overlay once in the palette; a second row for the same sheet would compete with itself in the ranking.',
    menu: {
      commandId: 'help-modal',
      label: 'Keyboard Shortcuts',
      section: 'help',
    },
  },
];

const BY_ID = new Map(COMMAND_VERBS.map(verb => [verb.id, verb]));

export function getCommandVerb(id: string): CommandVerb {
  const verb = BY_ID.get(id);
  if (!verb) throw new Error(`Unknown command verb: ${id}`);
  return verb;
}

/** Verbs that hold a rebindable registry binding, in declaration order. */
export function keyboardCommandVerbs(): readonly (CommandVerb &
  CommandVerbKeyboard)[] {
  return COMMAND_VERBS.filter(
    (verb): verb is CommandVerb & CommandVerbKeyboard => verb.keys !== null
  );
}

/** Verbs that publish a native menu item, in that section's declaration order. */
export function menuCommandVerbs(
  section?: CommandVerbMenuSection
): readonly (CommandVerb & { menu: CommandVerbMenu })[] {
  return COMMAND_VERBS.filter(
    (verb): verb is CommandVerb & { menu: CommandVerbMenu } =>
      verb.menu !== null && (section === undefined || verb.menu.section === section)
  );
}

export function commandVerbForMenuCommand(
  commandId: string
): (CommandVerb & { menu: CommandVerbMenu }) | undefined {
  return menuCommandVerbs().find(verb => verb.menu.commandId === commandId);
}

/**
 * Menu command ids whose enablement follows renderer-published workspace
 * truth. Anything absent from this set is unconditionally enabled.
 */
export function availabilityMenuCommandIds(): readonly string[] {
  return menuCommandVerbs()
    .filter(verb => verb.availability !== undefined)
    .map(verb => verb.menu.commandId);
}

/** native menu command id → the registry id whose binding it displays (D10) */
export function menuCommandShortcutIds(): Record<string, string> {
  return Object.fromEntries(
    menuCommandVerbs()
      .filter(verb => verb.keys !== null)
      .map(verb => [verb.menu.commandId, verb.id])
  );
}

/**
 * Native Session-menu items for the D44 fixed key families. Fixed families
 * never enter the rebindable registry, so the accelerator sync cannot deliver
 * them and the menu shows these static combos instead.
 */
export const FIXED_SESSION_MENU_COMMANDS = [
  {
    id: 'move-tab-left',
    label: 'Move Session Tab Left',
    accelerator: 'Alt+Command+[',
  },
  {
    id: 'move-tab-right',
    label: 'Move Session Tab Right',
    accelerator: 'Alt+Command+]',
  },
  {
    id: 'move-project-left',
    label: 'Move Project Left',
    accelerator: 'Command+Alt+Shift+[',
  },
  {
    id: 'move-project-right',
    label: 'Move Project Right',
    accelerator: 'Command+Alt+Shift+]',
  },
] as const;

export type FixedSessionMenuCommandId =
  (typeof FIXED_SESSION_MENU_COMMANDS)[number]['id'];

export const FIXED_SESSION_MENU_COMMAND_IDS: ReadonlySet<string> = new Set(
  FIXED_SESSION_MENU_COMMANDS.map(command => command.id)
);

/** Every native menu command the app owns: verbs plus the fixed families. */
export function allMenuAvailabilityCommandIds(): readonly string[] {
  return [
    ...availabilityMenuCommandIds(),
    ...FIXED_SESSION_MENU_COMMANDS.map(command => command.id),
  ];
}

/** Menu command id for a launchable Agent Source, shared by both processes. */
export function agentSourceMenuCommandId(harness: string): string {
  return `launch-${harness}`;
}
