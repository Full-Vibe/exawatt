import {
  isAgentHarness,
  isAgentSourceAdapterId,
  isSafetyControlId,
  type AgentPermissionMode,
  type PtyHarness,
} from '@exawatt/core';
import type {
  AgentSourceScope,
  DesktopBridgeRequestChannel,
  OperatorProfileStateUpdate,
  PtyCreateOptions,
  ResumeIdentityHint,
} from '@exawatt/core/desktop-bridge';
import {
  handleTrusted,
  type ArgumentBoundary,
  type TrustedHandler,
} from './ipc-security';

/**
 * What main accepts from the renderer, read at the boundary (ENG-039).
 *
 * The desktop bridge contract types what a well-behaved renderer sends; this
 * table is what refuses anything else before a handler runs. Each reader
 * returns the contract's own argument tuple, so a reader that drifts from
 * the contract fails `tsc`, and each throws the same sentence its handler
 * used to throw inline. Channels with consequential input (spawn options,
 * paths, identities, settings writes) are here; readers that already live
 * beside their subsystem stay there (`parsePlanRequest`,
 * `parseOperatorStatsSyncEvent`, the connected-source readers).
 *
 * It lives apart from `ipc-security.ts` because it needs `@exawatt/core` at
 * runtime, and the command engine's own channel must register without it
 * (BUG-016).
 */

type Boundaries = {
  readonly [C in DesktopBridgeRequestChannel]?: ArgumentBoundary<C>;
};

const SESSION_ID = /^[A-Za-z0-9._-]{1,200}$/;
const PERMISSION_MODES: readonly AgentPermissionMode[] = [
  'prompt',
  'auto',
  'unrestricted',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function scope(value: unknown = 'all'): AgentSourceScope {
  if (value !== 'all' && value !== 'launch') {
    throw new Error('Invalid Agent Source scope');
  }
  return value;
}

/** A settings switch: one boolean, refused with the switch's own sentence. */
function switchSetting(message: string): {
  read(args: readonly unknown[]): [enabled: boolean];
} {
  return {
    read([enabled]) {
      if (typeof enabled !== 'boolean') throw new Error(message);
      return [enabled];
    },
  };
}

/** Absent, or a string: the optional text fields of a launch request. Null
 *  has always flowed through as absent, so it still does. */
function optionalText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function optionalNumber(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isPtyHarness(value: unknown): value is PtyHarness {
  return value === 'shell' || isAgentHarness(value);
}

/**
 * Spawn options. The harness picks the executable and every field reaches a
 * process, an argv, or a file name, so each is the type the contract says
 * before the launch path sees it. Deeper rules (prompt length, model and
 * effort syntax, Session id syntax) stay with the code that applies them.
 */
function launchOptions(value: unknown): PtyCreateOptions {
  if (!isRecord(value) || !isPtyHarness(value.harness)) {
    throw new Error('Invalid launch options');
  }
  const textFields = [
    'cwd',
    'title',
    'resumeSessionId',
    'durableSessionId',
    'initialPrompt',
    'statedTask',
    'restoredSubtitle',
    'model',
    'effort',
  ] as const;
  if (
    !textFields.every(field => optionalText(value[field])) ||
    (typeof value.cwd === 'string' && value.cwd.includes('\0')) ||
    !optionalNumber(value.cols) ||
    !optionalNumber(value.rows) ||
    !(
      value.permissionMode === undefined ||
      value.permissionMode === null ||
      PERMISSION_MODES.includes(value.permissionMode as AgentPermissionMode)
    )
  ) {
    throw new Error('Invalid launch options');
  }
  // Accepted as sent: the launch path has always received this object.
  return value as unknown as PtyCreateOptions;
}

function resumeHints(value: unknown): ResumeIdentityHint[] {
  if (!Array.isArray(value) || value.length > 200) {
    throw new Error('Invalid Session identity reconciliation request');
  }
  return value.map(candidate => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Invalid Session identity hint');
    }
    const hint = candidate as Partial<ResumeIdentityHint>;
    if (
      typeof hint.durableSessionId !== 'string' ||
      !SESSION_ID.test(hint.durableSessionId) ||
      !isAgentHarness(hint.harness) ||
      typeof hint.cwd !== 'string' ||
      !hint.cwd ||
      hint.cwd.includes('\0') ||
      (hint.initialTask !== null &&
        (typeof hint.initialTask !== 'string' ||
          hint.initialTask.length > 8_000)) ||
      (hint.harnessSessionId !== null &&
        (typeof hint.harnessSessionId !== 'string' ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(hint.harnessSessionId)))
    ) {
      throw new Error('Invalid Session identity hint');
    }
    return hint as ResumeIdentityHint;
  });
}

function operatorProfileState(value: unknown): OperatorProfileStateUpdate {
  if (!isRecord(value)) throw new Error('Invalid Operator profile state');
  if (
    Object.keys(value).some(
      key => !['startedAt', 'lastSyncedAt', 'profileEnabled'].includes(key)
    ) ||
    (value.startedAt !== undefined && typeof value.startedAt !== 'string') ||
    (value.lastSyncedAt !== undefined &&
      typeof value.lastSyncedAt !== 'string') ||
    (value.profileEnabled !== undefined &&
      typeof value.profileEnabled !== 'boolean')
  ) {
    throw new Error('Invalid Operator profile state');
  }
  return {
    ...(value.startedAt === undefined ? {} : { startedAt: value.startedAt }),
    ...(value.lastSyncedAt === undefined
      ? {}
      : { lastSyncedAt: value.lastSyncedAt }),
    ...(value.profileEnabled === undefined
      ? {}
      : { profileEnabled: value.profileEnabled }),
  };
}

export const ARGUMENT_BOUNDARIES = {
  'agent-sources:list': {
    read([rawScope, refresh = false]) {
      if (typeof refresh !== 'boolean') {
        throw new Error('Invalid Agent Source refresh request');
      }
      return [scope(rawScope), refresh];
    },
  },
  'agent-sources:remembered': {
    read([rawScope]) {
      return [scope(rawScope)];
    },
  },
  'agent-sources:act': {
    read([adapterId, action]) {
      if (!isAgentSourceAdapterId(adapterId)) {
        throw new Error('Unsupported Agent Source');
      }
      if (
        action !== 'authenticate' &&
        action !== 'choose-model' &&
        action !== 'install-guide'
      ) {
        throw new Error('Unsupported Agent Source action');
      }
      return [adapterId, action];
    },
  },
  'consumption:snapshot': {
    read([request]) {
      const sinceMs = (request as { sinceMs?: unknown } | null | undefined)
        ?.sinceMs;
      if (sinceMs !== undefined && typeof sinceMs !== 'number') {
        throw new Error('Invalid consumption snapshot request');
      }
      return [sinceMs === undefined ? undefined : { sinceMs }];
    },
  },
  'pty:create': {
    read([options]) {
      return [launchOptions(options)];
    },
    refuse: error => ({ ok: false, error }),
  },
  'pty:list-agent-models': {
    read([harness, cwd, refresh = false]) {
      if (!isAgentHarness(harness)) {
        throw new Error('Unsupported Agent Source');
      }
      if (typeof cwd !== 'string' || !cwd.trim() || cwd.includes('\0')) {
        throw new Error('Invalid Project directory');
      }
      return [harness, cwd, refresh === true];
    },
  },
  'pty:set-context-auth': {
    read([accessToken]) {
      if (
        accessToken !== null &&
        (typeof accessToken !== 'string' || accessToken.length > 16_384)
      ) {
        throw new Error('Invalid context-label authentication');
      }
      return [accessToken];
    },
  },
  'pty:correct-context': {
    read([durableSessionId, label]) {
      if (
        typeof durableSessionId !== 'string' ||
        !durableSessionId ||
        durableSessionId.length > 240 ||
        typeof label !== 'string'
      ) {
        throw new Error('Invalid context-label correction');
      }
      return [durableSessionId, label];
    },
  },
  'pty:clone-context': {
    read([durableSessionId]) {
      if (
        typeof durableSessionId !== 'string' ||
        !SESSION_ID.test(durableSessionId)
      ) {
        throw new Error('Invalid Session identity');
      }
      return [durableSessionId];
    },
  },
  'pty:copy-text': {
    read([text]) {
      if (typeof text !== 'string' || text.length > 4_000_000) {
        throw new Error('Invalid clipboard text');
      }
      return [text];
    },
  },
  'pty:open-path': {
    read([rawPath, cwd, options]) {
      if (
        typeof rawPath !== 'string' ||
        !rawPath ||
        rawPath.includes('\0') ||
        rawPath.length > 4096 ||
        typeof cwd !== 'string'
      ) {
        throw new Error('Invalid local path');
      }
      // `contain` is read for truthiness by the handler, as it always was:
      // narrowing it here could only ever turn containment off.
      return [rawPath, cwd, options as { contain?: boolean } | undefined];
    },
  },
  /** A git argv: an option-shaped branch or an empty repository is refused
   *  before `git worktree add` sees it. */
  'pty:worktree': {
    read([repoDir, branch]) {
      if (
        typeof repoDir !== 'string' ||
        !repoDir.trim() ||
        repoDir.includes('\0') ||
        typeof branch !== 'string' ||
        !branch ||
        branch.startsWith('-') ||
        branch.includes('\0')
      ) {
        throw new Error('Invalid worktree request');
      }
      return [repoDir, branch];
    },
    refuse: error => ({ ok: false, error }),
  },
  'pty:reconcile-resume-identities': {
    read([candidates]) {
      return [resumeHints(candidates)];
    },
  },
  'settings:set-attention-notifications': switchSetting(
    'Invalid notification setting'
  ),
  'settings:set-dock-badge': switchSetting('Invalid dock badge setting'),
  'settings:set-hosted-context-labels': switchSetting(
    'Invalid context label setting'
  ),
  'settings:set-hosted-conversation-summaries': switchSetting(
    'Invalid conversation summary setting'
  ),
  'settings:set-goal-visuals': switchSetting('Invalid goal visual setting'),
  'settings:set-reentry-recap': switchSetting('Invalid recap setting'),
  'settings:set-operator-auto-publish': switchSetting(
    'Invalid publishing setting'
  ),
  'settings:set-claude-plan-windows': switchSetting(
    'Invalid Claude plan usage setting'
  ),
  // Only a declared control can be set: an unknown id from the renderer is
  // refused, never stored as a switch nothing enforces.
  'settings:set-safety-control': {
    read([control, enabled]) {
      if (!isSafetyControlId(control) || typeof enabled !== 'boolean') {
        throw new Error('Invalid safety control setting');
      }
      return [control, enabled];
    },
  },
  'settings:record-operator-profile-state': {
    read([state]) {
      return [operatorProfileState(state)];
    },
  },
} satisfies Boundaries;

/** The channels whose arguments are read here. */
type BoundedChannel = keyof typeof ARGUMENT_BOUNDARIES;

/**
 * Registers a bounded channel: the reader runs first, and the handler
 * receives the contract's arguments. A channel in the table is registered
 * only through here (`ipc-arguments.test.ts`).
 */
export function handleBounded<C extends BoundedChannel>(
  channel: C,
  handler: TrustedHandler<C>
): void {
  handleTrusted(
    channel,
    handler,
    (ARGUMENT_BOUNDARIES as Boundaries)[channel] as ArgumentBoundary<C>
  );
}
