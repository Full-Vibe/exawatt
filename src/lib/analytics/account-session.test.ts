import { describe, expect, it, vi } from 'vitest';
import {
  accountOf,
  watchForTeamAccount,
  type AccountSubscription,
  type SignedInAccount,
} from './account-session';

const ACCOUNT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('the signed-in account, as analytics may see it (ENG-047 F6)', () => {
  it('reads the id and the team mark, and nothing else', () => {
    expect(
      accountOf({
        id: ACCOUNT,
        email: 'someone@example.com',
        app_metadata: { exawatt_team: true, provider: 'github' },
      })
    ).toEqual({ id: ACCOUNT, team: true });
    expect(accountOf({ id: ACCOUNT, app_metadata: {} })).toEqual({
      id: ACCOUNT,
      team: false,
    });
  });

  it('a mark that is not exactly true is not the team', () => {
    for (const mark of ['true', 1, {}, null]) {
      expect(
        accountOf({ id: ACCOUNT, app_metadata: { exawatt_team: mark } })
      ).toEqual({ id: ACCOUNT, team: false });
    }
    // `user_metadata` is the user's own to write; only `app_metadata` counts.
    expect(
      accountOf({ id: ACCOUNT, user_metadata: { exawatt_team: true } })
    ).toEqual({ id: ACCOUNT, team: false });
  });

  it('a malformed user is no account', () => {
    expect(accountOf(null)).toBeNull();
    expect(accountOf({ id: 'someone@example.com' })).toBeNull();
  });
});

describe('watching for a team account', () => {
  function subscription() {
    let answer: ((account: SignedInAccount | null) => void) | null = null;
    const unsubscribe = vi.fn();
    const subscribe: AccountSubscription = onAccount => {
      answer = onAccount;
      return unsubscribe;
    };
    return {
      subscribe,
      unsubscribe,
      answer: (account: SignedInAccount | null) => answer?.(account),
    };
  }

  it('fires once for a team account, then stops listening', () => {
    const session = subscription();
    const onTeam = vi.fn();
    watchForTeamAccount(onTeam, session.subscribe);
    session.answer(null);
    session.answer({ id: ACCOUNT, team: false });
    expect(onTeam).not.toHaveBeenCalled();
    session.answer({ id: ACCOUNT, team: true });
    session.answer({ id: ACCOUNT, team: true });
    expect(onTeam).toHaveBeenCalledTimes(1);
    expect(session.unsubscribe).toHaveBeenCalled();
  });

  it('handles a session that answers before subscribe returns', () => {
    const unsubscribe = vi.fn();
    const onTeam = vi.fn();
    watchForTeamAccount(onTeam, onAccount => {
      onAccount({ id: ACCOUNT, team: true });
      return unsubscribe;
    });
    expect(onTeam).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
