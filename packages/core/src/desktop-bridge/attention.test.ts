import { describe, expect, it } from 'vitest';
import { readPtyAttention } from './attention';

describe('durable attention reader', () => {
  it('preserves an exact request receipt without persisting arbitrary fields', () => {
    const request = {
      kind: 'blocked',
      since: 7,
      unread: false,
      request: 'working',
      requestId: 'question-42',
    };
    expect(readPtyAttention({ ...request, transientWorking: true })).toEqual(
      request
    );
  });

  it('keeps legacy attention unread and isolates a corrupt record', () => {
    expect(readPtyAttention({ kind: 'turn-end', since: 7 })).toEqual({
      kind: 'turn-end',
      since: 7,
    });
    for (const invalid of [
      null,
      {},
      { kind: 'working', since: 7 },
      { kind: 'bell', since: NaN },
      { kind: 'blocked', since: -1 },
    ]) {
      expect(readPtyAttention(invalid)).toBeNull();
    }
    expect(
      readPtyAttention({
        kind: 'bell',
        since: 7,
        requestId: 'a'.repeat(513),
        unread: 'yes',
      })
    ).toEqual({ kind: 'bell', since: 7 });
  });
});
