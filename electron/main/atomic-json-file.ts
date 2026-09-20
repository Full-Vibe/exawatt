import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiagnosticRecorder } from './diagnostics-log';

type JsonFileRead =
  | { status: 'absent' }
  | { status: 'ok'; value: unknown }
  | { status: 'corrupt'; recoveryFile: string };

let recordDiagnostic: DiagnosticRecorder = () => {};
export function configureJsonStoreDiagnostics(
  record: DiagnosticRecorder
): void {
  recordDiagnostic = record;
}

/** Diagnose unreadability without recording parser text, paths, or store contents. */
export function reportJsonStoreReadFailure(file: string): void {
  recordDiagnostic('store.read-unavailable', { store: path.basename(file) });
}

class JsonStoreRecoveryError extends Error {
  constructor(readonly file: string) {
    super(
      `${path.basename(file)} needs recovery. Its saved data has been preserved; repair the file and remove its .recovery-required marker before saving.`
    );
    this.name = 'JsonStoreRecoveryError';
  }
}

function missing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/** A durable interlock: moving bad bytes aside must never look like a fresh install. */
function quarantine(file: string): JsonFileRead {
  const recoveryFile = `${file}.corrupt-${Date.now()}-${randomUUID()}`;
  const marker = `${file}.recovery-required`;
  // Marker first: a crash or failed rename still leaves writes blocked. Never
  // put parser errors or file contents into diagnostics (this includes secrets).
  fs.writeFileSync(
    marker,
    JSON.stringify({ recoveryFile: path.basename(recoveryFile) }),
    { mode: 0o600, flag: 'wx' }
  );
  fs.renameSync(file, recoveryFile);
  fs.chmodSync(recoveryFile, 0o600);
  recordDiagnostic('store.recovery-required', {
    store: path.basename(file),
    recoveryFile: path.basename(recoveryFile),
  });
  return { status: 'corrupt', recoveryFile };
}

/** Absence alone is a new store. I/O errors propagate; bad JSON is preserved. */
export function readJsonFile(
  file: string,
  valid: (value: unknown) => boolean = value =>
    !!value && typeof value === 'object' && !Array.isArray(value)
): JsonFileRead {
  try {
    fs.statSync(`${file}.recovery-required`);
    return { status: 'corrupt', recoveryFile: recoveryEvidence(file) };
  } catch (error) {
    if (!missing(error)) throw error;
  }
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (missing(error)) return { status: 'absent' };
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return quarantine(file);
  }
  return valid(value) ? { status: 'ok', value } : quarantine(file);
}

/** Callers must not turn an unreadable document into a credible empty answer. */
export function readJsonDocument(
  file: string,
  valid?: (value: unknown) => boolean
): unknown | null {
  const result = readJsonFile(file, valid);
  if (result.status === 'corrupt') throw new JsonStoreRecoveryError(file);
  return result.status === 'ok' ? result.value : null;
}

/** Every writer checks disk, including writers whose in-memory cache predates damage. */
export function writeJsonFileAtomic(
  file: string,
  value: unknown,
  valid?: (value: unknown) => boolean
): void {
  readJsonDocument(file, valid);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Workspace checkpoints retain asynchronous I/O and invocation-order serialization. */
export async function readJsonDocumentAsync(
  file: string
): Promise<unknown | null> {
  try {
    await fs.promises.stat(`${file}.recovery-required`);
    throw new JsonStoreRecoveryError(file);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  let text: string;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (error) {
    if (missing(error)) {
      if (fs.existsSync(`${file}.recovery-required`))
        throw new JsonStoreRecoveryError(file);
      return null;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    quarantine(file);
    throw new JsonStoreRecoveryError(file);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    quarantine(file);
    throw new JsonStoreRecoveryError(file);
  }
  return value;
}

export async function writeJsonFileAtomicAsync(
  file: string,
  value: unknown
): Promise<void> {
  await readJsonDocumentAsync(file);
  const dir = path.dirname(file);
  await fs.promises.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(temp, JSON.stringify(value, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    if (fs.existsSync(`${file}.recovery-required`))
      throw new JsonStoreRecoveryError(file);
    await fs.promises.rename(temp, file);
    await fs.promises.chmod(file, 0o600);
  } finally {
    await fs.promises.rm(temp, { force: true });
  }
}

function recoveryEvidence(file: string): string {
  const marker = `${file}.recovery-required`;
  try {
    const value = JSON.parse(fs.readFileSync(marker, 'utf8')) as {
      recoveryFile?: unknown;
    };
    if (
      typeof value.recoveryFile === 'string' &&
      path.basename(value.recoveryFile) === value.recoveryFile
    ) {
      const evidence = path.join(path.dirname(file), value.recoveryFile);
      if (fs.existsSync(evidence)) return evidence;
      if (fs.existsSync(file)) return file;
    }
  } catch {
    /* A damaged marker still blocks writes and can itself be revealed. */
  }
  return marker;
}

/** Explicit operator recovery only. No preserved evidence is ever removed. */
export function recoverJsonFile(file: string, action: 'retry' | 'reset'): void {
  const marker = `${file}.recovery-required`;
  if (!fs.existsSync(marker))
    throw new Error('This store does not require recovery.');
  if (action === 'retry') {
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new JsonStoreRecoveryError(file);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new JsonStoreRecoveryError(file);
  } else if (action === 'reset') {
    // A repair attempted since quarantine is evidence too. Preserve it before
    // making an explicitly authorized fresh store look absent.
    if (fs.existsSync(file)) {
      const saved = `${file}.before-reset-${Date.now()}-${randomUUID()}`;
      fs.renameSync(file, saved);
      fs.chmodSync(saved, 0o600);
    }
  } else {
    throw new Error('Invalid store recovery action.');
  }
  fs.unlinkSync(marker);
  recordDiagnostic('store.recovered', { store: path.basename(file), action });
}
