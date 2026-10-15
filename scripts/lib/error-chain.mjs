/**
 * A release step's top-level report. The release libraries wrap a failed
 * command in a sentence (`fail(message, cause)`), and printing only that
 * sentence threw the actual reason away: v0.1.19's run said the zip "does not
 * contain a valid signed Exawatt.app" and nothing about which of codesign,
 * Gatekeeper or the stapled ticket refused it. Print every link of the cause
 * chain, with the stderr a failed `execFile` carries.
 */
export function describeErrorChain(error, { maxDepth = 8 } = {}) {
  const lines = [];
  let current = error;
  for (let depth = 0; current != null && depth < maxDepth; depth += 1) {
    const prefix = depth === 0 ? '' : 'caused by: ';
    if (!(current instanceof Error)) {
      lines.push(`${prefix}${String(current)}`);
      break;
    }
    lines.push(`${prefix}${current.message}`);
    const stderr =
      typeof current.stderr === 'string'
        ? current.stderr
        : Buffer.isBuffer(current.stderr)
          ? current.stderr.toString('utf8')
          : '';
    if (stderr.trim()) {
      lines.push(
        ...stderr
          .trim()
          .split('\n')
          .slice(-20)
          .map(line => `  stderr: ${line}`)
      );
    }
    current = current.cause;
  }
  return lines.join('\n');
}
