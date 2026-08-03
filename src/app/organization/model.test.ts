import { describe, expect, it } from 'vitest';
import { DEMO_BASE_AGENTS } from '@exawatt/core';
import {
  demoOrgFleetRawTokens,
  demoOrgMembers,
  ORG_MEMBER_SPECS,
  orgPartitionIsTotal,
} from './model';

describe('demoOrgMembers (ENG-026 N3)', () => {
  it('every Voltaic Project has exactly one commanding member', () => {
    expect(orgPartitionIsTotal()).toBe(true);
  });

  it('member spend sums to fleet spend — attribution loses nothing', () => {
    const members = demoOrgMembers();
    const fleetRaw = DEMO_BASE_AGENTS.reduce(
      (sum, agent) =>
        sum +
        agent.usage.input +
        agent.usage.cacheRead +
        agent.usage.cacheWrite +
        agent.usage.output +
        agent.delegated.reduce(
          (s, run) =>
            s +
            run.usage.input +
            run.usage.cacheRead +
            run.usage.cacheWrite +
            run.usage.output,
          0
        ),
      0
    );
    expect(demoOrgFleetRawTokens()).toBe(fleetRaw);
    expect(members.reduce((sum, member) => sum + member.rawTokens, 0)).toBe(
      fleetRaw
    );
  });

  it('session counts partition the base fleet', () => {
    const members = demoOrgMembers();
    expect(
      members.reduce((sum, member) => sum + member.sessionCount, 0)
    ).toBe(DEMO_BASE_AGENTS.length);
  });

  it('exactly one Owner, and every role is meaningful', () => {
    const owners = ORG_MEMBER_SPECS.filter(spec => spec.role === 'Owner');
    expect(owners.length).toBe(1);
    for (const spec of ORG_MEMBER_SPECS) {
      expect(['Owner', 'Admin', 'Member']).toContain(spec.role);
      expect(spec.projectKeys.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    expect(demoOrgMembers()).toEqual(demoOrgMembers());
  });
});
