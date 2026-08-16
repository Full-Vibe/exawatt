import type { MenuItemConstructorOptions } from 'electron';
import {
  CONSUMPTION_SURFACE_NAME,
  FIXED_SESSION_MENU_COMMANDS,
  agentSourceMenuCommandId,
  bindingToAccelerator,
  getCommandVerb,
  isChordKeys,
  menuCommandVerbs,
  type CommandVerbMenu,
} from '@exawatt/core';
import { AGENT_SOURCE_DECLARATIONS } from './pty/generated-agent-source-declarations';

/**
 * The native application menu (ENG-016 D8/D10/D44, FIX-012).
 *
 * Every item here is DERIVED: verb labels, command ids and default
 * accelerators come from the shared command-verb manifest, the launch rows
 * come from the Agent Source contract, and the Go menu's destination rows are
 * joined to the renderer's navigation manifest by a contract test. The
 * template used to be a hand-written list inside `main.ts` — the fourth
 * independent copy of the app's verb list, and the one Resume never reached.
 *
 * The renderer stays the single keyboard authority (rebindable, terminal-focus
 * aware), so items display their combo with `registerAccelerator: false`.
 * Only ⌘, — a macOS chrome invariant that must work before the renderer
 * exists — registers for real, and the manifest is what says so.
 */

/** Agent Sources the Session menu can start directly. */
export const AGENT_LAUNCH_MENU_COMMANDS = AGENT_SOURCE_DECLARATIONS.filter(
  declaration =>
    declaration.harness !== null && declaration.capabilities.interactiveLaunch
).map(declaration => ({
  commandId: agentSourceMenuCommandId(declaration.adapterId),
  label: `Start Agent with ${declaration.label}…`,
}));

/**
 * Go-menu destinations outside the command-altitude spine. Ids are
 * `go-<surface id>` and resolve through the renderer's navigation manifest
 * (`src/components/nav/surfaces.ts`), which owns names, routes and readiness.
 * The main process cannot import that manifest (`rootDir: electron/`), so
 * `command-verbs.contract.test.ts` joins the two lists instead.
 */
export const GO_MENU_SURFACE_COMMANDS = [
  // The command id keeps its historical spelling; the label comes from the
  // shared surface-name constant, which both processes now read.
  { commandId: 'go-consumption', label: CONSUMPTION_SURFACE_NAME },
  { commandId: 'go-organization', label: 'Organization' },
  { commandId: 'go-cloud', label: 'Cloud' },
  { commandId: 'go-coordination', label: 'Coordination' },
  { commandId: 'go-agent-types', label: 'Agent Types' },
] as const;

/**
 * Default accelerator column, seeded from the manifest's own bindings. Fixed
 * key families (D13/D20) never enter the rebindable registry, so the
 * accelerator sync cannot deliver them and their static combos ride along
 * here; the renderer's capture-phase key layer still owns those chords.
 */
export function defaultMenuAccelerators(): Record<string, string> {
  const entries: [string, string][] = FIXED_SESSION_MENU_COMMANDS.map(
    command => [command.id, command.accelerator]
  );
  for (const verb of menuCommandVerbs()) {
    if (verb.keys === null || isChordKeys(verb.keys)) continue;
    const accelerator = bindingToAccelerator(verb.keys);
    if (accelerator) entries.push([verb.menu.commandId, accelerator]);
  }
  return Object.fromEntries(entries);
}

/**
 * Menu commands whose enablement follows renderer-published workspace truth.
 * They start unavailable until a restored workspace publishes real targets.
 */
export function availabilityMenuCommands(): string[] {
  return [
    ...menuCommandVerbs()
      .filter(verb => verb.availability !== undefined)
      .map(verb => verb.menu.commandId),
    ...FIXED_SESSION_MENU_COMMANDS.map(command => command.id),
  ];
}

export interface ApplicationMenuContext {
  appName: string;
  /** packaged product version — the primary identity of this build */
  version: string;
  /** short build sha, secondary diagnostic identity */
  buildSha: string;
  isDev: boolean;
  feedbackAuthenticated: boolean;
  accelerators: Record<string, string>;
  availability: Record<string, boolean>;
  onCommand: (command: string) => void;
  onCheckForUpdates: () => void;
  onWindowManagementHelp: () => void;
}

function commandItem(
  context: ApplicationMenuContext,
  commandId: string,
  label: string,
  menu?: CommandVerbMenu
): MenuItemConstructorOptions {
  const accelerator = context.accelerators[commandId];
  return {
    id: commandId,
    label,
    enabled: context.availability[commandId] ?? true,
    ...(accelerator
      ? {
          accelerator,
          registerAccelerator: menu?.registerAccelerator === true,
        }
      : {}),
    click: () => context.onCommand(commandId),
  };
}

/** A menu row for a declared verb. Throws when the manifest says it has none,
 *  so the template can never publish a row the contract does not know about. */
function verbItem(
  context: ApplicationMenuContext,
  verbId: string
): MenuItemConstructorOptions {
  const verb = getCommandVerb(verbId);
  if (verb.menu === null) {
    throw new Error(
      `Command verb ${verbId} declares no native menu item: ${verb.menuDiscoverability}`
    );
  }
  return commandItem(context, verb.menu.commandId, verb.menu.label, verb.menu);
}

/** A fresh object per row: Electron owns the template it is handed, so no two
 *  menu rows may share one literal. */
const separator = (): MenuItemConstructorOptions => ({ type: 'separator' });

export function buildApplicationMenuTemplate(
  context: ApplicationMenuContext
): MenuItemConstructorOptions[] {
  const verb = (id: string) => verbItem(context, id);
  const command = (commandId: string, label: string) =>
    commandItem(context, commandId, label);

  return [
    {
      label: context.appName,
      submenu: [
        { role: 'about' },
        // Product identity first: the version is what a person can say out
        // loud, compare against a release, and check an update against. The
        // build sha stays as secondary diagnostic detail (FIX-014).
        { label: `Version ${context.version}`, enabled: false },
        { label: `Build ${context.buildSha}`, enabled: false },
        { label: 'Check for Updates…', click: context.onCheckForUpdates },
        separator(),
        verb('open-settings'),
        separator(),
        { role: 'services' },
        separator(),
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        separator(),
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [verb('workspace-new-project')],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        separator(),
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        separator(),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        separator(),
        { role: 'togglefullscreen' },
        ...(context.isDev
          ? [separator(), { role: 'toggleDevTools' as const }]
          : []),
      ],
    },
    {
      label: 'Go',
      submenu: [
        verb('command-palette'),
        separator(),
        verb('command-terminal'),
        verb('command-sessions'),
        verb('command-spatial'),
        separator(),
        // Vision surfaces (ENG-026 N1) are navigable preview pages, honestly
        // marked on-surface — never dead menu items.
        ...GO_MENU_SURFACE_COMMANDS.map(entry =>
          command(entry.commandId, entry.label)
        ),
        separator(),
        verb('workspace-roadmap'),
        separator(),
        verb('history-back'),
        verb('history-forward'),
      ],
    },
    {
      label: 'Session',
      submenu: [
        ...AGENT_LAUNCH_MENU_COMMANDS.map(entry =>
          command(entry.commandId, entry.label)
        ),
        separator(),
        verb('workspace-new-agent'),
        verb('workspace-new-shell'),
        separator(),
        verb('workspace-reopen-closed-tab'),
        verb('workspace-rename'),
        verb('workspace-split'),
        ...FIXED_SESSION_MENU_COMMANDS.map(entry =>
          command(entry.id, entry.label)
        ),
        verb('workspace-close-tab'),
        separator(),
        verb('workspace-resume-agent'),
        verb('workspace-resume-scope'),
        separator(),
        verb('workspace-jump-attention'),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        separator(),
        { role: 'front' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          ...verb('quick-feedback'),
          label: context.feedbackAuthenticated
            ? 'Submit Feedback…'
            : 'Submit Feedback… (Sign in required)',
          enabled: context.feedbackAuthenticated,
        },
        verb('help-modal-slash'),
        separator(),
        {
          label: "Window Management Isn't Working…",
          click: context.onWindowManagementHelp,
        },
      ],
    },
  ];
}
