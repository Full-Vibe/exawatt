import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { COMMUNITY_DISTRIBUTION, commandVerbCapabilities } from '@exawatt/core';
import { describe, expect, it } from 'vitest';
import {
  availabilityMenuCommands,
  defaultMenuAccelerators,
} from './application-menu';
import { createMenuController } from './menu-controller';

const EVENT = {} as IpcMainInvokeEvent;

function flatten(
  items: MenuItemConstructorOptions[]
): MenuItemConstructorOptions[] {
  return items.flatMap(item => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ]);
}

function harness() {
  const installed: MenuItemConstructorOptions[][] = [];
  const sent: unknown[][] = [];
  const controller = createMenuController({
    context: () => ({
      appName: 'Exawatt',
      version: '0.1.13',
      buildSha: 'abcdef012345',
      isDev: false,
      capabilities: commandVerbCapabilities(COMMUNITY_DISTRIBUTION),
      onWindowManagementHelp: () => {},
    }),
    install: template => installed.push(template),
    commandTarget: () => ({
      webContents: { send: (...args: unknown[]) => sent.push(args) },
    }),
  });
  const latest = () => flatten(installed[installed.length - 1] ?? []);
  const item = (id: string) => latest().find(entry => entry.id === id);
  const call = (channel: string, ...args: unknown[]) =>
    (controller.channels[channel] as (...a: unknown[]) => unknown)(
      EVENT,
      ...args
    );
  return { controller, installed, sent, item, call };
}

const gated = availabilityMenuCommands()[0];
const [bound, boundAccelerator] = Object.entries(defaultMenuAccelerators())[0];

describe('createMenuController', () => {
  it('starts renderer-published commands disabled and shows the manifest accelerators', () => {
    const { controller, item } = harness();
    controller.rebuild();

    expect(item(gated)?.enabled).toBe(false);
    expect(item(bound)?.accelerator).toBe(boundAccelerator);
  });

  it('routes a menu click to the focused renderer as a named command', () => {
    const { controller, sent, item } = harness();
    controller.rebuild();

    (item(bound)?.click as () => void)();

    expect(sent).toEqual([['menu:command', bound]]);
  });

  it('enables what the renderer publishes, rebuilding only when something changed', async () => {
    const { controller, installed, item, call } = harness();
    controller.rebuild();

    await call('menu:sync-availability', { [gated]: true });
    expect(item(gated)?.enabled).toBe(true);
    const builds = installed.length;

    await call('menu:sync-availability', { [gated]: true });
    await call('menu:sync-availability', { 'not-a-command': true });
    await call('menu:sync-availability', { [gated]: 'yes' });
    await call('menu:sync-availability', null);
    expect(installed.length).toBe(builds);
  });

  it('drops every published command at a document boundary, and only rebuilds if one was enabled', async () => {
    const { controller, installed, item, call } = harness();
    controller.rebuild();
    controller.resetAvailability();
    expect(installed).toHaveLength(1);

    await call('menu:sync-availability', { [gated]: true });
    controller.resetAvailability();
    expect(item(gated)?.enabled).toBe(false);
    expect(installed).toHaveLength(3);
  });

  it('shows rebound accelerators, clears one set to empty, and ignores anything not an accelerator', async () => {
    const { controller, item, call } = harness();
    controller.rebuild();

    await call('menu:sync-accelerators', { [bound]: 'Command+Shift+9' });
    expect(item(bound)?.accelerator).toBe('Command+Shift+9');

    await call('menu:sync-accelerators', { [bound]: 'rm -rf /' });
    expect(item(bound)?.accelerator).toBe('Command+Shift+9');

    await call('menu:sync-accelerators', { [bound]: '' });
    expect(item(bound)?.accelerator).toBeUndefined();

    await call('menu:sync-accelerators', { 'not-a-command': 'Command+K' });
    expect(item('not-a-command')).toBeUndefined();
  });

  it('refuses a feedback sign-in state that is not a boolean, and rebuilds only on change', async () => {
    const { controller, installed, call } = harness();
    controller.rebuild();

    await expect(call('feedback:set-authenticated', 'yes')).rejects.toThrow(
      'Invalid auth state'
    );
    await call('feedback:set-authenticated', false);
    expect(installed).toHaveLength(1);
    await call('feedback:set-authenticated', true);
    expect(installed).toHaveLength(2);
  });
});
