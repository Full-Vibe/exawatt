import * as path from 'path';
import type { NoticeDismissals } from '@exawatt/core/desktop-bridge';
import { recordStoreDiagnostic } from './atomic-json-file';
import type { TrustedChannels } from './ipc-table';
import {
  jsonStateGrammar,
  readPersistedStateSync,
  writePersistedStateSync,
} from './persisted-state-file';
import { broadcastToWindows } from './window-broadcast';

/**
 * The one record of dismissed notices (BUG-285), kept by main so every
 * window, reload and launch reads the same answer.
 *
 * A notice is identified by an id and a version: the notice comes back only
 * when its version changes. The renderer decides each notice's identity
 * (`src/lib/notices/notice-identity.ts`); this store only remembers which
 * version was dismissed. Dismissal used to be React state in the notice
 * component, keyed by the INSTALLED build, so a second dogfood install while
 * the operator was still running the first stale build announced "New local
 * build installed" again, though nothing he had to do had changed.
 *
 * Size class (decision 0039): one entry per notice id, and ids are a closed
 * set the renderer declares, so the file is bounded by the number of notice
 * kinds. Ids and versions are clipped where they enter.
 *
 * A file that cannot be read is never written over, and what the operator
 * does meanwhile is kept as changes, not as a snapshot: once the file reads
 * again, the changes are replayed onto it, so his newer dismissals win and
 * every dismissal only the file knew survives (the 0.1.22 review: the
 * re-read used to replace them).
 */

const MAX_ID = 80;
const MAX_VERSION = 400;
const MAX_ENTRIES = 32;

const GRAMMAR = jsonStateGrammar<NoticeDismissals>(value => {
  const record = value as { v?: unknown; dismissed?: unknown } | null;
  if (!record || record.v !== 1) return null;
  const dismissed = record.dismissed;
  if (!dismissed || typeof dismissed !== 'object' || Array.isArray(dismissed)) {
    return null;
  }
  const entries = Object.entries(dismissed);
  if (!entries.every(([, version]) => typeof version === 'string')) return null;
  return Object.fromEntries(entries) as NoticeDismissals;
});

interface NoticeWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

interface NoticeDismissalStore {
  current(): NoticeDismissals;
  dismiss(id: string, version: string): NoticeDismissals;
  /** Forgets every dismissal whose id starts with `prefix`: the operator
   *  asked for the notice again (Check for Updates). */
  forget(prefix: string): void;
  channels: TrustedChannels;
}

type Change =
  | { kind: 'dismiss'; id: string; version: string }
  | { kind: 'forget'; prefix: string };

function applyChange(
  dismissed: NoticeDismissals,
  change: Change
): NoticeDismissals {
  if (change.kind === 'forget') {
    return Object.fromEntries(
      Object.entries(dismissed).filter(([id]) => !id.startsWith(change.prefix))
    );
  }
  const rest = Object.entries(dismissed).filter(([id]) => id !== change.id);
  return Object.fromEntries([
    ...rest.slice(-(MAX_ENTRIES - 1)),
    [change.id, change.version],
  ]);
}

export function createNoticeDismissalStore(options: {
  file: string;
  allWindows: () => NoticeWindow[];
}): NoticeDismissalStore {
  const { file } = options;
  let dismissed: NoticeDismissals = {};
  /** Changes the file does not hold yet. */
  let unsaved: Change[] = [];
  /** An unreadable file is never written over; changes stay in memory. */
  let unreadable = false;

  const load = () => {
    const read = readPersistedStateSync(file, GRAMMAR);
    unreadable = read.status === 'unreadable';
    if (unreadable) {
      recordStoreDiagnostic('store.read-unavailable', {
        store: path.basename(file),
      });
      return;
    }
    const base = read.status === 'ok' ? read.value : {};
    dismissed = unsaved.reduce(applyChange, base);
  };
  load();

  const change = (next: Change) => {
    unsaved.push(next);
    dismissed = applyChange(dismissed, next);
    if (unreadable) load();
    if (!unreadable) {
      try {
        writePersistedStateSync(file, { v: 1, dismissed });
        unsaved = [];
      } catch (error) {
        // The dismissal still holds for this run in every window.
        recordStoreDiagnostic('store.write-failed', {
          store: path.basename(file),
          code: (error as NodeJS.ErrnoException).code ?? 'unknown',
        });
      }
    }
    broadcastToWindows(
      options.allWindows(),
      'app:notice-dismissals-changed',
      dismissed
    );
  };

  const dismiss = (id: string, version: string): NoticeDismissals => {
    change({
      kind: 'dismiss',
      id: id.slice(0, MAX_ID),
      version: version.slice(0, MAX_VERSION),
    });
    return dismissed;
  };

  return {
    current: () => dismissed,
    dismiss,
    forget(prefix) {
      if (!Object.keys(dismissed).some(id => id.startsWith(prefix))) {
        // Nothing here to forget, but an unread file may hold some.
        if (!unreadable) return;
      }
      change({ kind: 'forget', prefix });
    },
    channels: {
      'app:notice-dismissals': () => dismissed,
      'app:dismiss-notice': (_event, id: string, version: string) => {
        if (typeof id !== 'string' || typeof version !== 'string' || !id) {
          return dismissed;
        }
        return dismiss(id, version);
      },
    },
  };
}
