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
});
