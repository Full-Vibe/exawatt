import { describe, expect, it } from 'vitest';
import { ghostActivation } from './use-ghost-slots';

const base = {
  zoneLabel: 'Alpha',
  isDemo: false,
  canLaunch: true,
};

describe('ghostActivation', () => {
  it('opens the composer in the Project folder the zone is bound to', () => {
    expect(
      ghostActivation({
        ...base,
        project: { id: '/code/alpha', label: 'Alpha', rootPath: '/code/alpha' },
      })
    ).toEqual({ kind: 'compose', projectDir: '/code/alpha' });
  });

  it('offers the ghost but launches nothing in Demo', () => {
    expect(
      ghostActivation({
        ...base,
        isDemo: true,
        project: { id: '/code/alpha', label: 'Alpha', rootPath: '/code/alpha' },
      }).kind
    ).toBe('unavailable');
  });

  it('says what is missing for a Project with no folder binding', () => {
    for (const project of [
      { id: 'registry-7', label: 'Alpha', rootPath: null },
      // A connected or catalog-less Project has no folder concept at all.
      { id: 'remote', label: 'Alpha' },
      undefined,
    ]) {
      const activation = ghostActivation({ ...base, project });
      expect(activation.kind).toBe('unavailable');
    }
  });

  it('needs the desktop app to launch anything', () => {
    expect(
      ghostActivation({
        ...base,
        canLaunch: false,
        project: { id: '/code/alpha', label: 'Alpha', rootPath: '/code/alpha' },
      }).kind
    ).toBe('unavailable');
  });
});
