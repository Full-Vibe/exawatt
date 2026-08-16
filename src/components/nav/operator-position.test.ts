import { describe, expect, it } from 'vitest';
import type { NavLocation } from './nav-history';
import { OperatorPositionAuthority } from './operator-position';

function authorityAt(start: NavLocation | null) {
  const authority = new OperatorPositionAuthority();
  let position = start;
  authority.setSource(() => position);
  return {
    authority,
    stand: (next: NavLocation | null) => {
      position = next;
    },
  };
}

const agent = (tabId: string): NavLocation => ({
  surface: '/workspace',
  tab: { dir: '/repo', tabId },
});

const team: NavLocation = { surface: '/workspace?view=sessions', tab: null };

describe('who may move the operator', () => {
  it('lets a completion move him while he is still where he asked from', () => {
    const { authority } = authorityAt(agent('tab-draft'));
    const claim = authority.claimHere();
    expect(claim.stillCurrent()).toBe(true);
  });

  it('refuses once he has switched to another Agent', () => {
    const { authority, stand } = authorityAt(agent('tab-draft'));
    const claim = authority.claimHere();
    stand(agent('tab-other'));
    expect(claim.stillCurrent()).toBe(false);
  });

  it('refuses once he has changed altitude', () => {
    const { authority, stand } = authorityAt(agent('tab-draft'));
    const claim = authority.claimHere();
    stand(team);
    expect(claim.stillCurrent()).toBe(false);
  });

  it('lets him leave and come back — currency is position, not history', () => {
    const { authority, stand } = authorityAt(agent('tab-draft'));
    const claim = authority.claimHere();
    stand(team);
    stand(agent('tab-draft'));
    expect(claim.stillCurrent()).toBe(true);
  });

  it('claims a named tab against the surface he is on', () => {
    const { authority, stand } = authorityAt(agent('tab-other'));
    // ⌘T knows which draft authorised it even before the surface has
    // published that selection.
    const claim = authority.claimTab('/repo', 'tab-draft');
    expect(claim.stillCurrent()).toBe(false);
    stand(agent('tab-draft'));
    expect(claim.stillCurrent()).toBe(true);
  });

  it('never authorises a move while no surface owns a position', () => {
    const { authority } = authorityAt(null);
    expect(authority.claimHere().stillCurrent()).toBe(false);
    expect(authority.claimTab('/repo', 'tab-draft').stillCurrent()).toBe(false);
    expect(authority.claim(agent('tab-draft')).stillCurrent()).toBe(false);
  });

  it('stops authorising moves once the surface unmounts', () => {
    const { authority, stand } = authorityAt(agent('tab-draft'));
    const claim = authority.claimHere();
    expect(claim.stillCurrent()).toBe(true);
    stand(null);
    expect(claim.stillCurrent()).toBe(false);
    authority.setSource(null);
    expect(authority.current()).toBeNull();
    expect(claim.stillCurrent()).toBe(false);
  });
});
