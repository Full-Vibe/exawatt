import { randomUUID } from 'node:crypto';
import type { PtyPowerControl } from '@exawatt/core/desktop-bridge';
import { loginShellFamily, shellQuote } from './login-shell';

type AppliedPowerControl = Extract<
  PtyPowerControl,
  { state: 'applied-at-launch' }
>;

interface PowerLaunchRequest {
  shell: string;
  sourceExecutable: string;
  candidate: AppliedPowerControl;
  controlledCommand: string;
  ordinaryCommand: string;
  /** An executable already explicitly selected for the actual launch. */
  explicitExecutable?: string;
}

/** A probe is only a candidate: terminal-dependent shell startup can change
 * command resolution. Check in the actual launch shell, and acknowledge the
 * branch before starting its command. The nonce is a correlation boundary,
 * not a security boundary against the operator's own shell or programs. */
export function createHarnessPowerLaunch(request: PowerLaunchRequest): {
  command: string;
  initialPowerControl: PtyPowerControl;
  consume: (data: string) => { data: string; powerControl?: PtyPowerControl };
  flush: () => string;
} {
  const initialPowerControl: PtyPowerControl = {
    state: 'unknown',
    reason: 'Awaiting launch sleep-control confirmation',
  };
  const family = loginShellFamily(request.shell);
  if (
    (family !== 'posix' && family !== 'fish') ||
    (request.explicitExecutable !== undefined &&
      request.explicitExecutable !== request.candidate.executable)
  ) {
    return {
      command: request.ordinaryCommand,
      initialPowerControl: {
        state: 'unknown',
        reason: 'Actual launch control could not be verified',
      },
      consume: data => ({ data }),
      flush: () => '',
    };
  }

  const nonce = randomUUID();
  const prefix = `777;exawatt-power;${nonce};`;
  const appliedMarker = `\x1b]${prefix}applied\x07`;
  const unknownMarker = `\x1b]${prefix}unknown\x07`;
  const markers = [appliedMarker, unknownMarker];
  // Use the system utility so an operator's printf wrapper cannot accidentally
  // change our acknowledgment. Its arguments contain only our nonce/constants.
  const acknowledge = (state: 'applied' | 'unknown') =>
    `/usr/bin/printf ${shellQuote(`\\033]${prefix}${state}\\007`)}`;
  const source = shellQuote(request.sourceExecutable);
  const executable = shellQuote(request.candidate.executable);
  // Fish's command -v skips functions; require its normal invocation to be a
  // file as well. POSIX command -v reports a function/alias rather than its PATH
  // binary, so equality to the absolute candidate already excludes wrappers.
  const condition = request.explicitExecutable
    ? 'true'
    : family === 'fish'
      ? `test (type -t ${source} 2>/dev/null) = file; and test (command -v ${source} 2>/dev/null) = ${executable}`
      : `[ "$(command -v ${source} 2>/dev/null)" = ${executable} ]`;
  const command =
    family === 'fish'
      ? `if ${condition}\n${acknowledge('applied')}\n${request.controlledCommand}\nelse\n${acknowledge('unknown')}\n${request.ordinaryCommand}\nend`
      : `if ${condition}; then\n${acknowledge('applied')}\n${request.controlledCommand}\nelse\n${acknowledge('unknown')}\n${request.ordinaryCommand}\nfi`;

  let carry = '';
  let settled = false;
  let ended = false;
  return {
    command,
    initialPowerControl,
    consume(data) {
      if (ended) return { data };
      const input = carry + data;
      carry = '';
      const output: string[] = [];
      let offset = 0;
      let powerControl: PtyPowerControl | undefined;
      while (offset < input.length) {
        const start = input.indexOf('\x1b', offset);
        if (start === -1) {
          output.push(input.slice(offset));
          break;
        }
        output.push(input.slice(offset, start));
        const rest = input.slice(start);
        const marker = markers.find(value => rest.startsWith(value));
        if (marker) {
          if (!settled) {
            settled = true;
            powerControl =
              marker === appliedMarker
                ? { ...request.candidate, observedAt: Date.now() }
                : {
                    state: 'unknown',
                    reason:
                      'Actual launch invocation differs from probed executable',
                  };
          }
          offset = start + marker.length;
        } else if (markers.some(value => value.startsWith(rest))) {
          // Only a proper prefix of our exact nonce marker is retained, never
          // an arbitrary OSC or an unbounded source-output fragment.
          carry = rest;
          break;
        } else {
          output.push('\x1b');
          offset = start + 1;
        }
      }
      return {
        data: output.join(''),
        ...(powerControl ? { powerControl } : {}),
      };
    },
    flush() {
      // Once our full nonce prefix is known, a truncated acknowledgement is
      // control data, not source output. Preserve ambiguous short ANSI tails.
      const remaining = carry.startsWith(`\x1b]${prefix}`) ? '' : carry;
      carry = '';
      ended = true;
      return remaining;
    },
  };
}
