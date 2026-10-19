/**
 * A release step's top-level report. The release libraries wrap a failed
 * command in a sentence (`fail(message, cause)`), and printing only that
 * sentence threw the actual reason away: v0.1.19's run said the zip "does not
 * contain a valid signed Exawatt.app" and nothing about which of codesign,
 * Gatekeeper or the stapled ticket refused it. Print every link of the cause
 * chain, with the stdout and stderr a failed `execFile` carries: some tools
 * give their verdict on stdout (`xcrun stapler validate` says "does not have a
 * ticket stapled to it" there), and v0.1.21's run lost exactly that line.
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
    for (const stream of ['stdout', 'stderr']) {
      lines.push(...streamLines(current[stream], stream));
    }
    current = current.cause;
  }
  return lines.join('\n');
}

function streamLines(value, label) {
  const text =
    typeof value === 'string'
      ? value
      : Buffer.isBuffer(value)
        ? value.toString('utf8')
        : '';
  if (!text.trim()) return [];
  return text
    .trim()
    .split('\n')
    .slice(-20)
    .map(line => `  ${label}: ${line}`);
}
