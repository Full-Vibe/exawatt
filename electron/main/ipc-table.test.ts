import { describe, expect, it } from 'vitest';
import {
  registerIpcModules,
  registerTrustedChannels,
  type TrustedChannels,
} from './ipc-table';

describe('registerTrustedChannels', () => {
  it('registers every channel of every table through the one door', () => {
    const registered: string[] = [];
    const first: TrustedChannels = { 'a:one': () => 1, 'a:two': () => 2 };
    const second: TrustedChannels = { 'b:one': () => 3 };

    registerTrustedChannels([first, second], channel =>
      registered.push(channel)
    );

    expect(registered).toEqual(['a:one', 'a:two', 'b:one']);
  });

  it('refuses a channel two tables both claim, before registering anything', () => {
    const registered: string[] = [];
    expect(() =>
      registerTrustedChannels(
        [{ 'a:one': () => 1 }, { 'a:one': () => 2 }],
        channel => registered.push(channel)
      )
    ).toThrow('IPC channel a:one is registered twice');
    expect(registered).toEqual([]);
  });

  it('hands each handler over unchanged', () => {
    const handler = () => 'answer';
    let received: unknown = null;
    registerTrustedChannels([{ 'a:one': handler }], (_channel, given) => {
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
