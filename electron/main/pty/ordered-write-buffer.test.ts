import { describe, expect, it } from 'vitest';
import { OrderedWriteBuffer } from './ordered-write-buffer';

describe('OrderedWriteBuffer', () => {
  it('releases Enter and subsequent typing in original order', () => {
    const gate = new OrderedWriteBuffer();
    const written: string[] = [];
    gate.begin('\r');
    expect(gate.hold('n')).toBe(true);
    expect(gate.hold('ext')).toBe(true);
    gate.release(data => written.push(data));
    expect(written).toEqual(['\r', 'n', 'ext']);
    expect(gate.hold('direct')).toBe(false);
  });

  it('can fail closed without writing buffered submission bytes', () => {
    const gate = new OrderedWriteBuffer();
    gate.begin('\r');
    expect(gate.hold('later')).toBe(true);
    gate.discard();
    expect(gate.active).toBe(false);
    expect(gate.hold('direct')).toBe(false);
  });
});
