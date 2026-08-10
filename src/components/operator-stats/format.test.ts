import { describe, expect, it } from 'vitest';
import { formatSyncedAt } from './format';

describe('formatSyncedAt', () => {
  // Local-time constructions so the same-day comparison holds in any zone.
  const now = new Date(2026, 7, 10, 15, 0).getTime();

  it('shows only the time while the sync is from today', () => {
    const at = new Date(2026, 7, 10, 9, 4).getTime();
    expect(formatSyncedAt(at, now)).toBe('9:04 AM');
  });

  it('adds the date once "2:14 PM" could silently mean yesterday', () => {
    const at = new Date(2026, 7, 9, 22, 30).getTime();
    expect(formatSyncedAt(at, now)).toMatch(/^Aug 9, 10:30 PM$/);
  });
});
