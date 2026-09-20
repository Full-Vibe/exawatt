import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_COMMAND_VERB_CAPABILITIES,
  COMMAND_VERBS,
  COMMUNITY_DISTRIBUTION,
  FIXED_SESSION_MENU_COMMANDS,
  agentSourceMenuCommandId,
  bindingToAccelerator,
  commandVerbCapabilities,
  commandVerbOffered,
  isChordKeys,
  keyboardCommandVerbs,
  menuCommandShortcutIds,
  menuCommandVerbs,
  offeredCommandVerbs,
  parseDistributionContractJson,
  type CommandVerb,
  type CommandVerbCapability,
  type CommandVerbMenuSection,
} from '@exawatt/core';
import { STATIC_PALETTE_ROW_IDS } from '@/components/shortcuts/command-palette';
import { DIALOG_PRIMARY_ACTION_SHORTCUT_ID } from '@/components/ui/dialog-primary-action';
import {
  DISPATCHED_MENU_COMMAND_IDS,
  LIVE_WORKSPACE_MENU_COMMANDS,
  WORKSPACE_MENU_AVAILABILITY_COMMAND_IDS,
  registrableShortcuts,
} from '@/components/shortcuts/shortcut-provider';
import { FEEDBACK_MENU_COMMAND_IDS } from '@/components/feedback/product-feedback-provider';
import { EMPTY_WORKSPACE_COMMAND_AVAILABILITY } from '@/components/workspace/workspace-command-availability';
import { NAVIGATION_SURFACES } from '@/components/nav/surfaces';
import { defaultShortcuts } from './defaults';
import {
  AGENT_LAUNCH_MENU_COMMANDS,
  GO_MENU_SURFACE_COMMANDS,
  buildApplicationMenuTemplate,
  availabilityMenuCommands,
  defaultMenuAccelerators,
} from '../../../electron/main/application-menu';

/**
 * The discoverability contract for rebindable verbs (ENG-016 D44, FIX-012).
 *
 * D44 proved fixed key families cannot go dark. This holds the same line for
 * the class that shipped Resume with a chord, a palette row, and no menu item:
 * every verb answers for the keyboard, the palette, and the native menu, and
 * every declared surface is joined here to the code that actually publishes
 * it. A verb that loses a surface fails this test rather than a review.
 */

interface MenuRow {
  id?: string;
  label?: string;
  accelerator?: string;
  registerAccelerator?: boolean;
  role?: string;
  type?: string;
  /** which top-level menu this row was actually rendered into */
  section?: CommandVerbMenuSection | null;
}

const APP_NAME = 'Exawatt';

/** Every capability at once: the base contract holds for the whole manifest,
 *  and the capability describe below narrows it per distribution. */
const EVERY_CAPABILITY: ReadonlySet<CommandVerbCapability> = new Set(
  ALL_COMMAND_VERB_CAPABILITIES
);

/** The two distributions this repository builds: the default community
 *  contract and the official example that stands in for operator custody. */
const OFFICIAL_EXAMPLE = parseDistributionContractJson(
  readFileSync(
    path.join(process.cwd(), 'scripts', 'distribution.official.example.json'),
    'utf8'
  )
);

/**
 * The menu a section names. Typed as a TOTAL record, so a new section in the
 * manifest cannot compile until it says which menu publishes it — and the
 * assertion below then holds the template to it. Before this join `section`
 * was declared by every verb and read by nothing, which is D44's own disease
 * one rung down: a declaration with no surface answering for it.
 */
const MENU_LABEL_BY_SECTION: Record<CommandVerbMenuSection, string> = {
  application: APP_NAME,
  file: 'File',
  go: 'Go',
  session: 'Session',
  help: 'Help',
};

const SECTION_BY_MENU_LABEL = new Map<string, CommandVerbMenuSection>(
  Object.entries(MENU_LABEL_BY_SECTION).map(([section, label]) => [
    label,
    section as CommandVerbMenuSection,
  ])
);

function flattenMenu(
  capabilities: ReadonlySet<CommandVerbCapability> = EVERY_CAPABILITY
): MenuRow[] {
  const template = buildApplicationMenuTemplate({
    appName: APP_NAME,
    version: '9.9.9',
    buildSha: 'abcdef123456',
    isDev: false,
    feedbackAuthenticated: true,
    capabilities,
    accelerators: defaultMenuAccelerators(),
    availability: Object.fromEntries(
      availabilityMenuCommands().map(command => [command, true])
    ),
    onCommand: () => {},
    onCheckForUpdates: () => {},
    onWindowManagementHelp: () => {},
  });
  return template.flatMap(menu => {
    if (!Array.isArray(menu.submenu)) return [];
    const section = SECTION_BY_MENU_LABEL.get(String(menu.label ?? '')) ?? null;
    return (menu.submenu as MenuRow[]).map(row => ({ ...row, section }));
  });
}

const MENU_ROWS = flattenMenu();
const menuRow = (id: string) => MENU_ROWS.find(row => row.id === id);

/** A reason has to be a sentence, so `'n/a'` cannot satisfy the type. */
const isWrittenReason = (reason: string) =>
  reason.trim().length >= 40 && reason.trim().endsWith('.');

describe('command verb manifest', () => {
  it('declares unique, named verbs', () => {
    const ids = COMMAND_VERBS.map(verb => verb.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const verb of COMMAND_VERBS) {
      expect(verb.label.trim().length, verb.id).toBeGreaterThan(0);
      expect(verb.description.trim().length, verb.id).toBeGreaterThan(0);
    }
  });

  it('writes down every surface it skips', () => {
    for (const verb of COMMAND_VERBS) {
      if (verb.keys === null) {
        expect(isWrittenReason(verb.keyboardDiscoverability), verb.id).toBe(
          true
        );
      }
      if (verb.palette === null) {
        expect(isWrittenReason(verb.paletteDiscoverability), verb.id).toBe(
          true
        );
      }
      if (verb.menu === null) {
        expect(isWrittenReason(verb.menuDiscoverability), verb.id).toBe(true);
      }
    }
  });

  it('reaches at least one keyboard-reachable surface per verb', () => {
    for (const verb of COMMAND_VERBS) {
      const reachable =
        verb.keys !== null || verb.palette !== null || verb.menu !== null;
      expect(reachable, verb.id).toBe(true);
    }
  });

  it('names only real workspace availability truth', () => {
    const known = Object.keys(EMPTY_WORKSPACE_COMMAND_AVAILABILITY.commands);
    for (const verb of COMMAND_VERBS) {
      if (verb.availability === undefined) continue;
      expect(known, verb.id).toContain(verb.availability);
    }
  });
});

describe('keyboard surface', () => {
  it('is exactly the manifest, in both directions', () => {
    expect(defaultShortcuts.map(shortcut => shortcut.id)).toEqual(
      keyboardCommandVerbs().map(verb => verb.id)
    );
  });

  it('registers, per build, exactly the verbs that build offers', () => {
    for (const contract of [COMMUNITY_DISTRIBUTION, OFFICIAL_EXAMPLE]) {
      const capabilities = commandVerbCapabilities(contract);
      expect(registrableShortcuts(capabilities).map(s => s.id)).toEqual(
        keyboardCommandVerbs(offeredCommandVerbs(capabilities)).map(
          verb => verb.id
        )
      );
    }
  });

  it('carries each verb’s declared binding and label', () => {
    for (const verb of keyboardCommandVerbs()) {
      const shortcut = defaultShortcuts.find(entry => entry.id === verb.id);
      expect(shortcut, verb.id).toBeDefined();
      expect(shortcut!.keys).toEqual(verb.keys);
      expect(shortcut!.label).toBe(verb.label);
      expect(shortcut!.category).toBe(verb.category);
    }
  });

  it('binds no two verbs to the same combo', () => {
    const signatures = keyboardCommandVerbs()
      .filter(verb => !isChordKeys(verb.keys))
      .map(verb => {
        const binding = verb.keys as { key: string; modifiers?: string[] };
        return [
          ...[...(binding.modifiers ?? [])].sort(),
          binding.key.toLowerCase(),
        ].join('+');
      });
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});

/**
 * The dialog surface (BUG-049). `dialog.tsx` is the code that publishes this
 * verb: it presses the open dialog's declared primary action and prints the
 * chord on that action's button. Deleting the manifest entry, or moving it out
 * of `modal-open`, or dropping ⌘ from its binding, each breaks something the
 * operator can feel — and each fails here.
 */
describe('dialog surface', () => {
  const verb = keyboardCommandVerbs().find(
    candidate => candidate.id === DIALOG_PRIMARY_ACTION_SHORTCUT_ID
  );

  it('gives the open dialog’s primary action a rebindable chord', () => {
    expect(verb, DIALOG_PRIMARY_ACTION_SHORTCUT_ID).toBeDefined();
    expect(
      defaultShortcuts.some(
        shortcut => shortcut.id === DIALOG_PRIMARY_ACTION_SHORTCUT_ID
      )
    ).toBe(true);
  });

  it('scopes it to an open modal, so it is inert everywhere else', () => {
    expect(verb!.contexts).toEqual(['modal-open']);
  });

  it('keeps a primary modifier on it, so a dialog’s text field keeps ⏎', () => {
    // `shouldIgnoreShortcutEvent` lets a combo through a focused textarea only
    // when it carries ⌘/⌃. Without the policy, a rebind to a bare key would
    // take Return away inside every dialog that holds a multi-line field.
    expect(verb!.bindingPolicy).toBe('universal-command');
    expect(isChordKeys(verb!.keys)).toBe(false);
    expect((verb!.keys as { modifiers?: string[] }).modifiers).toContain(
      'meta'
    );
  });
});

describe('command-palette surface', () => {
  it('publishes every row the manifest declares', () => {
    for (const verb of COMMAND_VERBS) {
      if (verb.palette === null) continue;
      expect(STATIC_PALETTE_ROW_IDS.has(verb.palette.rowId), verb.id).toBe(
        true
      );
    }
  });

  it('claims each row once', () => {
    const rows = COMMAND_VERBS.flatMap(verb =>
      verb.palette === null ? [] : [verb.palette.rowId]
    );
    expect(new Set(rows).size).toBe(rows.length);
  });
});

describe('native menu surface', () => {
  it('publishes every item the manifest declares, with its label', () => {
    for (const verb of menuCommandVerbs()) {
      const row = menuRow(verb.menu.commandId);
      expect(row, verb.id).toBeDefined();
      expect(row!.label, verb.id).toBe(verb.menu.label);
    }
  });

  it('lands each item in the menu its section names', () => {
    for (const verb of menuCommandVerbs()) {
      expect(menuRow(verb.menu.commandId)!.section, verb.id).toBe(
        verb.menu.section
      );
    }
  });

  it('shows each verb’s own default combo, and registers only ⌘,', () => {
    for (const verb of menuCommandVerbs()) {
      const row = menuRow(verb.menu.commandId)!;
      const expected =
        verb.keys === null || isChordKeys(verb.keys)
          ? undefined
          : (bindingToAccelerator(verb.keys) ?? undefined);
      expect(row.accelerator, verb.id).toBe(expected);
      expect(row.registerAccelerator ?? false, verb.id).toBe(
        verb.menu.registerAccelerator === true
      );
    }
    const registered = MENU_ROWS.filter(row => row.registerAccelerator);
    expect(registered.map(row => row.id)).toEqual(['open-settings']);
  });

  it('never publishes a command no manifest owns', () => {
    const owned = new Set<string>([
      ...menuCommandVerbs().map(verb => verb.menu.commandId),
      ...FIXED_SESSION_MENU_COMMANDS.map(command => command.id),
      ...GO_MENU_SURFACE_COMMANDS.map(entry => entry.commandId),
      ...AGENT_LAUNCH_MENU_COMMANDS.map(entry => entry.commandId),
    ]);
    for (const row of MENU_ROWS) {
      if (row.id === undefined) continue;
      expect(owned.has(row.id), row.id).toBe(true);
    }
  });

  it('routes every availability-bearing verb through the enablement sync', () => {
    for (const verb of menuCommandVerbs()) {
      if (verb.availability === undefined) continue;
      expect(
        WORKSPACE_MENU_AVAILABILITY_COMMAND_IDS.has(verb.menu.commandId),
        verb.id
      ).toBe(true);
    }
    // Both processes agree on which commands the sync covers.
    expect([...availabilityMenuCommands()].sort()).toEqual(
      [...WORKSPACE_MENU_AVAILABILITY_COMMAND_IDS].sort()
    );
  });

  it('gates the launch verbs on the personal tenant', () => {
    for (const verb of menuCommandVerbs()) {
      expect(
        LIVE_WORKSPACE_MENU_COMMANDS.has(verb.menu.commandId),
        verb.id
      ).toBe(verb.tenantScope === 'personal-workspace');
    }
  });

  it('displays the accelerator column through the registry join', () => {
    const join = menuCommandShortcutIds();
    for (const verb of menuCommandVerbs()) {
      if (verb.keys === null) continue;
      expect(join[verb.menu.commandId], verb.id).toBe(verb.id);
    }
  });

  it('starts every synced command disabled and never disables the rest', () => {
    const alwaysEnabled = menuCommandVerbs().filter(
      verb => verb.availability === undefined
    );
    for (const verb of alwaysEnabled) {
      expect(
        availabilityMenuCommands().includes(verb.menu.commandId),
        verb.id
      ).toBe(false);
    }
  });
});

describe('navigation destinations keep their menu rows', () => {
  it('gives every navigable app surface a Go row', () => {
    const rows = new Set<string>(
      GO_MENU_SURFACE_COMMANDS.map(entry => entry.commandId)
    );
    for (const surface of NAVIGATION_SURFACES) {
      if (surface.routeClass !== 'app') continue;
      if (surface.tier === 'spine') continue;
      // Settings has its macOS home in the application menu, declared as a
      // verb; every other app surface is addressed as `go-<surface id>`.
      if (surface.id === 'settings') continue;
      expect(rows.has(`go-${surface.id}`), surface.id).toBe(true);
    }
  });

  it('labels each Go row with the surface’s canonical name', () => {
    for (const entry of GO_MENU_SURFACE_COMMANDS) {
      const surface = NAVIGATION_SURFACES.find(
        candidate => `go-${candidate.id}` === entry.commandId
      );
      expect(surface, entry.commandId).toBeDefined();
      expect(entry.label).toBe(surface!.name);
    }
  });

  it('gives the spine altitudes their manifest verbs', () => {
    for (const [surfaceId, verbId] of [
      ['terminal', 'command-terminal'],
      ['sessions', 'command-sessions'],
      ['spatial', 'command-spatial'],
    ] as const) {
      const surface = NAVIGATION_SURFACES.find(
        candidate => candidate.id === surfaceId
      );
      const verb = COMMAND_VERBS.find(
        (candidate: CommandVerb) => candidate.id === verbId
      );
      expect(verb?.menu?.label, verbId).toBe(surface!.name);
    }
  });
});

describe('launchable Agent Sources', () => {
  it('gives every interactively launchable source a Session-menu row', () => {
    expect(AGENT_LAUNCH_MENU_COMMANDS.length).toBeGreaterThan(0);
    for (const entry of AGENT_LAUNCH_MENU_COMMANDS) {
      expect(menuRow(entry.commandId), entry.commandId).toBeDefined();
      expect(LIVE_WORKSPACE_MENU_COMMANDS.has(entry.commandId)).toBe(true);
    }
  });

  it('shares one command-id shape across both processes', () => {
    for (const entry of AGENT_LAUNCH_MENU_COMMANDS) {
      expect(entry.commandId.startsWith('launch-')).toBe(true);
    }
    expect(agentSourceMenuCommandId('claude')).toBe('launch-claude');
  });
});

describe('application identity', () => {
  it('leads with the product version and keeps the build sha behind it', () => {
    const labels = MENU_ROWS.map(row => row.label);
    const version = labels.indexOf('Version 9.9.9');
    const build = labels.indexOf('Build abcdef123456');
    expect(version).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(version);
  });
});

/**
 * Capability-gated verbs (2026-09-13). A verb that reaches a distribution
 * service is not OFFERED where the contract configures none: no registry
 * binding, no palette row, no menu item. Both distributions this repository
 * builds are held to it, so neither direction goes unchecked: the community
 * contract must drop every gated verb and the official example must carry
 * every one.
 */
describe('capability-gated verbs', () => {
  const gated = COMMAND_VERBS.filter(verb => verb.capability !== undefined);

  it('exist, and each names a capability the contract can configure', () => {
    expect(gated.length).toBeGreaterThan(0);
    for (const verb of gated) {
      expect(ALL_COMMAND_VERB_CAPABILITIES, verb.id).toContain(verb.capability);
    }
  });

  it('are absent from a community build on every surface', () => {
    const capabilities = commandVerbCapabilities(COMMUNITY_DISTRIBUTION);
    expect([...capabilities]).toEqual([]);
    const rows = flattenMenu(capabilities);
    const registered = new Set(
      registrableShortcuts(capabilities).map(s => s.id)
    );
    for (const verb of gated) {
      expect(commandVerbOffered(verb, capabilities), verb.id).toBe(false);
      if (verb.menu !== null) {
        expect(
          rows.find(row => row.id === verb.menu!.commandId),
          verb.id
        ).toBeUndefined();
      }
      expect(registered.has(verb.id), verb.id).toBe(false);
    }
  });

  it('are present in the official build on every surface they declare', () => {
    const capabilities = commandVerbCapabilities(OFFICIAL_EXAMPLE);
    expect([...capabilities].sort()).toEqual(
      [...ALL_COMMAND_VERB_CAPABILITIES].sort()
    );
    const rows = flattenMenu(capabilities);
    const registered = new Set(
      registrableShortcuts(capabilities).map(s => s.id)
    );
    for (const verb of gated) {
      expect(commandVerbOffered(verb, capabilities), verb.id).toBe(true);
      if (verb.menu !== null) {
        expect(
          rows.find(row => row.id === verb.menu!.commandId)?.label,
          verb.id
        ).toBe(verb.menu.label);
      }
      expect(registered.has(verb.id), verb.id).toBe(verb.keys !== null);
    }
  });

  it('never drops an ungated verb from either build', () => {
    for (const contract of [COMMUNITY_DISTRIBUTION, OFFICIAL_EXAMPLE]) {
      const offered = new Set(
        offeredCommandVerbs(commandVerbCapabilities(contract)).map(
          verb => verb.id
        )
      );
      for (const verb of COMMAND_VERBS) {
        if (verb.capability === undefined) {
          expect(offered.has(verb.id), verb.id).toBe(true);
        }
      }
    }
  });
});

/**
 * The feedback dialog's menu item (Help ▸ Submit Feedback…) is owned by ONE
 * verb and answered by the feedback provider. One verb used to carry the
 * ⌘⇧F capture bar AND this menu item, so the menu printed the bar's chord
 * beside the dialog's name. The dispatcher reads its command id from the
 * manifest now; this joins the two so the verb cannot lose its listener.
 */
describe('feedback surfaces', () => {
  it('gives the dialog and the capture bar their own verbs', () => {
    const bar = COMMAND_VERBS.find(verb => verb.id === 'quick-feedback')!;
    const dialog = COMMAND_VERBS.find(verb => verb.id === 'submit-feedback')!;
    expect(bar.keys).not.toBeNull();
    expect(bar.menu).toBeNull();
    expect(dialog.keys).toBeNull();
    expect(dialog.menu).not.toBeNull();
    expect(bar.capability).toBe(dialog.capability);
  });

  it('routes every product-feedback menu verb to the feedback dispatcher', () => {
    const feedbackMenuCommands = menuCommandVerbs()
      .filter(verb => verb.capability === 'product-feedback')
      .map(verb => verb.menu.commandId);
    expect(feedbackMenuCommands.length).toBeGreaterThan(0);
    expect([...FEEDBACK_MENU_COMMAND_IDS].sort()).toEqual(
      feedbackMenuCommands.sort()
    );
  });

  it('prints no chord on the dialog’s menu row', () => {
    const dialog = menuCommandVerbs().find(
      verb => verb.id === 'submit-feedback'
    )!;
    expect(menuRow(dialog.menu.commandId)?.accelerator).toBeUndefined();
  });
});

/**
 * The rung the manifest did not previously reach.
 *
 * A menu verb passes every other join here by declaring a section, an
 * accelerator, and a tenant gate, and can still do nothing when invoked:
 * dispatch is a switch, and a missing case is silent. Dispatch has more than
 * one owner, so each publishes what it handles and this joins the union to the
 * manifest in both directions.
 */
describe('every menu verb reaches a dispatch', () => {
  const dispatched = new Set([
    ...DISPATCHED_MENU_COMMAND_IDS,
    ...FEEDBACK_MENU_COMMAND_IDS,
  ]);

  it('is dispatched by some owner', () => {
    const undispatched = menuCommandVerbs()
      .map(verb => verb.menu.commandId)
      .filter(commandId => !dispatched.has(commandId));

    expect(undispatched).toEqual([]);
  });

  it('dispatches nothing that no menu declares', () => {
    // The fixed Session families are menu items without rebindable verbs, so
    // they are declared there rather than in the verb manifest.
    const declared = new Set([
      ...menuCommandVerbs().map(verb => verb.menu.commandId),
      ...FIXED_SESSION_MENU_COMMANDS.map(command => command.id),
      ...AGENT_LAUNCH_MENU_COMMANDS.map(entry => entry.commandId),
    ]);
    const orphaned = [...dispatched].filter(
      commandId => !declared.has(commandId)
    );

    expect(orphaned).toEqual([]);
  });
});
