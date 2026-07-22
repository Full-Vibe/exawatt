import fs from 'fs';
import path from 'path';

/**
 * Persistent JSONL diagnostics (D28): one append-only line per event with
 * single-generation rotation. A subsystem that fails silently in the
 * packaged app (whose stdout goes nowhere) must leave evidence that a
 * dogfood report can read back as a file, not reconstruct by archaeology.
 *
 * Sibling of auth-diagnostics.ts, which predates this module and carries
 * auth-specific sanitization on top of the same idea.
 */
export type DiagnosticFields = Record<string, unknown>;
export type DiagnosticRecorder = (
  event: string,
  fields?: DiagnosticFields
) => void;

const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_TEXT_LENGTH = 400;

function clip(value: unknown): unknown {
  if (typeof value !== 'string' || value.length <= MAX_TEXT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_TEXT_LENGTH)}…`;
}

export function createDiagnosticsLog(
  logPath: string,
  maxBytes = DEFAULT_MAX_BYTES
): DiagnosticRecorder {
  fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
  return (event, fields = {}) => {
    const entry: DiagnosticFields = {
      timestamp: new Date().toISOString(),
      event,
    };
    for (const [key, value] of Object.entries(fields)) {
      entry[key] = clip(value);
    }
    let line: string;
    try {
      line = `${JSON.stringify(entry)}\n`;
    } catch {
      line = `${JSON.stringify({
        timestamp: entry.timestamp,
        event,
        unserializable: true,
      })}\n`;
    }
    try {
      const size = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
        fs.renameSync(logPath, `${logPath}.1`);
      }
      fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      console.warn('[diagnostics] could not persist event', event, error);
    }
  };
}
