import { describe, it, expect, vi } from 'vitest';
import { TypedEmitter } from '../events/emitter';

interface TestMap extends Record<string, unknown> {
  msg: string;
  count: number;
}

describe('TypedEmitter', () => {
  it('on + emit calls handler', () => {
    const emitter = new TypedEmitter<TestMap>();
    const handler = vi.fn();
    emitter.on('msg', handler);
    emitter.emit('msg', 'hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('off removes handler', () => {
    const emitter = new TypedEmitter<TestMap>();
    const handler = vi.fn();
    emitter.on('msg', handler);
    emitter.off('msg', handler);
    emitter.emit('msg', 'hello');
    expect(handler).not.toHaveBeenCalled();
  });

  it('once fires exactly once', () => {
    const emitter = new TypedEmitter<TestMap>();
    const handler = vi.fn();
    emitter.once('msg', handler);
    emitter.emit('msg', 'a');
    emitter.emit('msg', 'b');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('a');
  });

  it('removeAllListeners clears specific event', () => {
    const emitter = new TypedEmitter<TestMap>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('msg', h1);
    emitter.on('count', h2);
    emitter.removeAllListeners('msg');
    emitter.emit('msg', 'x');
    emitter.emit('count', 5);
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith(5);
  });

  it('removeAllListeners() with no arg clears all', () => {
    const emitter = new TypedEmitter<TestMap>();
    const handler = vi.fn();
    emitter.on('msg', handler);
    emitter.removeAllListeners();
    emitter.emit('msg', 'x');
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple handlers for same event all fire', () => {
    const emitter = new TypedEmitter<TestMap>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('msg', h1);
    emitter.on('msg', h2);
    emitter.emit('msg', 'test');
    expect(h1).toHaveBeenCalledWith('test');
    expect(h2).toHaveBeenCalledWith('test');
  });
});
