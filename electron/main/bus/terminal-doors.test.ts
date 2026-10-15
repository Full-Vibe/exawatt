import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { createTerminalDoors } from './terminal-doors';

function sessions() {
  const emitter = new EventEmitter();
  const writes: [string, string][] = [];
  return {
    emitter,
    writes,
    on: emitter.on.bind(emitter) as never,
    removeListener: emitter.removeListener.bind(emitter) as never,
    write: (id: string, data: string) => writes.push([id, data]),
  };
}

describe('createTerminalDoors', () => {
  it('follows the TUI’s bracketed-paste switch, even split across chunks', () => {
    const world = sessions();
    const doors = createTerminalDoors(world);
    const door = doors.doorFor('pty-1');
    const came: string[] = [];
    doors.onUp(id => came.push(id));
    expect(door.bracketedPaste()).toBe(false);
    expect(doors.isUp('pty-1')).toBe(false);
    world.emitter.emit('data', 'pty-1', 'hello\x1b[?20');
    world.emitter.emit('data', 'pty-1', '04h prompt');
    expect(door.bracketedPaste()).toBe(true);
    world.emitter.emit('data', 'pty-2', '\x1b[?2004l');
    expect(door.bracketedPaste()).toBe(true);
    world.emitter.emit('data', 'pty-1', '\x1b[?2004l');
    expect(door.bracketedPaste()).toBe(false);
    // Up is once: the program drew its input, whatever it toggles later.
    expect(doors.isUp('pty-1')).toBe(true);
    world.emitter.emit('data', 'pty-1', '\x1b[?2004h');
    expect(came).toEqual(['pty-1']);
    doors.dispose();
  });

  it('settles after the TUI answers the write and goes quiet, then Enter is its own engaged write', async () => {
    const world = sessions();
    const engaged: string[] = [];
    const doors = createTerminalDoors(world, {
      quietMs: 1,
      maxMs: 60_000,
      engage: id => engaged.push(id),
    });
    const door = doors.doorFor('pty-1');
    door.write('text');
    const settled = door.settled();
    let done = false;
    void settled.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    world.emitter.emit('data', 'pty-1', 'text echoed');
    await settled;
    door.submit();
    expect(world.writes).toEqual([
      ['pty-1', 'text'],
      ['pty-1', '\r'],
    ]);
    expect(engaged).toEqual(['pty-1']);
    doors.dispose();
  });

  it('never waits past its bound for a TUI that does not echo', async () => {
    const world = sessions();
    const doors = createTerminalDoors(world, { quietMs: 60_000, maxMs: 1 });
    const door = doors.doorFor('pty-1');
    door.write('text');
    await door.settled();
    doors.dispose();
  });
});
