import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The one way the connected-source subsystem reads and writes its own JSON
 * files (ENG-010).
 *
 * Three files are written this way — the source registry, the encrypted device
 * credentials beside it, and the projection plan — and each of them had its own
 * copy of these twelve lines. They had already diverged: the registry's write
 * re-asserted the file mode after the rename and the plan's did not, so a plan
 * file that existed before Exawatt first wrote it kept whatever permissions it
 * was created with.
 *
 * Other main-process stores predate this module and still carry their own
 * copies. Converge them when they are next touched rather than in a sweep.
 */

/**
 * A missing or corrupt file reads as `null`, never as a throw. Every caller's
 * answer to "the file is not there" and "the file is nonsense" is the same
 * empty state, and a crash on boot over a hand-edited file is not an answer.
 */
export function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * Write through a temp file in the same directory, then rename.
 *
 * A partial write of the registry would otherwise drop every configured source
 * on the next launch, and the operator would have no way to tell that from a
 * deliberate detach. The temp name carries a UUID because two agents of this
 * process may write the same file at once, and owner-only permissions are set
 * on the temp file so the window before the rename is never wider than the
 * window after it.
 */
export function writeJsonFileAtomic(file: string, value: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort: a filesystem without POSIX modes still gets the rename.
  }
}
