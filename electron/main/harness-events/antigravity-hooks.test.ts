import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import {
  ANTIGRAVITY_HOOK_HEADER,
  ANTIGRAVITY_HOOKS_FILE,
  antigravityHookConversationId,
  antigravityHookEvent,
  antigravityHookSettings,
} from './antigravity-hooks';

/**
 * The Antigravity CLI adapter (ENG-003 S5.3). Payloads are the ones `agy`
 * 1.2.17 posted during the 2026-10-05 seam verification, with only the paths
 * shortened; none are invented.
 */

const CONVERSATION = '68e001df-1f10-47c3-b5a1-5e0ce3fd8525';
const PRE_INVOCATION = {
  artifactDirectoryPath: `/home/op/.gemini/antigravity-cli/brain/${CONVERSATION}`,
  conversationId: CONVERSATION,
  initialNumSteps: 1,
  invocationNum: 0,
  modelName: 'gpt-oss-120b-medium',
  transcriptPath: `/home/op/.gemini/antigravity-cli/brain/${CONVERSATION}/.system_generated/logs/transcript_full.jsonl`,
  workspacePaths: ['/tmp/exawatt/hooks/pty-1', '/work/app'],
};
const STOP_ERROR = {
  ...PRE_INVOCATION,
  error: 'generating and executing: UNAVAILABLE (code 503)',
  executionNum: 0,
  fullyIdle: true,
  terminationReason: 'ERROR',
};

const envelope = (event: string, payload: unknown) => ({ event, payload });

describe('antigravityHookSettings', () => {
  const document = JSON.parse(antigravityHookSettings(51234, 'tok-abc'));

  it('writes Antigravity’s own schema: hook names, then the events each handles', () => {
    expect(Object.keys(document).sort()).toEqual([
      'exawatt-preinvocation',
      'exawatt-stop',
    ]);
    expect(document['exawatt-preinvocation'].PreInvocation).toHaveLength(1);
    expect(document['exawatt-stop'].Stop).toHaveLength(1);
    for (const hook of [
      document['exawatt-preinvocation'].PreInvocation[0],
      document['exawatt-stop'].Stop[0],
    ]) {
      expect(hook.type).toBe('command');
      // Antigravity's own default is 30 s; a dead listener costs far less.
      expect(hook.timeout).toBeLessThanOrEqual(3);
      expect(hook.command).toContain('http://127.0.0.1:51234/hook');
      expect(hook.command).toContain(`${ANTIGRAVITY_HOOK_HEADER}: tok-abc`);
      // A hook's stdout is read as a decision document, so it prints nothing
      // and never fails the Agent's turn over the listener.
      expect(hook.command).toContain('-o /dev/null');
      expect(hook.command.trimEnd().endsWith('|| true')).toBe(true);
    }
  });

  it('wraps the stdin payload in an envelope naming the event, as a shell would run it', () => {
    // The payload carries no event name, so the command adds one. Run the
    // real command with curl replaced by cat, so the envelope that would be
    // posted is what comes out.
    const command: string = document['exawatt-stop'].Stop[0].command;
    const posted = execFileSync(
      'sh',
      [
        '-c',
        `curl() { cat; }; ${command.replace(/\|\| true$/, '')}`,
      ],
      { input: JSON.stringify(STOP_ERROR), encoding: 'utf8' }
    );
    expect(JSON.parse(posted)).toEqual(envelope('Stop', STOP_ERROR));
  });

  it('names the file Antigravity scans a workspace directory for', () => {
    expect(ANTIGRAVITY_HOOKS_FILE).toBe('.agents/hooks.json');
  });
});

describe('antigravityHookConversationId', () => {
  it('reads the conversation every payload names', () => {
    expect(
      antigravityHookConversationId(envelope('PreInvocation', PRE_INVOCATION))
    ).toBe(CONVERSATION);
    expect(antigravityHookConversationId(envelope('Stop', STOP_ERROR))).toBe(
      CONVERSATION
    );
  });

  it('is null for anything that is not an envelope with a conversation', () => {
    expect(antigravityHookConversationId(PRE_INVOCATION)).toBeNull();
    expect(antigravityHookConversationId(envelope('Stop', {}))).toBeNull();
    expect(antigravityHookConversationId('text')).toBeNull();
    expect(antigravityHookConversationId(null)).toBeNull();
  });
});

describe('antigravityHookEvent', () => {
  it('opens the turn on PreInvocation', () => {
    expect(
      antigravityHookEvent(envelope('PreInvocation', PRE_INVOCATION), 1)
    ).toEqual({ kind: 'turn-start' });
  });

  it('closes the turn only on a Stop that declares the loop fully idle', () => {
    expect(antigravityHookEvent(envelope('Stop', STOP_ERROR), 1)).toEqual({
      kind: 'turn-end',
    });
    // A failed model call still ends the turn: the Agent is idle, not
    // working, and the terminal shows the error.
    expect(STOP_ERROR.terminationReason).toBe('ERROR');
    expect(
      antigravityHookEvent(
        envelope('Stop', { ...STOP_ERROR, fullyIdle: false }),
        1
      )
    ).toBeNull();
    expect(
      antigravityHookEvent(envelope('Stop', { conversationId: CONVERSATION }), 1)
    ).toBeNull();
  });

  it('models nothing for events it did not subscribe to, or malformed posts', () => {
    expect(
      antigravityHookEvent(envelope('PostInvocation', PRE_INVOCATION), 1)
    ).toBeNull();
    expect(
      antigravityHookEvent(
        envelope('PreToolUse', {
          ...PRE_INVOCATION,
          toolCall: { name: 'invoke_subagent', args: {} },
        }),
        1
      )
    ).toBeNull();
    expect(antigravityHookEvent(PRE_INVOCATION, 1)).toBeNull();
    expect(antigravityHookEvent({ event: 'Stop' }, 1)).toBeNull();
    expect(antigravityHookEvent(null, 1)).toBeNull();
  });
});
