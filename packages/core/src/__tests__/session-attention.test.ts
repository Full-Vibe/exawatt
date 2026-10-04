import { describe, expect, it } from 'vitest';
import {
  attentionRecords,
  projectSessionAttention,
  readPtyAttention,
  withAttentionRead,
} from '../session-attention';
import type { PtyAttentionRecord } from '../desktop-bridge/pty';

const question: PtyAttentionRecord = {
  source: 'harness',
  kind: 'blocked',
  request: 'working',
  requestId: 'q1',
  since: 1,
  unread: false,
};
const result: PtyAttentionRecord = {
  source: 'harness',
  kind: 'turn-end',
  since: 2,
  unread: true,
};

describe('canonical Session attention records', () => {
  it('projects priority separately from aggregate unread and retains both facts', () => {
    const projected = projectSessionAttention([result, question])!;
    expect(projected).toMatchObject({
      kind: 'blocked',
      since: 1,
      unread: true,
    });
    expect(projected.records).toEqual([question, result]);
    expect(
      attentionRecords(withAttentionRead(projected, false)).every(
        record => record.unread === false
      )
    ).toBe(true);
  });

  it('trusts canonical records over inconsistent legacy projection fields', () => {
    expect(
      readPtyAttention({
        kind: 'turn-end',
        since: 900,
        unread: false,
        records: [question, result],
      })
    ).toEqual(projectSessionAttention([question, result]));
  });

  it('preserves independent source requests and rejects corrupt records independently', () => {
    const roadmap: PtyAttentionRecord = {
      source: 'roadmap',
      kind: 'roadmap-blocked',
      request: 'blocking',
      requestId: 'ENG-015',
      since: 3,
      unread: true,
    };
    const value = readPtyAttention({
      records: [question, roadmap, { ...result, since: Number.NaN }],
    })!;
    expect(value.kind).toBe('roadmap-blocked');
    expect(value.records).toEqual([roadmap, question]);
  });

  it('migrates legacy signals and bounds malformed checkpoints', () => {
    expect(readPtyAttention({ kind: 'blocked', since: 1 })).toEqual({
      kind: 'blocked',
      since: 1,
    });
    expect(readPtyAttention({ kind: 'blocked', since: -1 })).toBeNull();
    expect(
      readPtyAttention({ kind: 'blocked', since: 1, unread: 'yes' })
    ).toBeNull();
    expect(
      readPtyAttention({
        records: Array.from({ length: 513 }, () => question),
      })
    ).toBeNull();
    expect(
      readPtyAttention({ kind: 'blocked', since: 1, records: [] })
    ).toBeNull();
  });
});
