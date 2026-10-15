import { describe, expect, it } from 'vitest';
import { createAgent } from '@exawatt/core';
import {
  directRecipients,
  directResultOf,
  recipientNote,
  type DirectRecipient,
} from './direct-model';

const ready = { kind: 'ready' } as const;

function recipient(readiness: DirectRecipient['readiness']): DirectRecipient {
  return {
    agentId: 'a1',
    name: 'Alpha',
    harness: 'claude',
    projectId: '/code/alpha',
    readiness,
  };
}

describe('directRecipients', () => {
  it('reads busy from a running turn and stopped from an ended Session', () => {
    const recipients = directRecipients([
      createAgent({ id: 'idle', name: 'Idle', status: 'idle' }),
      createAgent({ id: 'busy', name: 'Busy', status: 'working' }),
      createAgent({ id: 'review', name: 'Review', status: 'reviewing' }),
      createAgent({
        id: 'stopped',
        name: 'Stopped',
        status: 'idle',
        sessionState: 'stopped',
      }),
    ]);
    expect(recipients.map(entry => entry.readiness)).toEqual([
      'ready',
      'busy',
      'busy',
      'stopped',
    ]);
  });
});

describe('recipientNote', () => {
  it('says before Send that a busy recipient waits for its turn', () => {
    expect(recipientNote(recipient('busy'), ready, undefined)?.tone).toBe(
      'quiet'
    );
    expect(recipientNote(recipient('ready'), ready, undefined)).toBeNull();
  });

  it('lists a stopped Session as undeliverable before anything is sent', () => {
    expect(recipientNote(recipient('stopped'), ready, undefined)?.tone).toBe(
      'fault'
    );
  });

  it('shows each delivery result once it arrives, faults emphasized', () => {
    const queued = recipientNote(recipient('busy'), ready, {
      state: 'queued',
    });
    const refused = recipientNote(recipient('ready'), ready, {
      state: 'undeliverable',
      reason: 'Session ended',
    });
    expect(queued?.tone).toBe('quiet');
    expect(refused?.tone).toBe('fault');
    expect(refused?.title).toBe('Session ended');
    expect(
      recipientNote(recipient('ready'), ready, { state: 'sending' })?.tone
    ).toBe('pending');
  });

  it('carries the reason a board cannot send to every row', () => {
    const note = recipientNote(
      recipient('ready'),
      { kind: 'unavailable', reason: 'Demo cannot send' },
      undefined
    );
    expect(note?.text).toBe('Demo cannot send');
  });
});

describe('directResultOf', () => {
  it('reads a refusal as undeliverable with its reason', () => {
    expect(
      directResultOf({ status: 'refused', reason: 'Demo cannot send' })
    ).toEqual({ state: 'undeliverable', reason: 'Demo cannot send' });
  });
});
