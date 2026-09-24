import { describe, expect, it } from 'vitest';
import {
  registerIpcModules,
  registerTrustedChannels,
  type TrustedChannels,
} from './ipc-table';

describe('registerTrustedChannels', () => {
  it('registers every channel of every table through the one door', () => {
    const registered: string[] = [];
    const first: TrustedChannels = {
      'pty:buffer': () => 'text',
      'pty:kill': () => undefined,
    };
    const second: TrustedChannels = { 'menu:sync-accelerators': () => {} };

    registerTrustedChannels([first, second], channel =>
      registered.push(channel)
    );

    expect(registered).toEqual([
      'pty:buffer',
      'pty:kill',
      'menu:sync-accelerators',
    ]);
  });

  it('refuses a channel two tables both claim, before registering anything', () => {
    const registered: string[] = [];
    expect(() =>
      registerTrustedChannels(
        [{ 'pty:buffer': () => 'a' }, { 'pty:buffer': () => 'b' }],
        channel => registered.push(channel)
      )
    ).toThrow('IPC channel pty:buffer is registered twice');
    expect(registered).toEqual([]);
  });

  it('hands each handler over unchanged', () => {
    const handler = () => 'answer';
    let received: unknown = null;
    registerTrustedChannels([{ 'pty:buffer': handler }], (_channel, given) => {
      received = given;
    });
    expect(received).toBe(handler);
  });
});

describe('registerIpcModules', () => {
  it('runs each registration once, in table order', () => {
    const ran: string[] = [];
    registerIpcModules([
      { id: 'pty', register: () => ran.push('pty') },
      { id: 'main', register: () => ran.push('main') },
      { id: 'analytics', register: () => ran.push('analytics') },
    ]);
    expect(ran).toEqual(['pty', 'main', 'analytics']);
  });

  it('refuses a module listed twice, before running any', () => {
    const ran: string[] = [];
    expect(() =>
      registerIpcModules([
        { id: 'pty', register: () => ran.push('pty') },
        { id: 'pty', register: () => ran.push('pty again') },
      ])
    ).toThrow('IPC module pty is registered twice');
    expect(ran).toEqual([]);
  });
});
