import { describe, expect, it } from 'vitest';
import {
  AUTH_LINK_FAILURES,
  AUTH_LINK_OUTCOMES,
  AUTH_LINK_SUCCESSES,
  classifyLinkOutcome,
  GENERIC_LINK_FAILURE,
  isAuthLinkOutcome,
  isAuthLinkSuccess,
  LINK_FAILURE_MESSAGES,
  linkOutcomeMessage,
  LINK_SUCCESS_MESSAGES,
} from './callback-failures';

describe('classifying what a provider said about a link', () => {
  it('reads an identity already on this account as the goal, not a failure', () => {
    for (const cause of [
      'Identity is already linked',
      { message: 'Identity is already linked' },
      { code: 'identity_already_exists', message: 'Bad Request' },
      { message: 'identity has already been linked' },
    ]) {
      expect(classifyLinkOutcome(cause)).toBe('already_linked');
      expect(isAuthLinkSuccess(classifyLinkOutcome(cause))).toBe(true);
    }
  });

  it('separates an identity someone else holds — the same Supabase code', () => {
    expect(
      classifyLinkOutcome({
        code: 'identity_already_exists',
        message: 'Identity is already linked to another user',
      })
    ).toBe('link_claimed');
  });

  it('names the missing-session case that no retry can fix', () => {
    for (const cause of [
      { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
      new Error(
        "Error invoking remote method 'auth:link-github': " +
          'AuthSessionMissingError: Auth session missing!'
      ),
      { code: 'no_authorization', message: 'This endpoint requires a Bearer token' },
    ]) {
      expect(classifyLinkOutcome(cause)).toBe('link_signed_out');
    }
  });

  it('reads a refusal at the provider as a refusal', () => {
    expect(classifyLinkOutcome({ message: 'access_denied' })).toBe(
      'provider_refused'
    );
    expect(classifyLinkOutcome('The user cancelled the request')).toBe(
      'provider_refused'
    );
  });

  it('falls back rather than inventing a diagnosis', () => {
    expect(classifyLinkOutcome(undefined)).toBe('link_failed');
    expect(classifyLinkOutcome({ message: 'kaboom' })).toBe('link_failed');
  });
});

describe('the link outcome channel is closed', () => {
  it('recognizes only its own vocabulary', () => {
    for (const outcome of AUTH_LINK_OUTCOMES) {
      expect(isAuthLinkOutcome(outcome)).toBe(true);
    }
    for (const forged of ['linked ', 'ALREADY_LINKED', '', null, 42]) {
      expect(isAuthLinkOutcome(forged)).toBe(false);
    }
  });

  it('owns distinct copy for every outcome it can report', () => {
    const seen = new Set<string>();
    for (const outcome of AUTH_LINK_OUTCOMES) {
      const copy = linkOutcomeMessage(outcome);
      expect(copy, `no copy for ${outcome}`).toBeTruthy();
      seen.add(copy);
    }
    expect(seen.size).toBe(AUTH_LINK_OUTCOMES.length);
    // The catch-all outcome and an unrecognized token mean the same thing to
    // the operator, so they deliberately share one sentence.
    expect(GENERIC_LINK_FAILURE).toBe(LINK_FAILURE_MESSAGES.link_failed);
  });

  it('keeps successes and failures on opposite sides', () => {
    for (const outcome of AUTH_LINK_SUCCESSES) {
      expect(isAuthLinkSuccess(outcome)).toBe(true);
      expect(linkOutcomeMessage(outcome)).toBe(LINK_SUCCESS_MESSAGES[outcome]);
    }
    for (const outcome of AUTH_LINK_FAILURES) {
      expect(isAuthLinkSuccess(outcome)).toBe(false);
      expect(linkOutcomeMessage(outcome)).toBe(LINK_FAILURE_MESSAGES[outcome]);
    }
  });
});
