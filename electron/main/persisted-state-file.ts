import * as path from 'node:path';
import {
  describeUnreadableConfig,
  readConfigFile,
  readConfigFileSync,
  type ConfigFileGrammar,
  type ConfigFileRead,
  type ConfigFileUnreadableCause,
} from '@exawatt/core/server';
import { recordStoreDiagnostic, setAsideDamagedFile } from './atomic-json-file';

/**
 * One read of state Exawatt wrote itself and can rebuild: Session resume
 * links, Claude plan history, the usage scan (BUG-247).
 *
 * Four answers. `missing` and `set-aside` both start fresh: nothing was
 * saved, or what was saved is damaged and its bytes now sit beside the store
 * (`<file>.corrupt-<time>-<uuid>`, owner-only, the same move settings make
 * since 0.1.13). `unreadable` starts nothing: the file is there and could not
 * be read, so the caller keeps its changes in memory, never writes over the
 * file, and reads again later. A caller that let the next save replace an
 * unreadable file would turn a permission error into lost history.
 *
 * Unlike settings or the workspace, a damaged file here installs no write
 * interlock: this state is rebuilt from provider transcripts and live reads,
 * and there is no recovery step to lift an interlock, so one would stop the
 * store saving anything again.
 */
type PersistedStateRead<T> =
  | { status: 'missing' }
  | { status: 'ok'; value: T }
  | { status: 'set-aside'; recoveryFile: string }
  | { status: 'unreadable'; cause: ConfigFileUnreadableCause };

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}

function settle<T>(
  file: string,
  read: ConfigFileRead<T>
): PersistedStateRead<T> {
  if (read.status !== 'unreadable' || read.cause.kind !== 'rejected') {
    return read;
  }
  try {
    const recoveryFile = setAsideDamagedFile(file);
    recordStoreDiagnostic('store.set-aside', {
      store: path.basename(file),
      recoveryFile: path.basename(recoveryFile),
    });
    return { status: 'set-aside', recoveryFile };
  } catch (error) {
    // Bytes that cannot be moved aside cannot be written over either.
    return {
      status: 'unreadable',
      cause: { kind: 'io', code: errorCode(error) },
    };
  }
}

export function readPersistedStateSync<T>(
  file: string,
  grammar: ConfigFileGrammar<T>
): PersistedStateRead<T> {
  return settle(file, readConfigFileSync(file, grammar));
}

export async function readPersistedState<T>(
  file: string,
  grammar: ConfigFileGrammar<T>
): Promise<PersistedStateRead<T>> {
  return settle(file, await readConfigFile(file, grammar));
}

/** Strict JSON, the grammar every one of these stores is written in. */
export function jsonStateGrammar<T>(
  accept: (value: unknown) => T | null,
  maxBytes?: number
): ConfigFileGrammar<T> {
  return {
    name: 'JSON',
    parse: text => accept(JSON.parse(text)),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  };
}

interface UnreadableStateNotice {
  /** Absolute path, for revealing the file. Never recorded in diagnostics. */
  file: string;
  /** What the operator knows this state as, e.g. "usage history". */
  label: string;
  /** The cause in a few words, e.g. "permission denied". */
  detail: string;
}

let noticeSink: (notice: UnreadableStateNotice) => void = () => {};

/** Main wires the operator-facing notice; tests and helpers leave it silent. */
export function configureUnreadableStateNotice(
  sink: (notice: UnreadableStateNotice) => void
): void {
  noticeSink = sink;
}

/**
 * Tracks one store's failed reads. The first failure is logged with its
 * cause; a failure that survives a retry is shown to the operator once per
 * launch; a read that succeeds again is logged as recovered.
 */
export class UnreadableStateWatch {
  private failures = 0;
  private lastDetail: string | null = null;
  private noticed = false;

  constructor(
    private readonly file: string,
    private readonly label: string
  ) {}

  failed(cause: ConfigFileUnreadableCause): void {
    this.failures += 1;
    const detail = describeUnreadableConfig(cause);
    if (detail !== this.lastDetail) {
      this.lastDetail = detail;
      recordStoreDiagnostic('store.read-unavailable', {
        store: path.basename(this.file),
        cause: detail,
        attempt: this.failures,
      });
    }
    if (this.failures >= 2 && !this.noticed) {
      this.noticed = true;
      noticeSink({ file: this.file, label: this.label, detail });
    }
  }

  recovered(): void {
    if (this.failures === 0) return;
    recordStoreDiagnostic('store.read-recovered', {
      store: path.basename(this.file),
      attempts: this.failures,
    });
    this.failures = 0;
    this.lastDetail = null;
  }
}
