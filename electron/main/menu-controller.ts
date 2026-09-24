import type { MenuItemConstructorOptions } from 'electron';
import {
  availabilityMenuCommands,
  buildApplicationMenuTemplate,
  defaultMenuAccelerators,
  type ApplicationMenuContext,
} from './application-menu';
import type { TrustedChannels } from './ipc-table';

/**
 * The native application menu's live state: which accelerators it shows,
 * which commands are enabled, and whether feedback is signed in. The template
 * itself is `application-menu.ts`; this module owns what changes at runtime
 * and the channels the renderer changes it through.
 */

type FixedMenuContext = Omit<
  ApplicationMenuContext,
  'feedbackAuthenticated' | 'accelerators' | 'availability' | 'onCommand'
>;

interface MenuCommandTarget {
  webContents: { send(channel: string, ...args: unknown[]): void };
}

interface MenuControllerDependencies {
  /** Read at every rebuild. */
  context: () => FixedMenuContext;
  /** Installs a template as the application menu. */
  install: (template: MenuItemConstructorOptions[]) => void;
  /** The window a menu command goes to. */
  commandTarget: () => MenuCommandTarget | undefined;
}

interface MenuController {
  rebuild(): void;
  /** Disables every renderer-published command until it republishes. */
  resetAvailability(): void;
  channels: TrustedChannels;
}

const ACCELERATOR_PATTERN =
  /^((Command|Control|Alt|Shift)\+)*([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|[\[\]\\;',./`=-]|Enter|Escape|Tab|Space|Backspace|Delete|Up|Down|Left|Right|Home|End|PageUp|PageDown)$/;

export function createMenuController(
  deps: MenuControllerDependencies
): MenuController {
  /** Display accelerators per menu command (D10): seeded from the command-verb
   *  manifest's own bindings, overwritten when the renderer syncs the registry's
   *  effective bindings — a rebind updates what the menus show instead of
   *  letting them lie. An empty string clears the column (e.g. a verb rebound
   *  to a chord). */
  const menuAccelerators: Record<string, string> = defaultMenuAccelerators();

  /** Renderer-owned context projected into native menu enablement. Commands
   *  start unavailable until the restored workspace publishes real targets;
   *  which commands those are is a manifest fact, not a list kept by hand. */
  const menuAvailability: Record<string, boolean> = Object.fromEntries(
    availabilityMenuCommands().map(command => [command, false])
  );

  let feedbackAuthenticated = false;

  /** Send a named command to the focused renderer. Menu items are the
   *  discoverable, always-current cheat sheet for the app's shortcuts; the
   *  renderer stays the single keyboard authority (rebindable, terminal-focus
   *  aware), so items show their combo with `registerAccelerator: false` and
   *  only ⌘, — a chrome-level macOS invariant — registers for real. */
  function sendMenuCommand(command: string): void {
    deps.commandTarget()?.webContents.send('menu:command', command);
  }

  function createMenu(): void {
    deps.install(
      buildApplicationMenuTemplate({
        ...deps.context(),
        feedbackAuthenticated,
        accelerators: menuAccelerators,
        availability: menuAvailability,
        onCommand: sendMenuCommand,
      })
    );
  }

  function resetMenuAvailability(): void {
    let changed = false;
    for (const command of Object.keys(menuAvailability)) {
      if (menuAvailability[command]) {
        menuAvailability[command] = false;
        changed = true;
      }
    }
    if (changed) createMenu();
  }

  const channels: TrustedChannels = {
    'menu:sync-accelerators': async (_event, map: unknown) => {
      if (!map || typeof map !== 'object') return;
      for (const [command, value] of Object.entries(map)) {
        if (!Object.prototype.hasOwnProperty.call(menuAccelerators, command))
          continue;
        if (value === '') {
          menuAccelerators[command] = '';
        } else if (
          typeof value === 'string' &&
          ACCELERATOR_PATTERN.test(value)
        ) {
          menuAccelerators[command] = value;
        }
      }
      createMenu();
    },
    'menu:sync-availability': async (_event, map: unknown) => {
      if (!map || typeof map !== 'object') return;
      let changed = false;
      for (const [command, value] of Object.entries(map)) {
        if (!Object.prototype.hasOwnProperty.call(menuAvailability, command)) {
          continue;
        }
        if (typeof value !== 'boolean') continue;
        if (menuAvailability[command] !== value) {
          menuAvailability[command] = value;
          changed = true;
        }
      }
      if (changed) createMenu();
    },
    'feedback:set-authenticated': async (_event, value: boolean) => {
      if (typeof value !== 'boolean') throw new Error('Invalid auth state');
      if (feedbackAuthenticated === value) return;
      feedbackAuthenticated = value;
      createMenu();
    },
  };

  return {
    rebuild: createMenu,
    resetAvailability: resetMenuAvailability,
    channels,
  };
}
